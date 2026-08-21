import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import {
  ExpenseCategory,
  ExpenseCostCenter,
  ExpensePaymentMethod,
  ExpenseStatus,
  Prisma,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody, positiveDecimalString } from "../lib/validation.js";
import { cancelExpense, createExpense } from "../services/expense-service.js";
import { requireIdempotencyKey, type ApiRequest } from "../lib/http.js";

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

@Controller("expenses")
export class ExpenseController {
  @Get()
  async list(@Req() request: ApiRequest, @Query() queryValue: unknown) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const query = parseBody(querySchema, queryValue);
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
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createExpense(
      workspaceId,
      actor.id,
      requireIdempotencyKey(request.headers),
      parseBody(createSchema, body),
    );
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(cancelSchema, body);
    return cancelExpense(workspaceId, actor.id, requireIdempotencyKey(request.headers), id, input.reason);
  }
}
