import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import {
  AccountingDocumentStatus,
  AccountingDocumentType,
  Prisma,
  UserRole,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { accountingDocumentPdfName, createAccountingDocumentPdf } from "../lib/accounting-document-pdf.js";
import { requireIdempotencyKey, type ApiRequest } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { canAccessOwnDocumentsOnly, requirePermission } from "../lib/permissions.js";
import { createPowerOfAttorneyHtml } from "../lib/power-of-attorney-print.js";
import { getRequestContext } from "../lib/request-context.js";
import { nonNegativeDecimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import {
  cancelAccountingDocument,
  approveAccountingDocument,
  createAccountingDocument,
  issueAccountingDocument,
  payAccountingDocument,
  submitAccountingDocument,
} from "../services/accounting-service.js";

const powerOfAttorneySchema = z.object({
  representativeName: z.string().trim().min(2).max(250),
  representativePosition: z.string().trim().max(160).optional(),
  representativeIin: z.string().trim().max(20).optional(),
  identityDocument: z.string().trim().min(2).max(160),
  identityIssuedBy: z.string().trim().min(2).max(250),
  identityIssuedAt: z.coerce.date(),
});

const createSchema = z.object({
  number: z.string().trim().max(80).optional(),
  type: z.nativeEnum(AccountingDocumentType),
  documentAt: z.coerce.date(),
  dueAt: z.coerce.date().optional(),
  customerId: z.string().uuid().optional(),
  counterparty: z.string().trim().min(2).max(250).optional(),
  counterpartyTaxId: z.string().trim().max(40).optional(),
  basis: z.string().trim().max(500).optional(),
  vatRate: nonNegativeDecimalString.optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  transferId: z.string().uuid().optional(),
  expenseId: z.string().uuid().optional(),
  powerOfAttorney: powerOfAttorneySchema.optional(),
  notes: z.string().trim().max(3000).optional(),
  items: z.array(z.object({
    description: z.string().trim().min(2).max(500),
    quantity: positiveDecimalString,
    unit: z.string().trim().min(1).max(20),
    unitPrice: nonNegativeDecimalString,
  })).min(1).max(250),
}).superRefine((input, context) => {
  const isSalesDocument = input.type === AccountingDocumentType.WAYBILL
    || input.type === AccountingDocumentType.PAYMENT_INVOICE
    || input.type === AccountingDocumentType.COMPLETION_ACT;
  if (isSalesDocument && input.customerId === undefined && input.transferId === undefined) {
    context.addIssue({ code: "custom", path: ["customerId"], message: "Для документа выберите клиента или связанную отгрузку" });
  }
  if (!isSalesDocument && input.customerId === undefined && input.counterparty === undefined) {
    context.addIssue({ code: "custom", path: ["counterparty"], message: "Укажите контрагента" });
  }
  if (input.type !== AccountingDocumentType.POWER_OF_ATTORNEY) return;
  if (input.dueAt === undefined) {
    context.addIssue({ code: "custom", path: ["dueAt"], message: "Укажите срок действия доверенности" });
  }
  if (input.powerOfAttorney === undefined) {
    context.addIssue({ code: "custom", path: ["powerOfAttorney"], message: "Заполните данные доверенного лица" });
  }
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
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ACCOUNTING_VIEW");
    const query = parseBody(querySchema, queryValue);
    const where: Prisma.AccountingDocumentWhereInput = {
      workspaceId,
      ...(canAccessOwnDocumentsOnly(actor.role) ? { createdById: actor.id } : {}),
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
          customer: { select: { id: true, name: true, taxId: true, contactPerson: true, address: true } },
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
      prisma.accountingDocument.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.accountingDocument.groupBy({ by: ["type"], where, _count: { _all: true } }),
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

  @Get(":id/print")
  async printPowerOfAttorney(
    @Req() request: ApiRequest,
    @Param("id") id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ACCOUNTING_VIEW");
    const document = await prisma.accountingDocument.findFirst({
      where: { id, workspaceId, ...(canAccessOwnDocumentsOnly(actor.role) ? { createdById: actor.id } : {}) },
      include: { workspace: { include: { companyProfile: true } }, customer: true, items: { orderBy: { position: "asc" } } },
    });
    if (document === null) throw new ApiError(404, "ACCOUNTING_DOCUMENT_NOT_FOUND", "Бухгалтерский документ не найден");
    if (document.type !== AccountingDocumentType.POWER_OF_ATTORNEY) {
      throw new ApiError(409, "PRINT_FORM_NOT_APPLICABLE", "Печатная форма доверенности недоступна для этого документа");
    }
    const basename = `power-of-attorney-${document.number.replaceAll(/[^a-zA-Z0-9_-]/gu, "-")}.html`;
    response
      .type("text/html; charset=utf-8")
      .setHeader("content-disposition", `inline; filename="${basename}"`)
      .setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
      .send(createPowerOfAttorneyHtml(document));
  }

  @Get(":id/pdf")
  async pdf(
    @Req() request: ApiRequest,
    @Param("id") id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ACCOUNTING_VIEW");
    const document = await prisma.accountingDocument.findFirst({
      where: { id, workspaceId, ...(canAccessOwnDocumentsOnly(actor.role) ? { createdById: actor.id } : {}) },
      include: {
        workspace: { include: { companyProfile: true } },
        customer: true,
        items: { orderBy: { position: "asc" } },
      },
    });
    if (document === null) throw new ApiError(404, "ACCOUNTING_DOCUMENT_NOT_FOUND", "Бухгалтерский документ не найден");
    const pdf = await createAccountingDocumentPdf(document);
    response
      .type("application/pdf")
      .setHeader("content-disposition", `attachment; filename="${accountingDocumentPdfName(document)}"`)
      .setHeader("cache-control", "private, no-store")
      .send(pdf);
  }

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ACCOUNTING_VIEW");
    const document = await prisma.accountingDocument.findFirst({
      where: { id, workspaceId, ...(canAccessOwnDocumentsOnly(actor.role) ? { createdById: actor.id } : {}) },
      include: {
        items: { orderBy: { position: "asc" } },
        createdBy: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, taxId: true, contactPerson: true, address: true } },
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
    requirePermission(actor.role, "ACCOUNTING_CREATE");
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
    requirePermission(actor.role, "ACCOUNTING_ISSUE_DIRECTLY");
    await assertDocumentScope(workspaceId, actor, id);
    return issueAccountingDocument(workspaceId, actor.id, requireIdempotencyKey(request.headers), id);
  }

  @Post(":id/submit")
  @HttpCode(HttpStatus.OK)
  async submit(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ACCOUNTING_SUBMIT");
    await assertDocumentScope(workspaceId, actor, id);
    return submitAccountingDocument(workspaceId, actor.id, actor.role, requireIdempotencyKey(request.headers), id);
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  async approve(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    await assertDocumentScope(workspaceId, actor, id);
    return approveAccountingDocument(workspaceId, actor.id, actor.role, requireIdempotencyKey(request.headers), id);
  }

  @Post(":id/pay")
  @HttpCode(HttpStatus.OK)
  async pay(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ACCOUNTING_MARK_PAID");
    await assertDocumentScope(workspaceId, actor, id);
    return payAccountingDocument(workspaceId, actor.id, requireIdempotencyKey(request.headers), id);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ACCOUNTING_CANCEL");
    await assertDocumentScope(workspaceId, actor, id);
    const input = parseBody(cancelSchema, body);
    return cancelAccountingDocument(workspaceId, actor.id, requireIdempotencyKey(request.headers), id, input.reason);
  }
}

async function assertDocumentScope(workspaceId: string, actor: { id: string; role: UserRole }, id: string): Promise<void> {
  const document = await prisma.accountingDocument.findFirst({ where: { id, workspaceId }, select: { id: true, createdById: true } });
  if (document === null) throw new ApiError(404, "ACCOUNTING_DOCUMENT_NOT_FOUND", "Бухгалтерский документ не найден");
  if (canAccessOwnDocumentsOnly(actor.role) && document.createdById !== actor.id) {
    throw new ApiError(403, "DOCUMENT_SCOPE_FORBIDDEN", "Менеджер может работать только со своими документами");
  }
}
