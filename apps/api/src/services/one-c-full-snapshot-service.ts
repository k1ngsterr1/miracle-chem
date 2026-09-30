import { createHash } from "node:crypto";
import { z } from "zod";
import { AuditEntityType, OneCSyncRunStatus, Prisma } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { prisma } from "../lib/prisma.js";
import { projectFullSnapshot } from "./one-c-projection-service.js";

const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u);
const utcDate = z.string().datetime({ offset: true });
const decimal = z.string().regex(/^-?\d{1,38}(?:\.\d{1,20})?$/u);
const row = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const collection = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(2_000);

const document = row({
  externalId: guid, number: z.string(), documentAt: localDate,
  organizationId: guid, counterpartyId: guid, amount: decimal,
  posted: z.boolean(), deleted: z.boolean(),
});
const documentLine = row({
  documentId: guid, lineNumber: z.number().int().positive(), materialId: guid,
  unitId: guid, unitName: z.string(), quantity: decimal, unitPrice: decimal,
  amount: decimal, vatAmount: decimal,
});
const payment = document.extend({ currencyName: z.string(), purpose: z.string() });

export const fullSnapshotSchema = z.object({
  workspaceId: guid,
  sourceInstanceId: guid,
  organizationExternalId: guid,
  batchId: z.string().trim().min(1).max(160),
  generatedAt: utcDate,
  source: z.literal("1C"),
  kind: z.literal("FULL_SNAPSHOT"),
  snapshot: z.object({
    schemaVersion: z.literal(1),
    source: z.literal("1C"),
    configuration: z.literal("БухгалтерияДляКазахстана"),
    configurationVersion: z.string().min(1),
    consistency: z.literal("SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE"),
    readStartedAt: utcDate,
    generatedAt: utcDate,
    organizations: collection(row({ externalId: guid, code: z.string(), name: z.string() })),
    counterparties: collection(row({ externalId: guid, code: z.string(), name: z.string(),
      groupName: z.string().nullable(), taxId: z.string(), deleted: z.boolean() })),
    materials: collection(row({ externalId: guid, code: z.string(), name: z.string(),
      groupName: z.string().nullable(), unitId: guid, unitName: z.string(), service: z.boolean(), deleted: z.boolean() })),
    warehouses: collection(row({ externalId: guid, code: z.string(), name: z.string(), deleted: z.boolean() })).optional(),
    contracts: collection(row({ externalId: guid, code: z.string(), name: z.string(), counterpartyId: guid,
      organizationId: guid, contractNumber: z.string(), contractAt: localDate.nullable(), deleted: z.boolean() })).optional(),
    specifications: collection(row({ externalId: guid, code: z.string(), name: z.string(), materialId: guid,
      quantity: decimal, deleted: z.boolean() })).optional(),
    specificationComponents: collection(row({ specificationId: guid, lineNumber: z.number().int().positive(),
      materialId: guid, quantity: decimal })).optional(),
    productionReports: collection(row({ externalId: guid, number: z.string(), documentAt: localDate,
      organizationId: guid, warehouseId: guid, posted: z.boolean(), deleted: z.boolean() })).optional(),
    productionProducts: collection(row({ documentId: guid, lineNumber: z.number().int().positive(),
      materialId: guid, unitId: guid, quantity: decimal, plannedUnitCost: decimal,
      plannedAmount: decimal, specificationId: guid })).optional(),
    receipts: collection(row({ documentId: guid, lineNumber: z.number().int().positive(), number: z.string(),
      receivedAt: localDate, posted: z.boolean(), deleted: z.boolean(), organizationId: guid,
      supplierId: guid, warehouseId: guid, materialId: guid, unitId: guid, unitName: z.string(),
      coefficient: decimal, quantity: decimal, unitPrice: decimal, amount: decimal, vatAmount: decimal,
      amountIncludesVat: z.boolean(), vatInCost: z.boolean(), currencyName: z.string(),
      exchangeRate: decimal, exchangeMultiplicity: decimal })),
    balances: collection(row({ organizationId: guid, warehouseId: guid, materialId: guid, quantity: decimal })),
    accountingInventory: collection(row({ organizationId: guid, accountCode: z.enum(["1310", "1320", "1330"]),
      materialId: guid, warehouseId: guid, quantityDebit: decimal, quantityCredit: decimal,
      amountDebit: decimal, amountCredit: decimal })),
    receivables: collection(row({ organizationId: guid, counterpartyId: guid, contractId: guid,
      amountDebit: decimal, amountCredit: decimal })),
    sales: collection(document),
    saleLines: collection(documentLine),
    invoices: collection(document),
    invoiceLines: collection(documentLine),
    incomingPayments: collection(payment),
    outgoingPayments: collection(payment),
  }).passthrough(),
});

export type FullSnapshotEnvelope = z.infer<typeof fullSnapshotSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function fullSnapshotHash(snapshot: FullSnapshotEnvelope["snapshot"]): string {
  return createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");
}

