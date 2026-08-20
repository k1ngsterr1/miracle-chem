import { randomUUID } from "node:crypto";
import {
  AuditEntityType,
  ExpenseStatus,
  type ExpenseCategory,
  type ExpenseCostCenter,
  type ExpensePaymentMethod,
  type Prisma,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import { runIdempotent } from "../lib/idempotency.js";

export interface CreateExpenseInput {
  category: ExpenseCategory;
  costCenter: ExpenseCostCenter;
  paymentMethod: ExpensePaymentMethod;
  incurredAt: Date;
  amount: string;
  currency?: string;
  description: string;
  counterparty?: string;
  documentNumber?: string;
  note?: string;
}

export async function createExpense(
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
  input: CreateExpenseInput,
) {
  return prisma.$transaction(async (tx) => runIdempotent(tx, {
    workspaceId,
    scope: "expense:create",
    key: idempotencyKey,
    payload: input,
  }, async () => {
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const expense = await tx.expense.create({
      data: {
        workspaceId,
        number: expenseNumber(input.incurredAt),
        category: input.category,
        costCenter: input.costCenter,
        paymentMethod: input.paymentMethod,
        incurredAt: input.incurredAt,
        amount: input.amount,
        currency: input.currency ?? workspace.currency,
        description: input.description,
        counterparty: input.counterparty ?? null,
        documentNumber: input.documentNumber ?? null,
        note: input.note ?? null,
        createdById: actorId,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    const response = jsonValue(expense);
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "EXPENSE_RECORDED",
      entityType: AuditEntityType.EXPENSE,
      entityId: expense.id,
      after: response,
    });
    return response;
  }));
}

export async function cancelExpense(
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
  expenseId: string,
  reason: string,
) {
  return prisma.$transaction(async (tx) => runIdempotent(tx, {
    workspaceId,
    scope: `expense:${expenseId}:cancel`,
    key: idempotencyKey,
    payload: { expenseId, reason },
  }, async () => {
    const expense = await tx.expense.findFirst({ where: { id: expenseId, workspaceId } });
    if (expense === null) throw new ApiError(404, "EXPENSE_NOT_FOUND", "Расход не найден");
    if (expense.status === ExpenseStatus.CANCELLED) {
      throw new ApiError(409, "EXPENSE_ALREADY_CANCELLED", "Расход уже отменён");
    }
    const cancelledAt = new Date();
    const updated = await tx.expense.update({
      where: { id: expense.id },
      data: {
        status: ExpenseStatus.CANCELLED,
        cancelledAt,
        cancelledById: actorId,
        cancellationReason: reason,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        cancelledBy: { select: { id: true, name: true } },
      },
    });
    const response = jsonValue(updated);
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "EXPENSE_CANCELLED",
      entityType: AuditEntityType.EXPENSE,
      entityId: expense.id,
      before: { status: expense.status },
      after: { status: updated.status, cancelledAt: cancelledAt.toISOString(), reason },
    });
    return response;
  }));
}

function expenseNumber(date: Date): string {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `RSH-${day}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
