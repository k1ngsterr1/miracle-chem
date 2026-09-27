import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fingerprint, initializeBkzState, prepareBkzPlan, type BkzMapping, type BkzPlan, type BkzSnapshot, type BkzState } from "./bkz-adapter.js";
import { sendDelta } from "./sync.js";
import type { AgentConfig, OneCDelta, SyncResponse } from "./types.js";

interface Journal {
  version: 1;
  crmSyncUrl: string;
  state: BkzState;
  pending?: BkzPlan;
  reviewRequired?: boolean;
  lastResult?: SyncResponse;
}
type Sender = (config: AgentConfig, delta: OneCDelta) => Promise<SyncResponse>;

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/u, "")) as unknown;
}

/** Private files on Windows as well as POSIX; secrets never enter the journal. */
async function saveJson(root: string, name: string, value: unknown, exclusive = false): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destination = join(root, name);
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    if (process.platform === "win32") {
      const { stdout } = await promisify(execFile)("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
      const sid = stdout.match(/S-1-5-(?:\d+-)*\d+/u)?.[0];
      if (!sid) throw new Error("Не удалось определить SID пользователя Windows");
      await promisify(execFile)("icacls.exe", [temporary, "/inheritance:r", "/grant:r", `*${sid}:F`, "*S-1-5-18:F", "*S-1-5-32-544:F"]);
    }
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    if (exclusive) {
      await link(temporary, destination); // Never overwrite a baseline/checkpoint.
      await unlink(temporary);
    } else {
      await rename(temporary, destination);
    }
  } finally {
    await handle.close();
    await unlink(temporary).catch((error: unknown) => { if (!missing(error)) throw error; });
  }
}

async function locked<T>(root: string, work: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "collector.lock");
  const handle = await open(path, "wx", 0o600).catch(async (error: unknown) => {
      if (!code(error, "EEXIST")) throw error;
      const owner = await readJsonFile(path) as { pid?: unknown };
      if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) < 1) throw new Error(`Повреждена блокировка ${path}; проверьте работающие процессы`);
      try { process.kill(Number(owner.pid), 0); } catch (probe) {
        if (code(probe, "ESRCH")) throw new Error(`Найдена блокировка прошлого запуска: ${path}. Убедитесь, что сборщик остановлен, затем удалите только collector.lock. Checkpoint не удалять.`);
        throw probe;
      }
      throw new Error("Сборщик уже работает; параллельный запуск запрещён");
  });
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.sync();
    return await work();
  } finally { await handle.close(); await unlink(path); }
}

export async function initializeBkzCollector(root: string, config: AgentConfig, snapshot: BkzSnapshot, mapping: BkzMapping): Promise<void> {
  await locked(root, () => saveJson(root, "checkpoint.json", { version: 1, crmSyncUrl: config.crmSyncUrl, state: initializeBkzState(snapshot, mapping) } satisfies Journal, true));
}

async function journal(root: string, config: AgentConfig, mapping: BkzMapping): Promise<Journal> {
  const value = await readJsonFile(join(root, "checkpoint.json")) as Journal;
  if (value?.version !== 1 || !value.state || value.state.version !== 1 || value.crmSyncUrl !== config.crmSyncUrl || value.state.mappingHash !== fingerprint(mapping)) throw new Error("Не совпадают CRM, mapping или версия checkpoint. Нужна ручная сверка; не создавайте baseline повторно.");
  if (value.reviewRequired) throw new Error("Предыдущая дельта принята частично. Разберите результат в CRM и report.json; автоматическое продолжение заблокировано.");
  if (value.pending && value.pending.nextState.mappingHash !== value.state.mappingHash) throw new Error("Повреждён pending checkpoint");
  return value;
}

/**
 * COM collector reuses the same HTTPS transport as the BSL outbox, but awaits the
 * CRM result (not merely local HTTP 202). One journal atomically holds both the
 * old cursor and exact pending batch + proposed next cursor.
 */
export async function syncBkzSnapshot(root: string, config: AgentConfig, snapshot: BkzSnapshot, mapping: BkzMapping, sender: Sender = sendDelta): Promise<{ status: string; batchId?: string; result?: SyncResponse }> {
  return locked(root, async () => {
    const current = await journal(root, config, mapping);
    const plan = current.pending ?? prepareBkzPlan(snapshot, mapping, current.state);
    if (plan.reviews.length > 0) {
      await saveJson(root, "report.json", { status: "REVIEW_REQUIRED", at: new Date().toISOString(), reviews: plan.reviews });
      throw new Error(`Требуют сверки документов: ${plan.reviews.length}. См. report.json; данные не отправлены.`);
    }
    const count = [plan.delta.customers, plan.delta.suppliers, plan.delta.materials, plan.delta.receipts].reduce((sum, items) => sum + (items?.length ?? 0), 0);
    if (count === 0) return { status: "UNCHANGED" };
    if (!current.pending) await saveJson(root, "checkpoint.json", { ...current, pending: plan });
    const result = await sender(config, plan.delta);
    if (result.status !== "COMPLETED" && result.status !== "PARTIAL") throw new Error("CRM не подтвердила результат; pending сохранён");
    const next: Journal = result.status === "PARTIAL"
      ? { ...current, pending: plan, lastResult: result, reviewRequired: true }
      : { version: 1, crmSyncUrl: config.crmSyncUrl, state: plan.nextState, lastResult: result };
    await saveJson(root, "checkpoint.json", next);
    await saveJson(root, "report.json", { status: result.status, at: new Date().toISOString(), batchId: plan.delta.batchId, result });
    if (result.status === "PARTIAL") throw new Error("CRM приняла дельту частично. Проверьте карантин/ошибки в CRM; сборщик остановлен до сверки.");
    return { status: result.status, batchId: plan.delta.batchId, result };
  });
}

function code(error: unknown, expected: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === expected;
}
function missing(error: unknown): boolean { return code(error, "ENOENT"); }
