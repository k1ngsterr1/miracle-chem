import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  AuditEntityType,
  MaterialType,
  OneCSyncEntityType,
  OneCSyncReviewStatus,
  OneCSyncRunStatus,
  type Prisma,
  type Unit,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { receiveMaterial } from "./material-service.js";

const sourceId = z.string().trim().min(1).max(200);
const date = z.coerce.date();

const customerSchema = z.object({
  externalId: sourceId,
  updatedAt: date,
  name: z.string().trim().min(1).max(250),
  taxId: z.string().trim().max(50).optional(),
  contactPerson: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(250).optional(),
  address: z.string().trim().max(1000).optional(),
  active: z.boolean().optional(),
});

const supplierSchema = z.object({
  externalId: sourceId,
  updatedAt: date,
  name: z.string().trim().min(1).max(250),
  taxId: z.string().trim().max(50).optional(),
  contact: z.string().trim().max(250).optional(),
  active: z.boolean().optional(),
});

export const oneCMaterialSchema = z.object({
  externalId: sourceId,
  updatedAt: date,
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(250),
  type: z.nativeEnum(MaterialType),
  baseUnit: z.enum(["G", "KG", "T", "ML", "L", "M3", "PCS"]),
  costPerBaseUnit: z.string().regex(/^\d+(?:\.\d+)?$/u).optional(),
  currency: z.string().trim().length(3).optional(),
  densityKgPerM3: z.string().regex(/^\d+(?:\.\d+)?$/u).optional(),
  minimumStock: z.string().regex(/^\d+(?:\.\d+)?$/u).optional(),
  /** Set only by an approved 1C mapping table, never inferred from a display name. */
  productionEligible: z.boolean(),
});

const receiptSchema = z.object({
  externalId: sourceId,
  updatedAt: date,
  posted: z.boolean(),
  number: z.string().trim().min(1).max(100),
  receivedAt: date,
  materialExternalId: sourceId,
  supplierExternalId: sourceId.optional(),
  lotNumber: z.string().trim().min(1).max(100),
  quantity: z.string().regex(/^\d+(?:\.\d+)?$/u),
  unit: z.enum(["G", "KG", "T", "ML", "L", "M3", "PCS"]),
  unitCost: z.string().regex(/^\d+(?:\.\d+)?$/u),
  currency: z.string().trim().length(3).optional(),
  expiresAt: date.optional(),
  certificateNumber: z.string().trim().max(120).optional(),
});

export const oneCDeltaSchema = z.object({
  workspaceId: z.string().uuid(),
  batchId: z.string().trim().min(1).max(160),
  generatedAt: date,
  source: z.literal("1C").default("1C"),
  customers: z.array(customerSchema).max(2_000).default([]),
  suppliers: z.array(supplierSchema).max(2_000).default([]),
  materials: z.array(oneCMaterialSchema).max(10_000).default([]),
  receipts: z.array(receiptSchema).max(20_000).default([]),
});

export type OneCDelta = z.infer<typeof oneCDeltaSchema>;
type OneCMaterialDelta = z.infer<typeof oneCMaterialSchema>;
type SyncSummary = {
  created: number;
  updated: number;
  skipped: number;
  quarantined: number;
  errors: Array<{ entity: string; externalId: string; message: string }>;
};

export function requireOneCSyncKey(value: string | string[] | undefined): void {
  if (config.oneCSyncApiKey.length < 32) {
    throw new ApiError(503, "ONE_C_SYNC_NOT_CONFIGURED", "Ключ синхронизации 1С не настроен на сервере");
  }
  const supplied = typeof value === "string" ? value : "";
  const expected = Buffer.from(config.oneCSyncApiKey);
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new ApiError(401, "ONE_C_SYNC_FORBIDDEN", "Запрос синхронизации 1С не подтверждён");
  }
}

