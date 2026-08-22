import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import {
  AccountingDocumentStatus,
  AccountingDocumentType,
  Prisma,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { requireIdempotencyKey, type ApiRequest } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { nonNegativeDecimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import {
  cancelAccountingDocument,
  createAccountingDocument,
  issueAccountingDocument,
  payAccountingDocument,
} from "../services/accounting-service.js";

const createSchema = z.object({
  number: z.string().trim().max(80).optional(),
  type: z.nativeEnum(AccountingDocumentType),
  documentAt: z.coerce.date(),
  dueAt: z.coerce.date().optional(),
  counterparty: z.string().trim().min(2).max(250),
  counterpartyTaxId: z.string().trim().max(40).optional(),
  basis: z.string().trim().max(500).optional(),
  vatRate: nonNegativeDecimalString.optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  transferId: z.string().uuid().optional(),
  expenseId: z.string().uuid().optional(),
  notes: z.string().trim().max(3000).optional(),
  items: z.array(z.object({
    description: z.string().trim().min(2).max(500),
    quantity: positiveDecimalString,
    unit: z.string().trim().min(1).max(20),
    unitPrice: nonNegativeDecimalString,
  })).min(1).max(250),
});

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  type: z.nativeEnum(AccountingDocumentType).optional(),
  status: z.nativeEnum(AccountingDocumentStatus).optional(),
  search: z.string().trim().max(200).optional(),
});

const cancelSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

@Controller("accounting")
export class AccountingController {
  @Get()
  async list(@Req() request: ApiRequest, @Query() queryValue: unknown) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const query = parseBody(querySchema, queryValue);
    const where: Prisma.AccountingDocumentWhereInput = {
      workspaceId,
      ...(query.from === undefined && query.to === undefined ? {} : {
        documentAt: {
          ...(query.from === undefined ? {} : { gte: query.from }),
          ...(query.to === undefined ? {} : { lte: query.to }),
        },
      }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined || query.search === "" ? {} : {
        OR: [
          { number: { contains: query.search, mode: "insensitive" } },
          { counterparty: { contains: query.search, mode: "insensitive" } },
          { basis: { contains: query.search, mode: "insensitive" } },
        ],
      }),
    };
    const [items, totals, byStatus, byType] = await Promise.all([
      prisma.accountingDocument.findMany({
        where,
        include: {
          items: { orderBy: { position: "asc" } },
          createdBy: { select: { id: true, name: true } },
          transfer: { select: { id: true, number: true } },
          expense: { select: { id: true, number: true } },
        },
        orderBy: [{ documentAt: "desc" }, { createdAt: "desc" }],
        take: 500,
      }),
      prisma.accountingDocument.groupBy({
        by: ["currency"],
        where: { ...where, status: { not: AccountingDocumentStatus.CANCELLED } },
        _sum: { totalAmount: true },
      }),
      prisma.accountingDocument.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
      prisma.accountingDocument.groupBy({ by: ["type"], where: { workspaceId }, _count: { _all: true } }),
    ]);
    return {
      items,
      summary: {
        totals: totals.map((item) => ({ currency: item.currency, amount: item._sum.totalAmount?.toString() ?? "0" })),
        byStatus: byStatus.map((item) => ({ status: item.status, count: item._count._all })),
        byType: byType.map((item) => ({ type: item.type, count: item._count._all })),
      },
    };
  }

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const document = await prisma.accountingDocument.findFirst({
      where: { id, workspaceId },
      include: {
        items: { orderBy: { position: "asc" } },
        createdBy: { select: { id: true, name: true } },
        transfer: { select: { id: true, number: true } },
        expense: { select: { id: true, number: true } },
      },
    });
    if (document === null) throw new ApiError(404, "ACCOUNTING_DOCUMENT_NOT_FOUND", "Бухгалтерский документ не найден");
    return document;
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createAccountingDocument(
      workspaceId,
      actor.id,
      requireIdempotencyKey(request.headers),
      parseBody(createSchema, body),
    );
  }

  @Post(":id/issue")
  @HttpCode(HttpStatus.OK)
  async issue(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return issueAccountingDocument(workspaceId, actor.id, requireIdempotencyKey(request.headers), id);
  }

  @Post(":id/pay")
  @HttpCode(HttpStatus.OK)
  async pay(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return payAccountingDocument(workspaceId, actor.id, requireIdempotencyKey(request.headers), id);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(cancelSchema, body);
    return cancelAccountingDocument(workspaceId, actor.id, requireIdempotencyKey(request.headers), id, input.reason);
  }
}
