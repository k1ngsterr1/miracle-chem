import type { AgentConfig, OneCFullSnapshotEnvelope } from "./types.js";
import type { QueueArea } from "./queue.js";

function localUrl(config: AgentConfig, path: string): URL {
  const host = config.listenHost === "::1" ? "[::1]" : config.listenHost;
  return new URL(path, `http://${host}:${config.listenPort}`);
}

async function requestLocalAgent<T>(config: AgentConfig, path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(localUrl(config, path), {
      method,
      headers: { "x-agent-ingest-key": config.localIngestKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`Локальный агент 1С недоступен на ${config.listenHost}:${config.listenPort}; проверьте службу serve: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : `Локальный агент вернул HTTP ${response.status}`);
  return result as T;
}

export async function submitSnapshotToAgent(config: AgentConfig, snapshot: OneCFullSnapshotEnvelope): Promise<{ batchId: string; duplicate: boolean }> {
  return requestLocalAgent(config, "/v1/snapshot", "POST", snapshot);
}

export async function readLocalBatchState(config: AgentConfig, batchId: string): Promise<QueueArea | null> {
  const result = await requestLocalAgent<{ state: QueueArea | null }>(config,
    `/v1/batch-status?batchId=${encodeURIComponent(batchId)}`, "GET");
  return result.state;
}

export async function readLocalAgentStatus(config: AgentConfig): Promise<Record<string, unknown>> {
  return requestLocalAgent(config, "/health", "GET");
}

export async function requestLocalDrain(config: AgentConfig): Promise<Record<string, unknown>> {
  return requestLocalAgent(config, "/v1/drain", "POST");
}