export function requireOneCSyncBinding(input: { workspaceId: string; sourceInstanceId?: string; organizationExternalId?: string }): void {
  if (config.nodeEnv === "production" && (!config.oneCSyncWorkspaceId || !config.oneCSyncSourceInstanceId || !config.oneCSyncOrganizationId)) {
    throw new ApiError(503, "ONE_C_BINDING_NOT_CONFIGURED", "Привязка агента 1С к контуру не настроена");
  }
  if (config.oneCSyncWorkspaceId && input.workspaceId.toLowerCase() !== config.oneCSyncWorkspaceId.toLowerCase()) {
    throw new ApiError(403, "ONE_C_WORKSPACE_FORBIDDEN", "Ключ 1С не привязан к этому контуру CRM");
  }
  if (input.sourceInstanceId && config.oneCSyncSourceInstanceId && input.sourceInstanceId.toLowerCase() !== config.oneCSyncSourceInstanceId.toLowerCase()) {
    throw new ApiError(403, "ONE_C_SOURCE_FORBIDDEN", "Ключ 1С не привязан к этой базе 1С");
  }
  if (input.organizationExternalId && config.oneCSyncOrganizationId && input.organizationExternalId.toLowerCase() !== config.oneCSyncOrganizationId.toLowerCase()) {
    throw new ApiError(403, "ONE_C_ORGANIZATION_FORBIDDEN", "Ключ 1С не привязан к этой организации");
  }
}

export async function syncOneCDelta(input: OneCDelta) {
  const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { id: true } });
  if (workspace === null) throw new ApiError(404, "WORKSPACE_NOT_FOUND", "Контур CRM не найден");

  const existing = await prisma.oneCSyncRun.findUnique({
    where: { workspaceId_source_batchId: { workspaceId: input.workspaceId, source: input.source, batchId: input.batchId } },
  });
  if (existing?.status === OneCSyncRunStatus.COMPLETED || existing?.status === OneCSyncRunStatus.PARTIAL) {
    return { replayed: true, runId: existing.id, status: existing.status, summary: existing.summary };
  }

  const run = existing === null
    ? await prisma.oneCSyncRun.create({
        data: { workspaceId: input.workspaceId, source: input.source, batchId: input.batchId, generatedAt: input.generatedAt },
      })
    : await prisma.oneCSyncRun.update({
        where: { id: existing.id },
        data: { generatedAt: input.generatedAt, status: OneCSyncRunStatus.PROCESSING, summary: undefined, error: undefined, completedAt: null },
      });

  const summary: SyncSummary = { created: 0, updated: 0, skipped: 0, quarantined: 0, errors: [] };
  try {
    await prisma.$transaction(async (tx) => {
      for (const customer of input.customers) {
        await syncCustomer(tx, input.workspaceId, input.source, customer, summary);
      }
      for (const supplier of input.suppliers) {
        await syncSupplier(tx, input.workspaceId, input.source, supplier, summary);
      }
      for (const material of input.materials) {
        await syncMaterial(tx, input.workspaceId, input.source, material, summary);
      }
    });

    for (const receipt of input.receipts) {
      try {
        await syncReceipt(input.workspaceId, input.source, receipt, summary);
      } catch (error) {
        summary.errors.push({ entity: "PURCHASE_RECEIPT", externalId: receipt.externalId, message: errorMessage(error) });
      }
    }

    const status = summary.errors.length > 0 || summary.quarantined > 0
      ? OneCSyncRunStatus.PARTIAL
      : OneCSyncRunStatus.COMPLETED;
    const completed = await prisma.$transaction(async (tx) => {
      const updated = await tx.oneCSyncRun.update({
        where: { id: run.id },
        data: { status, summary: asJson(summary), completedAt: new Date() },
      });
      await writeAudit(tx, {
        workspaceId: input.workspaceId,
        action: "ONE_C_INCREMENTAL_SYNC_COMPLETED",
        entityType: AuditEntityType.ONE_C_SYNC,
        entityId: updated.id,
        after: asJson({ batchId: input.batchId, status, ...summary }),
      });
      return updated;
    });
    return { replayed: false, runId: completed.id, status: completed.status, summary };
  } catch (error) {
    await prisma.oneCSyncRun.update({
      where: { id: run.id },
      data: { status: OneCSyncRunStatus.FAILED, error: asJson({ message: errorMessage(error) }), completedAt: new Date() },
    });
    throw error;
  }
}

export async function listOneCSyncRuns(workspaceId: string) {
  return prisma.oneCSyncRun.findMany({ where: { workspaceId }, orderBy: { startedAt: "desc" }, take: 100 });
}