export async function receiveFullSnapshot(input: FullSnapshotEnvelope) {
  if (input.generatedAt !== input.snapshot.generatedAt ||
      Date.parse(input.snapshot.readStartedAt) > Date.parse(input.snapshot.generatedAt) ||
      !input.snapshot.organizations.some((item) => item.externalId.toLowerCase() === input.organizationExternalId.toLowerCase())) {
    throw new ApiError(422, "ONE_C_SNAPSHOT_INCONSISTENT", "Организация или время полного снимка 1С не совпадают с пакетом");
  }
  const sha256 = fullSnapshotHash(input.snapshot);
  const source = "1C_FULL_SNAPSHOT";
  try {
    return await prisma.$transaction(async (tx) => {
    const baseline = await tx.oneCSourceSnapshot.findFirst({
      where: { workspaceId: input.workspaceId }, orderBy: { generatedAt: "asc" },
      select: { sourceInstanceId: true, organizationExternalId: true, payload: true },
    });
    if (!baseline || baseline.sourceInstanceId.toLowerCase() !== input.sourceInstanceId.toLowerCase() ||
        baseline.organizationExternalId.toLowerCase() !== input.organizationExternalId.toLowerCase()) {
      throw new ApiError(409, "ONE_C_SOURCE_NOT_APPROVED", "Контур CRM не привязан к этой базе и организации 1С");
    }
    const existing = await tx.oneCSyncRun.findUnique({
      where: { workspaceId_source_batchId: { workspaceId: input.workspaceId, source, batchId: input.batchId } },
    });
    if (existing !== null) {
      const previousHash = (existing.summary as Record<string, unknown> | null)?.sha256;
      if (previousHash !== sha256) throw new ApiError(409, "ONE_C_BATCH_CHANGED", "Повторный batchId содержит другой снимок 1С");
      if (existing.status === OneCSyncRunStatus.COMPLETED) {
        return { status: "COMPLETED" as const, replayed: true, runId: existing.id, sha256 };
      }
    }
    const newest = await tx.oneCSourceSnapshot.findFirst({
      where: { workspaceId: input.workspaceId, sourceInstanceId: input.sourceInstanceId },
      orderBy: { generatedAt: "desc" }, select: { generatedAt: true },
    });
    if (newest && new Date(input.generatedAt) < newest.generatedAt) {
      throw new ApiError(409, "ONE_C_SNAPSHOT_STALE", "Снимок 1С старее уже принятого");
    }
    const saved = await tx.oneCSourceSnapshot.upsert({
      where: { workspaceId_sourceInstanceId_sha256: {
        workspaceId: input.workspaceId, sourceInstanceId: input.sourceInstanceId, sha256,
      } },
      create: { workspaceId: input.workspaceId, sourceInstanceId: input.sourceInstanceId,
        organizationExternalId: input.organizationExternalId, generatedAt: new Date(input.generatedAt),
        sha256, payload: input.snapshot as Prisma.InputJsonValue },
      update: {}, select: { id: true },
    });
    const counts = Object.fromEntries([
      "organizations", "counterparties", "materials", "receipts", "balances", "accountingInventory",
      "receivables", "sales", "saleLines", "invoices", "invoiceLines", "incomingPayments", "outgoingPayments",
      "warehouses", "contracts", "specifications", "specificationComponents", "productionReports", "productionProducts",
    ].map((name) => [name, (input.snapshot[name as keyof typeof input.snapshot] as unknown[] | undefined)?.length ?? 0]));
    const staged = baseline.payload !== null && typeof baseline.payload === "object" &&
      !Array.isArray(baseline.payload) && (baseline.payload as Record<string, unknown>).schemaVersion === 1;
    const projection = staged ? await projectFullSnapshot(tx, input, sha256) : null;
    const summary = { sha256, snapshotId: saved.id, counts, appliedToOperationalTables: projection !== null, projection };
    const runData = { workspaceId: input.workspaceId, source, batchId: input.batchId,
      generatedAt: new Date(input.generatedAt), status: OneCSyncRunStatus.COMPLETED,
      completedAt: new Date(), summary, error: Prisma.DbNull };
    const run = await tx.oneCSyncRun.upsert({
      where: { workspaceId_source_batchId: { workspaceId: input.workspaceId, source, batchId: input.batchId } },
      create: runData, update: runData,
    });
    await tx.auditLog.create({ data: { workspaceId: input.workspaceId,
      action: "ONE_C_FULL_SNAPSHOT_RECEIVED", entityType: AuditEntityType.ONE_C_SYNC,
      entityId: run.id, after: summary } });
    return { status: "COMPLETED" as const, replayed: false, runId: run.id, sha256, summary };
    }, { maxWait: 10_000, timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    // Two identical deliveries can race before either transaction sees the run.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const run = await prisma.oneCSyncRun.findUnique({
        where: { workspaceId_source_batchId: { workspaceId: input.workspaceId, source, batchId: input.batchId } },
      });
      if (run?.status === OneCSyncRunStatus.COMPLETED && (run.summary as Record<string, unknown> | null)?.sha256 === sha256) {
        return { status: "COMPLETED" as const, replayed: true, runId: run.id, sha256 };
      }
    }
    // The projection transaction rolls back entirely. Record the failed attempt separately,
    // without overwriting a concurrent success or accepting a changed batchId on retry.
    const failure = error instanceof ApiError
      ? { code: error.code, message: error.message, details: error.details ?? null }
      : { code: "ONE_C_SNAPSHOT_FAILED", message: "Не удалось применить снимок. Агент повторит временную ошибку." };
    await prisma.oneCSyncRun.createMany({ data: [{ workspaceId: input.workspaceId, source, batchId: input.batchId,
      generatedAt: new Date(input.generatedAt), status: OneCSyncRunStatus.FAILED,
      completedAt: new Date(), summary: { sha256 }, error: failure as Prisma.InputJsonValue }],
      skipDuplicates: true }).then(() => prisma.oneCSyncRun.updateMany({
        where: { workspaceId: input.workspaceId, source, batchId: input.batchId, status: OneCSyncRunStatus.FAILED,
          summary: { path: ["sha256"], equals: sha256 } },
        data: { completedAt: new Date(), error: failure as Prisma.InputJsonValue },
      })).catch(() => { /* Keep the original error if the database is unavailable. */ });
    throw error;
  }
}
