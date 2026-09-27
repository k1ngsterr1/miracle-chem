import { createHash } from "node:crypto";
import { parseFullSnapshot } from "./full-snapshot.js";
import type { OneCFullSnapshotEnvelope } from "./types.js";

/** Keep the batch id stable when the same exported file is retried. */
export function buildBkzFullEnvelope(
  snapshot: unknown,
  binding: { workspaceId: string; sourceInstanceId: string; organizationId: string },
): OneCFullSnapshotEnvelope {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Файл выгрузки 1С должен содержать JSON-объект");
  }
  const source = snapshot as Record<string, unknown>;
  const batchId = `full:${createHash("sha256").update(JSON.stringify(source)).digest("hex")}`;
  return parseFullSnapshot({
    kind: "FULL_SNAPSHOT",
    source: "1C",
    workspaceId: binding.workspaceId,
    sourceInstanceId: binding.sourceInstanceId,
    organizationExternalId: binding.organizationId,
    batchId,
    generatedAt: source.generatedAt,
    snapshot: source,
  });
}
