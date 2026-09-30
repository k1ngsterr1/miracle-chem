import { createHash } from "node:crypto";
import { MaterialType, OneCSyncEntityType, Unit, type Prisma } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import type { FullSnapshotEnvelope } from "./one-c-full-snapshot-service.js";

/** Extend the approved BKZ mapping by source GUID; never merge records by name or code. */
export async function projectOneCDirectories(tx: Prisma.TransactionClient, input: FullSnapshotEnvelope) {
  const { workspaceId, sourceInstanceId, snapshot } = input;
  for (const [name, rows] of Object.entries(snapshot)) {
    if (!Array.isArray(rows)) continue;
    const seen = new Set<string>();
    for (const row of rows as Array<Record<string, unknown>>) {
      const key = typeof row.externalId === "string" ? row.externalId
        : typeof row.lineNumber === "number" ? `${row.documentId ?? row.specificationId}:${row.lineNumber}` : null;
      if (key === null) continue;
      if (seen.has(key)) throw new ApiError(422, "ONE_C_DUPLICATE_ROW", `Повторная запись в коллекции ${name}`, { key });
      seen.add(key);
    }
  }
  const refs = await tx.oneCExternalReference.findMany({ where: {
    workspaceId, source: "1C", externalId: { startsWith: `${sourceInstanceId}:` },
  } });
  const byKey = new Map(refs.map((ref) => [`${ref.entityType}:${ref.externalId}`, ref]));
  const materialIds = new Set(snapshot.materials.map((row) => row.externalId));
  if (refs.some((ref) => ref.entityType === OneCSyncEntityType.MATERIAL &&
    !materialIds.has(ref.externalId.slice(sourceInstanceId.length + 1)))) {
    throw new ApiError(422, "ONE_C_DIRECTORY_INCOMPLETE", "В полном справочнике отсутствует ранее связанный материал. Обнуление остатков остановлено.");
  }
  let changes = 0;
  async function save(entityType: OneCSyncEntityType, externalId: string, internalId: string, payloadHash: string) {
    await tx.oneCExternalReference.upsert({
      where: { workspaceId_source_entityType_externalId: { workspaceId, source: "1C", entityType, externalId } },
      create: { workspaceId, source: "1C", entityType, externalId, internalId,
        sourceUpdatedAt: new Date(snapshot.generatedAt), payloadHash },
      update: { sourceUpdatedAt: new Date(snapshot.generatedAt), payloadHash, lastSyncedAt: new Date() },
    });
    changes += 1;
  }
  for (const row of snapshot.materials) {
    const externalId = `${sourceInstanceId}:${row.externalId}`;
    const ref = byKey.get(`MATERIAL:${externalId}`);
    if (!ref && (row.deleted || row.service)) continue;
    const payloadHash = createHash("sha256").update(JSON.stringify(row)).digest("hex");
    if (ref?.payloadHash === payloadHash) continue;
    const baseUnit = row.unitName.trim().toLocaleLowerCase("ru") === "кг" ? Unit.KG
      : row.unitName.trim().toLocaleLowerCase("ru") === "шт" ? Unit.PCS : null;
    const type = row.groupName === "Материалы" ? MaterialType.REAGENT
      : row.groupName === "Готовая продукция" ? MaterialType.CHEMICAL_ADDITIVE
      : row.groupName === "Товары" ? MaterialType.OTHER : null;
    if (!baseUnit || !type || row.service || !row.name.trim() || !row.code.trim()) {
      throw new ApiError(422, "ONE_C_DIRECTORY_MAPPING_REQUIRED",
        `Требуется проверка номенклатуры «${row.name}»: группа или единица не входит в согласованное соответствие`,
        { externalId: row.externalId });
    }
    const existing = ref ? await tx.material.findFirst({ where: { workspaceId, id: ref.internalId } }) : null;
    if (ref && !existing) throw new ApiError(409, "ONE_C_MATERIAL_MISSING", "Связанный материал отсутствует в CRM");
    if (existing && existing.baseUnit !== baseUnit) {
      throw new ApiError(409, "ONE_C_UNIT_CHANGED", `Изменилась базовая единица «${row.name}». Нужна сверка остатков.`);
    }
    const collision = await tx.material.findUnique({ where: { workspaceId_code: { workspaceId, code: row.code.trim() } }, select: { id: true } });
    if (collision && collision.id !== ref?.internalId) {
      throw new ApiError(409, "ONE_C_DIRECTORY_COLLISION", `Код «${row.code}» уже занят другой номенклатурой. Нужна сверка связи.`);
    }
    const data = { name: row.name.trim(), code: row.code.trim(), type, baseUnit, active: !row.deleted };
    const material = existing
      ? await tx.material.update({ where: { id: existing.id }, data })
      : await tx.material.create({ data: { ...data, workspaceId, costPerBaseUnit: "0", currency: "KZT" } });
    await save(OneCSyncEntityType.MATERIAL, externalId, material.id, payloadHash);
  }
  const customerIds = new Set([...snapshot.sales, ...snapshot.invoices, ...snapshot.incomingPayments,
    ...snapshot.receivables].map((row) => row.counterpartyId));
  const supplierIds = new Set([...snapshot.receipts.map((row) => row.supplierId),
    ...snapshot.outgoingPayments.map((row) => row.counterpartyId)]);
  const counterparties = new Map(snapshot.counterparties.map((row) => [row.externalId, row]));
  for (const id of [...customerIds, ...supplierIds]) {
    if (!counterparties.has(id)) throw new ApiError(422, "ONE_C_COUNTERPARTY_MISSING", "Контрагент документа отсутствует в полном справочнике", { externalId: id });
  }
  for (const row of snapshot.counterparties) {
    const externalId = `${sourceInstanceId}:${row.externalId}`;
    const payloadHash = createHash("sha256").update(JSON.stringify(row)).digest("hex");
    for (const entityType of [OneCSyncEntityType.CUSTOMER, OneCSyncEntityType.SUPPLIER]) {
      const ref = byKey.get(`${entityType}:${externalId}`);
      const classified = entityType === OneCSyncEntityType.CUSTOMER
        ? customerIds.has(row.externalId) || row.groupName?.startsWith("Продажа")
        : supplierIds.has(row.externalId) || row.groupName?.startsWith("Поставщики");
      if ((!ref && !classified) || ref?.payloadHash === payloadHash) continue;
      if (!row.name.trim()) throw new ApiError(422, "ONE_C_COUNTERPARTY_NAME_REQUIRED", "Не заполнено имя контрагента 1С");
      const data = { name: row.name.trim(), taxId: row.taxId.trim() || null, active: !row.deleted };
      // Separate branches keep Prisma's generated delegate types precise.
      const lookup = { where: { workspaceId, name: data.name }, select: { id: true } } as const;
      const collision = entityType === OneCSyncEntityType.CUSTOMER
        ? await tx.customer.findFirst(lookup) : await tx.supplier.findFirst(lookup);
      if (collision && collision.id !== ref?.internalId) {
        throw new ApiError(409, "ONE_C_DIRECTORY_COLLISION", `Контрагент «${data.name}» уже есть под другой связью. Автообъединение запрещено.`);
      }
      const record = entityType === OneCSyncEntityType.CUSTOMER
        ? ref ? await tx.customer.update({ where: { id: ref.internalId, workspaceId }, data })
          : await tx.customer.create({ data: { ...data, workspaceId } })
        : ref ? await tx.supplier.update({ where: { id: ref.internalId, workspaceId }, data })
          : await tx.supplier.create({ data: { ...data, workspaceId } });
      await save(entityType, externalId, record.id, payloadHash);
    }
  }
  return changes;
}
