import type { OneCFullSnapshotEnvelope } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const FULL_SNAPSHOT_COLLECTIONS = [
  "organizations", "counterparties", "materials", "receipts", "balances",
  "accountingInventory", "receivables", "sales", "saleLines", "invoices",
  "invoiceLines", "incomingPayments", "outgoingPayments",
] as const;
export const EXTENDED_SNAPSHOT_COLLECTIONS = [
  "warehouses", "contracts", "specifications", "specificationComponents",
  "productionReports", "productionProducts",
] as const;

export function parseFullSnapshot(value: unknown): OneCFullSnapshotEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Полный снимок должен быть JSON-объектом");
  const envelope = value as Record<string, unknown>;
  if (envelope.kind !== "FULL_SNAPSHOT" || envelope.source !== "1C") throw new Error("Ожидается FULL_SNAPSHOT из 1С");
  for (const name of ["workspaceId", "sourceInstanceId", "organizationExternalId"] as const) {
    if (typeof envelope[name] !== "string" || !UUID.test(envelope[name])) throw new Error(`${name} должен быть GUID`);
  }
  if (typeof envelope.batchId !== "string" || !envelope.batchId.trim() || envelope.batchId.length > 160) throw new Error("batchId обязателен");
  if (typeof envelope.generatedAt !== "string" || !/Z$/u.test(envelope.generatedAt) || Number.isNaN(Date.parse(envelope.generatedAt))) throw new Error("generatedAt должен быть временем UTC");
  const snapshot = envelope.snapshot;
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Нет снимка 1С");
  const data = snapshot as Record<string, unknown>;
  if (data.schemaVersion !== 1 || data.source !== "1C" || data.configuration !== "БухгалтерияДляКазахстана" ||
      data.consistency !== "SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE" || data.generatedAt !== envelope.generatedAt) {
    throw new Error("Неверная конфигурация, версия или дата снимка 1С");
  }
  for (const name of FULL_SNAPSHOT_COLLECTIONS) {
    const rows = data[name];
    if (!Array.isArray(rows) || rows.length > 2_000 || rows.some((row) => row === null || typeof row !== "object" || Array.isArray(row))) {
      throw new Error(`${name} должен быть полным массивом не более 2000 строк`);
    }
  }
  for (const name of EXTENDED_SNAPSHOT_COLLECTIONS) {
    const rows = data[name];
    if (rows !== undefined && (!Array.isArray(rows) || rows.length > 2_000 ||
        rows.some((row) => row === null || typeof row !== "object" || Array.isArray(row)))) {
      throw new Error(`${name} должен быть массивом не более 2000 строк`);
    }
  }
  return envelope as unknown as OneCFullSnapshotEnvelope;
}

export function fullSnapshotCounts(value: OneCFullSnapshotEnvelope): Record<string, number> {
  return Object.fromEntries([...FULL_SNAPSHOT_COLLECTIONS, ...EXTENDED_SNAPSHOT_COLLECTIONS]
    .map((name) => [name, (value.snapshot[name] as unknown[] | undefined)?.length ?? 0]));
}
