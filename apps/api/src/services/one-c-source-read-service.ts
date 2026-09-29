import { AuditEntityType } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { prisma } from "../lib/prisma.js";
import { fullSnapshotHash, fullSnapshotSchema } from "./one-c-full-snapshot-service.js";

export type OneCSourceSection = "warehouses" | "receipts" | "contracts" | "specifications" | "production";

/** Exposes only explicitly mapped business fields from the latest applied 1C snapshot. */
export async function readOneCSourceSection(workspaceId: string, actorId: string, section: OneCSourceSection, date?: string) {
  const run = await prisma.oneCSyncRun.findFirst({ where: { workspaceId, source: "1C_FULL_SNAPSHOT",
    summary: { path: ["appliedToOperationalTables"], equals: true } },
  orderBy: [{ generatedAt: "desc" }, { completedAt: "desc" }], select: { summary: true } });
  const snapshotId = (run?.summary as Record<string, unknown> | null)?.snapshotId;
  if (typeof snapshotId !== "string") return { available: false as const };
  const saved = await prisma.oneCSourceSnapshot.findFirst({ where: { id: snapshotId, workspaceId },
    select: { id: true, sha256: true, sourceInstanceId: true, organizationExternalId: true,
      generatedAt: true, payload: true } });
  if (!saved) throw new ApiError(409, "ONE_C_SOURCE_MISSING", "Снимок 1С для этого запуска не найден");
  const parsed = fullSnapshotSchema.shape.snapshot.safeParse(saved.payload);
  if (!parsed.success || fullSnapshotHash(parsed.data) !== saved.sha256) {
    throw new ApiError(409, "ONE_C_SOURCE_INVALID", "Целостность снимка 1С не подтверждена");
  }
  const snapshot = parsed.data;
  const materialNames = new Map(snapshot.materials.map((row) => [row.externalId, row.name.trim()]));
  const warehouseNames = new Map((snapshot.warehouses ?? []).map((row) => [row.externalId, row.name.trim()]));
  const counterpartyNames = new Map(snapshot.counterparties.map((row) => [row.externalId, row.name.trim()]));
  const specificationNames = new Map((snapshot.specifications ?? []).map((row) => [row.externalId, row.name.trim()]));
  const materialName = (id: string) => materialNames.get(id) ?? id;
  let items: unknown[];
  switch (section) {
    case "warehouses":
      items = (snapshot.warehouses ?? []).map((row) => ({ externalId: row.externalId, code: row.code,
        name: row.name.trim(), deleted: row.deleted }));
      break;
    case "receipts":
      items = snapshot.receipts.filter((row) => row.organizationId === saved.organizationExternalId
        && (date === undefined || row.receivedAt.slice(0, 10) === date))
        .map((row) => ({ documentId: row.documentId, lineNumber: row.lineNumber, number: row.number,
          receivedAt: row.receivedAt, posted: row.posted, deleted: row.deleted,
          supplierId: row.supplierId, supplier: counterpartyNames.get(row.supplierId) ?? row.supplierId,
          warehouseId: row.warehouseId, warehouse: warehouseNames.get(row.warehouseId) ?? row.warehouseId,
          materialId: row.materialId, material: materialName(row.materialId), unitName: row.unitName,
          quantity: row.quantity, unitPrice: row.unitPrice, amount: row.amount, vatAmount: row.vatAmount,
          currencyName: row.currencyName }));
      break;
    case "contracts":
      items = (snapshot.contracts ?? []).filter((row) => row.organizationId === saved.organizationExternalId)
        .map((row) => ({ externalId: row.externalId, code: row.code, name: row.name.trim(),
          counterpartyId: row.counterpartyId, counterparty: counterpartyNames.get(row.counterpartyId) ?? row.counterpartyId,
          contractNumber: row.contractNumber, contractAt: row.contractAt, deleted: row.deleted }));
      break;
    case "specifications":
      items = (snapshot.specifications ?? []).map((row) => ({ externalId: row.externalId, code: row.code,
        name: row.name.trim(), materialId: row.materialId, material: materialName(row.materialId),
        quantity: row.quantity, deleted: row.deleted,
        components: (snapshot.specificationComponents ?? []).filter((part) => part.specificationId === row.externalId)
          .map((part) => ({ lineNumber: part.lineNumber, materialId: part.materialId,
            material: materialName(part.materialId), quantity: part.quantity })) }));
      break;
    case "production": {
      const productsByDocument = new Map<string, typeof snapshot.productionProducts>();
      for (const product of snapshot.productionProducts ?? []) {
        const products = productsByDocument.get(product.documentId) ?? [];
        products.push(product);
        productsByDocument.set(product.documentId, products);
      }
      items = (snapshot.productionReports ?? []).filter((row) => row.organizationId === saved.organizationExternalId
        && (date === undefined || row.documentAt.slice(0, 10) === date))
        .map((row) => ({ externalId: row.externalId, number: row.number, documentAt: row.documentAt,
          posted: row.posted, deleted: row.deleted, warehouseId: row.warehouseId,
          warehouse: warehouseNames.get(row.warehouseId) ?? row.warehouseId,
          products: (productsByDocument.get(row.externalId) ?? [])
            .map((product) => ({ lineNumber: product.lineNumber, materialId: product.materialId,
              material: materialName(product.materialId), quantity: product.quantity,
              plannedUnitCost: product.plannedUnitCost, plannedAmount: product.plannedAmount,
              specificationId: product.specificationId,
              specification: specificationNames.get(product.specificationId) ?? product.specificationId })) }));
      break;
    }
  }
  await prisma.auditLog.create({ data: { workspaceId, actorId, action: "ONE_C_SOURCE_SECTION_READ",
    entityType: AuditEntityType.ONE_C_SYNC, entityId: saved.id, metadata: { section, rowCount: items.length } } });
  return { available: true as const, source: "1C" as const, sourceInstanceId: saved.sourceInstanceId,
    snapshotAt: saved.generatedAt.toISOString(), readStartedAt: snapshot.readStartedAt,
    consistency: snapshot.consistency, section, items };
}
