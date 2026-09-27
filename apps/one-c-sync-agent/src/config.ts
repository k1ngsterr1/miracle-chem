import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { platform } from "node:process";
import type { AgentConfig } from "./types.js";

const MIN_SECRET_LENGTH = 32;

export function defaultAgentRoot(): string {
  if (platform === "win32") return join(process.env.ProgramData ?? "C:\\ProgramData", "MiracleChem", "OneCSyncAgent");
  return join(process.cwd(), ".miracle-chem-one-c-agent");
}

export function defaultConfigPath(): string {
  return join(defaultAgentRoot(), "config.json");
}

export function makeInitialConfig(): AgentConfig {
  const root = defaultAgentRoot();
  return {
    crmSyncUrl: "https://crm.example.kz/api/integrations/1c/sync",
    apiKey: "",
    queueDirectory: join(root, "queue"),
    listenHost: "127.0.0.1",
    listenPort: 8261,
    localIngestKey: randomBytes(24).toString("base64url"),
    syncIntervalSeconds: 300,
    requestTimeoutSeconds: 30,
    sentRetentionDays: 30,
  };
}

export async function initializeConfig(configPath: string): Promise<AgentConfig> {
  const config = makeInitialConfig();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return config;
}

export async function loadConfig(configPath: string): Promise<AgentConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Не удалось прочитать конфигурацию агента «${configPath}»: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseConfig(parsed);
}

export function parseConfig(value: unknown): AgentConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Конфигурация агента должна быть JSON-объектом");
  const data = value as Record<string, unknown>;
  const crmSyncUrl = stringValue(data.crmSyncUrl, "crmSyncUrl");
  const apiKey = stringValue(data.apiKey, "apiKey");
  const queueDirectory = stringValue(data.queueDirectory, "queueDirectory");
  const localIngestKey = stringValue(data.localIngestKey, "localIngestKey");
  const listenHost = data.listenHost === "127.0.0.1" || data.listenHost === "::1" ? data.listenHost : invalid("listenHost должен быть 127.0.0.1 или ::1");
  const listenPort = numberValue(data.listenPort, "listenPort", 1, 65_535);
  const syncIntervalSeconds = numberValue(data.syncIntervalSeconds, "syncIntervalSeconds", 15, 86_400);
  const requestTimeoutSeconds = numberValue(data.requestTimeoutSeconds, "requestTimeoutSeconds", 5, 300);
  const sentRetentionDays = data.sentRetentionDays === undefined ? 30 : numberValue(data.sentRetentionDays, "sentRetentionDays", 1, 365);
  let url: URL;
  try {
    url = new URL(crmSyncUrl);
  } catch {
    throw new Error("crmSyncUrl должен быть абсолютным URL");
  }
  const isLocalDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !isLocalDevelopment) throw new Error("CRM URL должен использовать HTTPS");
  if (!url.pathname.endsWith("/api/integrations/1c/sync")) throw new Error("crmSyncUrl должен указывать на /api/integrations/1c/sync");
  if (apiKey.length < MIN_SECRET_LENGTH) throw new Error("apiKey должен содержать не менее 32 символов");
  if (localIngestKey.length < MIN_SECRET_LENGTH) throw new Error("localIngestKey должен содержать не менее 32 символов");
  return { crmSyncUrl: url.toString(), apiKey, queueDirectory, listenHost, listenPort, localIngestKey, syncIntervalSeconds, requestTimeoutSeconds, sentRetentionDays };
}

function stringValue(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} обязателен`);
  return value.trim();
}

function numberValue(value: unknown, key: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${key} должен быть целым числом от ${min} до ${max}`);
  return value;
}

function invalid(message: string): never {
  throw new Error(message);
}