export async function listOneCSyncReviews(workspaceId: string) {
  return prisma.oneCSyncReview.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 300 });
}

export async function approveOneCSyncReview(workspaceId: string, actorId: string, reviewId: string, note?: string) {
  const review = await prisma.oneCSyncReview.findFirst({ where: { id: reviewId, workspaceId } });
  if (review === null) throw new ApiError(404, "ONE_C_REVIEW_NOT_FOUND", "Запись проверки 1С не найдена");
  if (review.status !== OneCSyncReviewStatus.PENDING) throw new ApiError(409, "ONE_C_REVIEW_ALREADY_RESOLVED", "Запись проверки уже обработана");
  if (review.entityType !== OneCSyncEntityType.MATERIAL) {
    throw new ApiError(409, "ONE_C_REVIEW_APPROVAL_UNSUPPORTED", "Автоматическое подтверждение доступно только для номенклатуры");
  }
  const material = oneCMaterialSchema.parse(review.payload);
  const summary: SyncSummary = { created: 0, updated: 0, skipped: 0, quarantined: 0, errors: [] };
  await prisma.$transaction(async (tx) => {
    await syncMaterial(tx, workspaceId, review.source, { ...material, productionEligible: true }, summary);
    await tx.oneCSyncReview.update({
      where: { id: review.id },
      data: { status: OneCSyncReviewStatus.APPROVED, resolvedAt: new Date(), resolvedById: actorId, resolutionNote: note?.trim() || null },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "ONE_C_MATERIAL_APPROVED",
      entityType: AuditEntityType.ONE_C_SYNC,
      entityId: review.id,
      after: asJson({ externalId: material.externalId, materialCode: material.code, note: note?.trim() || null }),
    });
  });
  return { reviewId: review.id, ...summary };
}

export async function rejectOneCSyncReview(workspaceId: string, actorId: string, reviewId: string, note: string) {
  const review = await prisma.oneCSyncReview.findFirst({ where: { id: reviewId, workspaceId } });
  if (review === null) throw new ApiError(404, "ONE_C_REVIEW_NOT_FOUND", "Запись проверки 1С не найдена");
  if (review.status !== OneCSyncReviewStatus.PENDING) throw new ApiError(409, "ONE_C_REVIEW_ALREADY_RESOLVED", "Запись проверки уже обработана");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.oneCSyncReview.update({
      where: { id: review.id },
      data: { status: OneCSyncReviewStatus.REJECTED, resolvedAt: new Date(), resolvedById: actorId, resolutionNote: note.trim() },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "ONE_C_RECORD_REJECTED",
      entityType: AuditEntityType.ONE_C_SYNC,
      entityId: updated.id,
      after: asJson({ externalId: updated.externalId, entityType: updated.entityType, note: updated.resolutionNote }),
    });
    return updated;
  });
}

async function syncCustomer(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  source: string,
  input: z.infer<typeof customerSchema>,
  summary: SyncSummary,
) {
  const reference = await getReference(tx, workspaceId, source, OneCSyncEntityType.CUSTOMER, input.externalId);
  if (shouldSkip(reference, input.updatedAt)) return void (summary.skipped += 1);
  if (reference === null && await tx.customer.findUnique({ where: { workspaceId_name: { workspaceId, name: input.name } }, select: { id: true } }) !== null) {
    await quarantine(tx, workspaceId, source, OneCSyncEntityType.CUSTOMER, input.externalId, input, "Клиент с таким именем уже существует без этой связи 1С — требуется явное сопоставление");
    summary.quarantined += 1;
    return;
  }
  const data = {
    name: input.name,
    ...(input.taxId === undefined ? {} : { taxId: input.taxId }),
    ...(input.contactPerson === undefined ? {} : { contactPerson: input.contactPerson }),
    ...(input.phone === undefined ? {} : { phone: input.phone }),
    ...(input.email === undefined ? {} : { email: input.email }),
    ...(input.address === undefined ? {} : { address: input.address }),
    active: input.active ?? true,
  };
  const record = reference === null
    ? await tx.customer.create({ data: { workspaceId, ...data } })
    : await tx.customer.update({ where: { id: reference.internalId }, data });
  await saveReference(tx, workspaceId, source, OneCSyncEntityType.CUSTOMER, input.externalId, record.id, input.updatedAt, input);
  summary[reference === null ? "created" : "updated"] += 1;
}

