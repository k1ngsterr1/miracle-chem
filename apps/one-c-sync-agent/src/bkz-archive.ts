import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfig } from "./types.js";

type LocalCollection = {
  key: string;
  kind: string;
  name: string;
  sensitivity: "BUSINESS" | "HR" | "SYSTEM_SECRET";
  rowCount: number;
  chunkFiles: string[];
  status: string;
};

type LocalManifest = {
  schemaVersion: 1;
  source: "1C";
  configuration: "БухгалтерияДляКазахстана";
  configurationVersion: string;
  consistency: "SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE";
  readStartedAt: string;
  generatedAt: string;
  sourceMetadataCount: number;
  complete: boolean;
  errors: unknown[];
  collections: LocalCollection[];
};

type ArchiveCollection = Omit<LocalCollection, "chunkFiles" | "status"> & { chunkHashes: string[] };
type ArchiveManifest = Omit<LocalManifest, "complete" | "errors" | "collections"> & { collections: ArchiveCollection[] };

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Ожидается JSON-объект архива 1С");
  return value as Record<string, unknown>;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeChunkName(name: string): boolean {
  return /^\d{4}-\d{4}\.json$/u.test(name);
}

export async function prepareBkzArchive(directory: string): Promise<{ manifest: ArchiveManifest; chunks: Array<{
  collectionKey: string; chunkIndex: number; sha256: string; fileName: string;
}> }> {
  const local = object(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"))) as unknown as LocalManifest;
  if (local.schemaVersion !== 1 || local.source !== "1C" || local.configuration !== "БухгалтерияДляКазахстана" ||
      local.consistency !== "SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE" || !local.complete ||
      !Array.isArray(local.errors) || local.errors.length !== 0 || !Array.isArray(local.collections) ||
      local.collections.length !== local.sourceMetadataCount || local.collections.length === 0) {
    throw new Error("Выгрузка 1С неполная: архив не будет отправлен в CRM");
  }
  const collectionKeys = new Set<string>();
  const chunks: Array<{ collectionKey: string; chunkIndex: number; sha256: string; fileName: string }> = [];
  const collections: ArchiveCollection[] = [];
  for (const item of local.collections) {
    if (!item || typeof item.key !== "string" || collectionKeys.has(item.key) ||
        item.status !== "EXPORTED" || !Number.isSafeInteger(item.rowCount) || item.rowCount < 0 ||
        !Array.isArray(item.chunkFiles) || !["BUSINESS", "HR", "SYSTEM_SECRET"].includes(item.sensitivity)) {
      throw new Error("В манифесте архива 1С есть незавершённая или повторная коллекция");
    }
    collectionKeys.add(item.key);
    const hashes: string[] = [];
    let rows = 0;
    for (let index = 0; index < item.chunkFiles.length; index++) {
      const filename = item.chunkFiles[index];
      if (typeof filename !== "string" || !safeChunkName(filename)) throw new Error("В манифесте архива 1С указан небезопасный путь к порции");
      const records = JSON.parse(await readFile(join(directory, filename), "utf8")) as unknown;
      if (!Array.isArray(records) || records.length === 0 || records.length > 1_000 ||
          records.some((record) => record === null || typeof record !== "object" || Array.isArray(record))) {
        throw new Error(`Повреждена порция архива ${item.key}:${index}`);
      }
      const checksum = sha256(records);
      hashes.push(checksum);
      rows += records.length;
      chunks.push({ collectionKey: item.key, chunkIndex: index, sha256: checksum, fileName: filename });
    }
    if (rows !== item.rowCount) throw new Error(`Не совпало количество строк ${item.key}`);
    collections.push({ key: item.key, kind: item.kind, name: item.name,
      sensitivity: item.sensitivity, rowCount: item.rowCount, chunkHashes: hashes });
  }
  const { schemaVersion, source, configuration, configurationVersion, consistency, readStartedAt,
    generatedAt, sourceMetadataCount } = local;
  return { manifest: { schemaVersion, source, configuration, configurationVersion, consistency,
    readStartedAt, generatedAt, sourceMetadataCount, collections }, chunks };
}

async function postArchive<T>(config: AgentConfig, path: string, payload: unknown): Promise<T> {
  const url = config.crmSyncUrl.replace(/\/sync$/u, `/archive${path}`);
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers: {
        "content-type": "application/json", "x-one-c-sync-key": config.apiKey,
        "user-agent": "MiracleChem-OneCSyncAgent/0.1",
      }, body: JSON.stringify(payload), signal: AbortSignal.timeout(config.requestTimeoutSeconds * 1_000) });
    } catch (error) {
      if (attempt < 3) { await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt)); continue; }
      throw new Error(`CRM недоступна при переносе архива 1С: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.ok) return await response.json() as T;
    if ((response.status >= 500 || response.status === 429 || response.status === 408) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`CRM отклонила порцию архива 1С: HTTP ${response.status}`);
  }
  throw new Error("Не удалось отправить архив 1С");
}

export async function uploadBkzArchive(directory: string,
    binding: { workspaceId: string; sourceInstanceId: string; organizationId: string }, config: AgentConfig) {
  const { manifest, chunks } = await prepareBkzArchive(directory);
  const started = await postArchive<{ importId: string; archiveId: string; status: string }>(config, "/start", {
    workspaceId: binding.workspaceId, sourceInstanceId: binding.sourceInstanceId,
    organizationExternalId: binding.organizationId, manifest,
  });
  if (started.status !== "STAGING" && started.status !== "COMPLETE") throw new Error("CRM вернула неверное состояние архива 1С");
  if (started.status === "STAGING") {
    for (const chunk of chunks) {
      const records = JSON.parse(await readFile(join(directory, chunk.fileName), "utf8")) as Record<string, unknown>[];
      if (sha256(records) !== chunk.sha256) throw new Error(`Порция архива изменилась после проверки: ${chunk.fileName}`);
      await postArchive(config, `/${started.importId}/chunks`, {
        collectionKey: chunk.collectionKey, chunkIndex: chunk.chunkIndex, sha256: chunk.sha256, records,
      });
      // Keep the one-time import below the API's global per-minute rate limit.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  const completed = await postArchive<{ status: string; rows?: number; collections?: number }>(
    config, `/${started.importId}/finalize`, {},
  );
  if (completed.status !== "COMPLETE") throw new Error("CRM не подтвердила завершение архива 1С");
  return { status: completed.status, archiveId: started.archiveId, importId: started.importId,
    collections: manifest.collections.length, rows: manifest.collections.reduce((sum, item) => sum + item.rowCount, 0),
    chunks: chunks.length };
}
