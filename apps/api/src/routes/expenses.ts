import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import {
  AuditEntityType,
  ExpenseCategory,
  ExpenseCostCenter,
  ExpensePaymentMethod,
  ExpenseStatus,
  Prisma,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import {
  MAX_EXPENSE_RECEIPT_BYTES,
  readStoredReceipt,
  removeStoredReceipt,
  safeReceiptName,
  storeExpenseReceipt,
  type ExpenseReceiptUpload,
} from "../lib/receipt-storage.js";
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
          attachments: { orderBy: { createdAt: "desc" } },
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

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const expense = await prisma.expense.findFirst({
      where: { id, workspaceId },
      include: {
        createdBy: { select: { id: true, name: true } },
        cancelledBy: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: "desc" } },
      },
    });
    if (expense === null) throw new ApiError(404, "EXPENSE_NOT_FOUND", "Расход не найден");
    return expense;
  }

  @Post(":id/receipts")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_EXPENSE_RECEIPT_BYTES } }))
  async uploadReceipt(
    @Req() request: ApiRequest,
    @Param("id") id: string,
    @UploadedFile() file: ExpenseReceiptUpload | undefined,
  ) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const expense = await prisma.expense.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (expense === null) throw new ApiError(404, "EXPENSE_NOT_FOUND", "Расход не найден");
    if (file === undefined) throw new ApiError(400, "EXPENSE_RECEIPT_REQUIRED", "Выберите файл чека Kaspi");
    const stored = await storeExpenseReceipt(workspaceId, expense.id, file);
    try {
      return await prisma.$transaction(async (tx) => {
        const attachment = await tx.attachment.create({
          data: {
            expenseId: expense.id,
            name: safeReceiptName(file.originalname),
            storageKey: stored.storageKey,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
          },
        });
        await writeAudit(tx, {
          workspaceId,
          actorId: actor.id,
          action: "EXPENSE_RECEIPT_ATTACHED",
          entityType: AuditEntityType.EXPENSE,
          entityId: expense.id,
          after: {
            attachmentId: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          },
        });
        return attachment;
      });
    } catch (cause) {
      await removeStoredReceipt(stored.storageKey);
      throw cause;
    }
  }

  @Get(":id/receipts/:receiptId/file")
  async openReceipt(
    @Req() request: ApiRequest,
    @Param("id") id: string,
    @Param("receiptId") receiptId: string,
    @Res() response: Response,
  ): Promise<void> {
    const { workspaceId } = await getRequestContext(request, prisma);
    const attachment = await prisma.attachment.findFirst({
      where: { id: receiptId, expenseId: id, expense: { workspaceId } },
    });
    if (attachment === null) throw new ApiError(404, "EXPENSE_RECEIPT_NOT_FOUND", "Чек расхода не найден");
    const file = await readStoredReceipt(attachment.storageKey);
    response.setHeader("Content-Type", attachment.mimeType);
    response.setHeader("Content-Length", String(file.length));
    response.setHeader("Cache-Control", "private, max-age=300");
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);
    response.send(file);
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