async function syncSupplier(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  source: string,
  input: z.infer<typeof supplierSchema>,
  summary: SyncSummary,
) {
  const reference = await getReference(tx, workspaceId, source, OneCSyncEntityType.SUPPLIER, input.externalId);
  if (shouldSkip(reference, input.updatedAt)) return void (summary.skipped += 1);
  if (reference === null && await tx.supplier.findUnique({ where: { workspaceId_name: { workspaceId, name: input.name } }, select: { id: true } }) !== null) {
    await quarantine(tx, workspaceId, source, OneCSyncEntityType.SUPPLIER, input.externalId, input, "Поставщик с таким именем уже существует без этой связи 1С — требуется явное сопоставление");
    summary.quarantined += 1;
    return;
  }
  const data = { name: input.name, ...(input.taxId === undefined ? {} : { taxId: input.taxId }), ...(input.contact === undefined ? {} : { contact: input.contact }), active: input.active ?? true };
  const record = reference === null
    ? await tx.supplier.create({ data: { workspaceId, ...data } })
    : await tx.supplier.update({ where: { id: reference.internalId }, data });
  await saveReference(tx, workspaceId, source, OneCSyncEntityType.SUPPLIER, input.externalId, record.id, input.updatedAt, input);
  summary[reference === null ? "created" : "updated"] += 1;
}

async function syncMaterial(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  source: string,
  input: OneCMaterialDelta,
  summary: SyncSummary,
) {
  const reference = await getReference(tx, workspaceId, source, OneCSyncEntityType.MATERIAL, input.externalId);
  if (shouldSkip(reference, input.updatedAt)) return void (summary.skipped += 1);
  if (!input.productionEligible) {
    await quarantine(tx, workspaceId, source, OneCSyncEntityType.MATERIAL, input.externalId, input, "Номенклатура не подтверждена как производственный реагент");
    summary.quarantined += 1;
    return;
  }
  if (reference === null) {
    const sameCode = await tx.material.findUnique({ where: { workspaceId_code: { workspaceId, code: input.code } }, select: { id: true } });
    if (sameCode !== null) {
      await quarantine(tx, workspaceId, source, OneCSyncEntityType.MATERIAL, input.externalId, input, "Код номенклатуры уже занят без связи с 1С — требуется ручное сопоставление");
      summary.quarantined += 1;
      return;
    }
  }
  const data = {
    code: input.code,
    name: input.name,
    type: input.type,
    baseUnit: input.baseUnit as Unit,
    ...(input.costPerBaseUnit === undefined ? {} : { costPerBaseUnit: input.costPerBaseUnit }),
    ...(input.currency === undefined ? {} : { currency: input.currency }),
    ...(input.minimumStock === undefined ? {} : { minimumStock: input.minimumStock }),
    ...(input.densityKgPerM3 === undefined ? {} : { densityKgPerM3: input.densityKgPerM3 }),
    active: true,
  };
  const record = reference === null
    ? await tx.material.create({ data: { workspaceId, ...data, costPerBaseUnit: input.costPerBaseUnit ?? "0" } })
    : await tx.material.update({ where: { id: reference.internalId }, data });
  await saveReference(tx, workspaceId, source, OneCSyncEntityType.MATERIAL, input.externalId, record.id, input.updatedAt, input);
  summary[reference === null ? "created" : "updated"] += 1;
}

