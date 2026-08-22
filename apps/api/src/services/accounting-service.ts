import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  AccountingDocumentStatus,
  AccountingDocumentType,
  AuditEntityType,
  type Prisma,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import { runIdempotent } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";

export interface CreateAccountingDocumentInput {
  number?: string;
  type: AccountingDocumentType;
  documentAt: Date;
  dueAt?: Date;
  counterparty: string;
  counterpartyTaxId?: string;
  basis?: string;
  vatRate?: string;
  currency?: string;
  transferId?: string;
  expenseId?: string;
  notes?: string;
  items: Array<{
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
  }>;
}

const accountingDocumentInclude = {
  items: { orderBy: { position: "asc" as const } },
  createdBy: { select: { id: true, name: true } },
  transfer: { select: { id: true, number: true } },
  expense: { select: { id: true, number: true } },
};

export async function createAccountingDocument(
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
  input: CreateAccountingDocumentInput,
) {
  return prisma.$transaction(async (tx) => runIdempotent(tx, {
    workspaceId,
    scope: "accounting-document:create",
    key: idempotencyKey,
    payload: input,
  }, async () => {
    const [workspace, transfer, expense] = await Promise.all([
      tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      input.transferId === undefined
        ? null
        : tx.lrtTransfer.findFirst({ where: { id: input.transferId, workspaceId }, select: { id: true } }),
      input.expenseId === undefined
        ? null
        : tx.expense.findFirst({ where: { id: input.expenseId, workspaceId }, select: { id: true } }),
    ]);
    if (input.transferId !== undefined && transfer === null) {
      throw new ApiError(422, "TRANSFER_NOT_FOUND", "Связанная отгрузка не найдена");
    }
    if (input.expenseId !== undefined && expense === null) {
      throw new ApiError(422, "EXPENSE_NOT_FOUND", "Связанный расход не найден");
    }

    const calculatedItems = input.items.map((item, position) => {
      const quantity = new Decimal(item.quantity);
      const unitPrice = new Decimal(item.unitPrice);
      return {
        description: item.description,
        quantity: quantity.toString(),
        unit: item.unit,
        unitPrice: unitPrice.toString(),
        amount: quantity.mul(unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
        position,
      };
    });
    const subtotal = calculatedItems.reduce((sum, item) => sum.add(item.amount), new Decimal(0));
    const vatRate = new Decimal(input.vatRate ?? 0);
    const vatAmount = subtotal.mul(vatRate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const totalAmount = subtotal.add(vatAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const document = await tx.accountingDocument.create({
      data: {
        workspaceId,
        number: input.number?.trim() || accountingDocumentNumber(input.type, input.documentAt),
        type: input.type,
        documentAt: input.documentAt,
        dueAt: input.dueAt ?? null,
        counterparty: input.counterparty,
        counterpartyTaxId: input.counterpartyTaxId ?? null,
        basis: input.basis ?? null,
        subtotal: subtotal.toString(),
        vatRate: vatRate.toString(),
        vatAmount: vatAmount.toString(),
        totalAmount: totalAmount.toString(),
        currency: input.currency ?? workspace.currency,
        transferId: transfer?.id ?? null,
        expenseId: expense?.id ?? null,
        notes: input.notes ?? null,
        createdById: actorId,
        items: { create: calculatedItems },
      },
      include: accountingDocumentInclude,
    });
    const response = jsonValue(document);
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "ACCOUNTING_DOCUMENT_CREATED",
      entityType: AuditEntityType.ACCOUNTING_DOCUMENT,
      entityId: document.id,
      after: response,
    });
    return response;
  }));
}

export async function issueAccountingDocument(
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
  documentId: string,
) {
  return transitionAccountingDocument(workspaceId, actorId, idempotencyKey, documentId, {
    allowed: [AccountingDocumentStatus.DRAFT],
    status: AccountingDocumentStatus.ISSUED,
    action: "ACCOUNTING_DOCUMENT_ISSUED",
    data: { issuedAt: new Date() },
  });
}

export async function payAccountingDocument(
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
  documentId: string,
) {
  const document = await prisma.accountingDocument.findFirst({ where: { id: documentId, workspaceId } });
  if (document === null) throw new ApiError(404, "ACCOUNTING_DOCUMENT_NOT_FOUND", "Бухгалтерский документ не найден");
  if (document.type !== AccountingDocumentType.PAYMENT_INVOICE) {
    throw new ApiError(409, "PAYMENT_NOT_APPLICABLE", "Оплату можно отметить только у счёта на оплату");
  }
  return transitionAccountingDocument(workspaceId, actorId, idempotencyKey, documentId, {
    allowed: [AccountingDocumentStatus.ISSUED],
    status: AccountingDocumentStatus.PAID,
    action: "ACCOUNTING_DOCUMENT_PAID",
    data: { paidAt: new Date() },
  });
}

export async function cancelAccountingDocument(
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
  documentId: string,
  reason: string,
) {
  return transitionAccountingDocument(workspaceId, actorId, idempotencyKey, documentId, {
    allowed: [AccountingDocumentStatus.DRAFT, AccountingDocumentStatus.ISSUED],
    status: AccountingDocumentStatus.CANCELLED,
    action: "ACCOUNTING_DOCUMENT_CANCELLED",
    data: { cancelledAt: new Date(), cancellationReason: reason },
  });
}

async function transitionAccountingDocument(
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
  documentId: string,
  transition: {
    allowed: AccountingDocumentStatus[];
    status: AccountingDocumentStatus;
    action: string;
    data: Prisma.AccountingDocumentUpdateInput;
  },
) {
  return prisma.$transaction(async (tx) => runIdempotent(tx, {
    workspaceId,
    scope: `accounting-document:${documentId}:${transition.status.toLowerCase()}`,
    key: idempotencyKey,
    payload: { documentId, status: transition.status },
  }, async () => {
    const document = await tx.accountingDocument.findFirst({ where: { id: documentId, workspaceId } });
    if (document === null) throw new ApiError(404, "ACCOUNTING_DOCUMENT_NOT_FOUND", "Бухгалтерский документ не найден");
    if (!transition.allowed.includes(document.status)) {
      throw new ApiError(409, "INVALID_ACCOUNTING_DOCUMENT_STATUS", "Операция недоступна для текущего статуса документа");
    }
    const updated = await tx.accountingDocument.update({
      where: { id: document.id },
      data: { ...transition.data, status: transition.status },
      include: accountingDocumentInclude,
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: transition.action,
      entityType: AuditEntityType.ACCOUNTING_DOCUMENT,
      entityId: document.id,
      before: { status: document.status },
      after: { status: updated.status },
    });
    return jsonValue(updated);
  }));
}

function accountingDocumentNumber(type: AccountingDocumentType, date: Date): string {
  const prefix = {
    [AccountingDocumentType.WAYBILL]: "NKL",
    [AccountingDocumentType.PAYMENT_INVOICE]: "SCH",
    [AccountingDocumentType.COMPLETION_ACT]: "AKT",
  }[type];
  const day = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${day}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
