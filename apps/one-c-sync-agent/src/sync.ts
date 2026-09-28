import { deltaCounts } from "./delta.js";
import { fullSnapshotCounts } from "./full-snapshot.js";
import type { AgentConfig, AgentLogger, OneCDelta, OneCFullSnapshotEnvelope, SyncResponse } from "./types.js";

export class CrmSyncError extends Error {
  public constructor(message: string, public readonly retryable: boolean, public readonly statusCode?: number,
    public readonly code?: string) {
    super(message);
    this.name = "CrmSyncError";
  }
}

export async function sendDelta(config: AgentConfig, delta: OneCDelta): Promise<SyncResponse> {
  return sendPayload(config, config.crmSyncUrl, delta);
}

export async function sendFullSnapshot(config: AgentConfig, snapshot: OneCFullSnapshotEnvelope): Promise<SyncResponse> {
  // The API may spend up to 120 seconds applying a full snapshot transaction.
  return sendPayload(config, config.crmSyncUrl.replace(/\/sync$/u, "/snapshot"), snapshot,
    Math.max(config.requestTimeoutSeconds, 180));
}

async function sendPayload(config: AgentConfig, url: string, payload: OneCDelta | OneCFullSnapshotEnvelope,
    timeoutSeconds = config.requestTimeoutSeconds): Promise<SyncResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-one-c-sync-key": config.apiKey,
        "user-agent": "MiracleChem-OneCSyncAgent/0.1",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutSeconds * 1_000),
    });
  } catch (error) {
    throw new CrmSyncError(`CRM недоступна: ${error instanceof Error ? error.message : String(error)}`, true);
  }

  const body = await response.text();
  let parsed: unknown = null;
  try {
    parsed = body === "" ? null : JSON.parse(body) as unknown;
  } catch {
    // The textual status below is enough for a retry/failed decision.
  }
  if (!response.ok) {
    const message = apiMessage(parsed) ?? `CRM вернула HTTP ${response.status}`;
    throw new CrmSyncError(message, response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
      response.status, apiCode(parsed));
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new CrmSyncError("CRM вернула некорректный ответ синхронизации", true, response.status);
  const result = parsed as SyncResponse;
  if (result.status !== "COMPLETED" && result.status !== "PARTIAL") throw new CrmSyncError("CRM не подтвердила завершение синхронизации", true, response.status);
  return result;
}

export async function logSentDelta(logger: AgentLogger, delta: OneCDelta, result: SyncResponse): Promise<void> {
  await logger.info("CRM_SYNC_CONFIRMED", { batchId: delta.batchId, status: result.status, replayed: result.replayed === true, ...deltaCounts(delta) });
}

export async function logSentFullSnapshot(logger: AgentLogger, snapshot: OneCFullSnapshotEnvelope, result: SyncResponse): Promise<void> {
  await logger.info("CRM_FULL_SNAPSHOT_CONFIRMED", { batchId: snapshot.batchId, status: result.status,
    replayed: result.replayed === true, ...fullSnapshotCounts(snapshot) });
}

function apiMessage(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const nested = body.error;
  const candidate = nested !== null && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>).message : body.message;
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : null;
}

function apiCode(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>).error;
  if (nested === null || typeof nested !== "object" || Array.isArray(nested)) return undefined;
  const code = (nested as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}
