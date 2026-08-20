import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ExpenseCategory,
  ExpenseCostCenter,
  ExpensePaymentMethod,
  ExpenseStatus,
  Prisma,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody, positiveDecimalString } from "../lib/validation.js";
import { cancelExpense, createExpense } from "../services/expense-service.js";

const createSchema = z.object({
  category: z.nativeEnum(ExpenseCategory),
  costCenter: z.nativeEnum(ExpenseCostCenter),
  paymentMethod: z.nativeEnum(ExpensePaymentMethod),
  incurredAt: z.coerce.date(),
  amount: positiveDecimalString,
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  description: z.string().trim().min(3).max(300),
  counterparty: z.string().trim().max(200).optional(),
  documentNumber: z.string().trim().max(100).optional(),
  note: z.string().trim().max(2000).optional(),
});

const cancelSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  category: z.nativeEnum(ExpenseCategory).optional(),
  status: z.nativeEnum(ExpenseStatus).optional(),
  search: z.string().trim().max(200).optional(),
});

export async function registerExpenseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/expenses", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const query = parseBody(querySchema, request.query);
    const baseWhere: Prisma.ExpenseWhereInput = {
      workspaceId,
      ...(query.from === undefined && query.to === undefined ? {} : {
        incurredAt: {
          ...(query.from === undefined ? {} : { gte: query.from }),
          ...(query.to === undefined ? {} : { lte: query.to }),
        },
      }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.search === undefined || query.search === "" ? {} : {
        OR: [
          { number: { contains: query.search, mode: "insensitive" } },
          { description: { contains: query.search, mode: "insensitive" } },
          { counterparty: { contains: query.search, mode: "insensitive" } },
          { documentNumber: { contains: query.search, mode: "insensitive" } },
        ],
      }),
    };
    const itemWhere: Prisma.ExpenseWhereInput = {
      ...baseWhere,
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    const [items, totals, byCategory, recordedCount, cancelledCount] = await Promise.all([
      prisma.expense.findMany({
        where: itemWhere,
        include: {
          createdBy: { select: { id: true, name: true } },
          cancelledBy: { select: { id: true, name: true } },
        },
        orderBy: [{ incurredAt: "desc" }, { createdAt: "desc" }],
        take: 500,
      }),
      prisma.expense.groupBy({
        by: ["currency"],
        where: { ...baseWhere, status: ExpenseStatus.RECORDED },
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ["category", "currency"],
        where: { ...baseWhere, status: ExpenseStatus.RECORDED },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.expense.count({ where: { ...baseWhere, status: ExpenseStatus.RECORDED } }),
      prisma.expense.count({ where: { ...baseWhere, status: ExpenseStatus.CANCELLED } }),
    ]);
    return {
      items,
      summary: {
        totals: totals.map((item) => ({ currency: item.currency, amount: item._sum.amount?.toString() ?? "0" })),
        byCategory: byCategory.map((item) => ({
          category: item.category,
          currency: item.currency,
          amount: item._sum.amount?.toString() ?? "0",
          count: item._count._all,
        })),
        recordedCount,
        cancelledCount,
      },
    };
  });

  app.post("/expenses", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string") {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Добавьте заголовок Idempotency-Key");
    }
    const expense = await createExpense(
      workspaceId,
      actor.id,
      idempotencyKey,
      parseBody(createSchema, request.body),
    );
    return reply.status(201).send(expense);
  });

  app.post<{ Params: { id: string } }>("/expenses/:id/cancel", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string") {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Добавьте заголовок Idempotency-Key");
    }
    const input = parseBody(cancelSchema, request.body);
    return cancelExpense(workspaceId, actor.id, idempotencyKey, request.params.id, input.reason);
  });
}