async function syncReceipt(
  workspaceId: string,
  source: string,
  input: z.infer<typeof receiptSchema>,
  summary: SyncSummary,
) {
  const reference = await prisma.oneCExternalReference.findUnique({
    where: { workspaceId_source_entityType_externalId: { workspaceId, source, entityType: OneCSyncEntityType.PURCHASE_RECEIPT, externalId: input.externalId } },
  });
  if (shouldSkip(reference, input.updatedAt)) return void (summary.skipped += 1);
  if (reference !== null) {
    await prisma.$transaction((tx) => quarantine(tx, workspaceId, source, OneCSyncEntityType.PURCHASE_RECEIPT, input.externalId, input, "Проведённое поступление изменено в 1С: оформите корректировку, остатки не переписываются автоматически"));
    summary.quarantined += 1;
    return;
  }
  if (!input.posted) return void (summary.skipped += 1);
  const [materialReference, supplierReference] = await Promise.all([
    prisma.oneCExternalReference.findUnique({ where: { workspaceId_source_entityType_externalId: { workspaceId, source, entityType: OneCSyncEntityType.MATERIAL, externalId: input.materialExternalId } } }),
    input.supplierExternalId === undefined
      ? null
      : prisma.oneCExternalReference.findUnique({ where: { workspaceId_source_entityType_externalId: { workspaceId, source, entityType: OneCSyncEntityType.SUPPLIER, externalId: input.supplierExternalId } } }),
  ]);
  if (materialReference === null) {
    await prisma.$transaction((tx) => quarantine(tx, workspaceId, source, OneCSyncEntityType.PURCHASE_RECEIPT, input.externalId, input, "Поступление ссылается на неподтверждённую или неизвестную номенклатуру"));
    summary.quarantined += 1;
    return;
  }
  const existingLot = await prisma.materialLot.findFirst({ where: { workspaceId, materialId: materialReference.internalId, lotNumber: input.lotNumber }, select: { id: true } });
  if (existingLot !== null) {
    await prisma.$transaction((tx) => quarantine(tx, workspaceId, source, OneCSyncEntityType.PURCHASE_RECEIPT, input.externalId, input, "Номер складской партии уже существует без связи с 1С — требуется ручная сверка"));
    summary.quarantined += 1;
    return;
  }
  const result = await receiveMaterial(workspaceId, undefined, `1c:${input.externalId}`, {
    materialId: materialReference.internalId,
    ...(supplierReference === null ? {} : { supplierId: supplierReference.internalId }),
    lotNumber: input.lotNumber,
    receivedAt: input.receivedAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(input.certificateNumber === undefined ? {} : { certificateNumber: input.certificateNumber }),
    quantity: input.quantity,
    unit: input.unit as Unit,
    unitCost: input.unitCost,
    currency: input.currency,
    qualitySnapshot: asJson({ source: "1C", documentNumber: input.number, externalId: input.externalId }),
  }, "ONE_C") as { materialLotId: string };
  await prisma.$transaction(async (tx) => {
    await saveReference(tx, workspaceId, source, OneCSyncEntityType.PURCHASE_RECEIPT, input.externalId, result.materialLotId, input.updatedAt, input);
  });
  summary.created += 1;
}

async function getReference(tx: Prisma.TransactionClient, workspaceId: string, source: string, entityType: OneCSyncEntityType, externalId: string) {
  return tx.oneCExternalReference.findUnique({ where: { workspaceId_source_entityType_externalId: { workspaceId, source, entityType, externalId } } });
}

function shouldSkip(reference: { sourceUpdatedAt: Date } | null, updatedAt: Date): boolean {
  return reference !== null && reference.sourceUpdatedAt.getTime() >= updatedAt.getTime();
}

async function saveReference(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  source: string,
  entityType: OneCSyncEntityType,
  externalId: string,
  internalId: string,
  sourceUpdatedAt: Date,
  payload: unknown,
) {
  const payloadHash = hashPayload(payload);
  await tx.oneCExternalReference.upsert({
    where: { workspaceId_source_entityType_externalId: { workspaceId, source, entityType, externalId } },
    create: { workspaceId, source, entityType, externalId, internalId, sourceUpdatedAt, payloadHash },
    update: { internalId, sourceUpdatedAt, payloadHash, lastSyncedAt: new Date() },
  });
}

async function quarantine(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  source: string,
  entityType: OneCSyncEntityType,
  externalId: string,
  payload: unknown,
  reason: string,
) {
  await tx.oneCSyncReview.upsert({
    where: { workspaceId_source_entityType_externalId: { workspaceId, source, entityType, externalId } },
    create: { workspaceId, source, entityType, externalId, payload: asJson(payload), reason },
    update: { payload: asJson(payload), reason, status: OneCSyncReviewStatus.PENDING, resolvedAt: null, resolvedById: null, resolutionNote: null },
  });
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : "Неизвестная ошибка синхронизации";
}
