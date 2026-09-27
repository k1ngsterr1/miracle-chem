import type { OneCDelta } from "./types.js";

const MAX_BATCH_ID_LENGTH = 160;
const MAX_COLLECTION_SIZE = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * A fast boundary check for the local listener. The CRM remains the source of
 * truth and runs the complete Zod validation before applying a delta.
 */
export function parseDelta(value: unknown): OneCDelta {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Дельта 1С должна быть JSON-объектом");
  const delta = value as Record<string, unknown>;
  if (delta.kind === "FULL_SNAPSHOT" || delta.snapshot !== undefined) throw new Error("Полный снимок отправляйте в /v1/snapshot");
  if (typeof delta.workspaceId !== "string" || !UUID.test(delta.workspaceId)) throw new Error("workspaceId должен быть UUID контура CRM");
  if (typeof delta.batchId !== "string" || delta.batchId.trim().length === 0 || delta.batchId.length > MAX_BATCH_ID_LENGTH) throw new Error("batchId обязателен и не должен превышать 160 символов");
  if (typeof delta.generatedAt !== "string" || Number.isNaN(Date.parse(delta.generatedAt))) throw new Error("generatedAt должен быть датой ISO 8601");
  if (delta.source !== undefined && delta.source !== "1C") throw new Error("source должен иметь значение 1C");
  for (const field of ["customers", "suppliers", "materials", "receipts"] as const) {
    const collection = delta[field];
    if (collection !== undefined && (!Array.isArray(collection) || collection.length > MAX_COLLECTION_SIZE)) throw new Error(`${field} должен быть массивом не более ${MAX_COLLECTION_SIZE} строк`);
  }
  return delta as OneCDelta;
}

export function deltaCounts(delta: OneCDelta): Record<string, number> {
  return {
    customers: delta.customers?.length ?? 0,
    suppliers: delta.suppliers?.length ?? 0,
    materials: delta.materials?.length ?? 0,
    receipts: delta.receipts?.length ?? 0,
  };
}
