import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { deltaCounts, parseDelta } from "./delta.js";
import { fullSnapshotCounts, parseFullSnapshot } from "./full-snapshot.js";
import { createLogger } from "./logger.js";
import { DurableQueue, type QueueArea, type QueueEntry } from "./queue.js";
import { CrmSyncError, logSentDelta, logSentFullSnapshot, sendDelta, sendFullSnapshot } from "./sync.js";
import type { AgentConfig, AgentLogger, OneCDelta, OneCFullSnapshotEnvelope } from "./types.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const SENT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export class SyncAgent {
  private readonly queue: DurableQueue;
  private readonly logger: AgentLogger;
  private draining = false;
  private initialized = false;
  private nextSentCleanupAt = 0;

  public constructor(private readonly config: AgentConfig) {
    this.queue = new DurableQueue(config.queueDirectory, config.sentRetentionDays);
    this.logger = createLogger(dirname(config.queueDirectory));
  }

  public async initialize(): Promise<void> {
    const queueResult = await this.queue.initialize();
    this.nextSentCleanupAt = Date.now() + SENT_CLEANUP_INTERVAL_MS;
    this.initialized = true;
    await this.logger.info("AGENT_INITIALIZED", { queueDirectory: this.config.queueDirectory, crmSyncUrl: this.config.crmSyncUrl, removedSent: queueResult.removedSent });
  }

  public async status(): Promise<Record<string, unknown>> {
    return { queue: await this.queue.counts(), listenHost: this.config.listenHost, listenPort: this.config.listenPort, crmSyncUrl: this.config.crmSyncUrl };
  }

  public async batchState(batchId: string): Promise<QueueArea | null> {
    return this.queue.batchState(batchId);
  }

  public async enqueue(delta: unknown): Promise<{ batchId: string; duplicate: boolean }> {
    const parsed = parseDelta(delta);
    const result = await this.queue.enqueue(parsed);
    await this.logger.info(result.duplicate ? "DELTA_DUPLICATE" : "DELTA_QUEUED", { batchId: parsed.batchId, ...deltaCounts(parsed) });
    return result;
  }

  public async enqueueSnapshot(value: unknown): Promise<{ batchId: string; duplicate: boolean }> {
    const snapshot = parseFullSnapshot(value);
    if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_BODY_BYTES) {
      throw new Error("Полный снимок превышает лимит CRM 10 МиБ; отправка остановлена до записи в очередь");
    }
    const result = await this.queue.enqueue(snapshot);
    await this.logger.info(result.duplicate ? "FULL_SNAPSHOT_DUPLICATE" : "FULL_SNAPSHOT_QUEUED",
      { batchId: snapshot.batchId, ...fullSnapshotCounts(snapshot) });
    return result;
  }

  public async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const entry = await this.queue.claimNext();
        if (entry === null) return;
        const keepDraining = await this.sendEntry(entry);
        if (!keepDraining) return;
      }
    } finally {
      this.draining = false;
      await this.cleanupSentIfDue();
    }
  }

  private async cleanupSentIfDue(): Promise<void> {
    if (Date.now() < this.nextSentCleanupAt) return;
    this.nextSentCleanupAt = Date.now() + SENT_CLEANUP_INTERVAL_MS;
    try {
      const removedSent = await this.queue.pruneExpiredSent();
      if (removedSent > 0) await this.logger.info("SENT_QUEUE_PRUNED", { removedSent });
    } catch (error) {
      await this.logger.warn("SENT_QUEUE_PRUNE_FAILED", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  public async serve(): Promise<Server> {
    const server = createServer((request, response) => { void this.handleRequest(request, response); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.listenPort, this.config.listenHost, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await this.logger.info("LOCAL_LISTENER_STARTED", { host: this.config.listenHost, port: this.config.listenPort });
    return server;
  }

  private async sendEntry(entry: QueueEntry): Promise<boolean> {
    try {
      const result = entry.kind === "snapshot"
        ? await sendFullSnapshot(this.config, entry.delta as OneCFullSnapshotEnvelope)
        : await sendDelta(this.config, entry.delta as OneCDelta);
      await this.queue.succeed(entry);
      if (entry.kind === "snapshot") await logSentFullSnapshot(this.logger, entry.delta as OneCFullSnapshotEnvelope, result);
      else await logSentDelta(this.logger, entry.delta as OneCDelta, result);
      return true;
    } catch (error) {
      const syncError = error instanceof CrmSyncError ? error : new CrmSyncError(error instanceof Error ? error.message : String(error), true);
      if (syncError.retryable) {
        await this.queue.retry(entry);
        await this.logger.warn("CRM_SYNC_RETRY_SCHEDULED", { batchId: entry.delta.batchId, message: syncError.message, statusCode: syncError.statusCode ?? null });
        return false;
      }
      await this.queue.fail(entry);
      await this.logger.error("CRM_SYNC_FAILED", { batchId: entry.delta.batchId, message: syncError.message, statusCode: syncError.statusCode ?? null });
      return true;
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!this.initialized) {
        this.json(response, 503, { message: "Локальный агент ещё запускается" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (request.method === "GET" && path === "/health") {
        this.json(response, 200, { status: "ok", ...(await this.status()) });
        return;
      }
      if ((request.method === "GET" && path === "/v1/batch-status") ||
        (request.method === "POST" && ["/v1/delta", "/v1/snapshot", "/v1/drain"].includes(path))) {
        if (request.headers["x-agent-ingest-key"] !== this.config.localIngestKey) {
          this.json(response, 401, { message: "Локальный ключ агента не подтверждён" });
          return;
        }
        if (request.method === "GET") {
          const batchId = url.searchParams.get("batchId");
          if (!batchId) throw new Error("Укажите batchId");
          this.json(response, 200, { batchId, state: await this.batchState(batchId) });
          return;
        }
        if (path === "/v1/drain") {
          this.json(response, 202, { status: "DRAIN_SCHEDULED" });
          this.scheduleDrain();
          return;
        }
        const payload = JSON.parse(await readJsonBody(request)) as unknown;
        const result = path === "/v1/snapshot" ? await this.enqueueSnapshot(payload) : await this.enqueue(payload);
        this.json(response, 202, { queued: true, ...result });
        this.scheduleDrain();
        return;
      }
      this.json(response, 404, { message: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось принять данные 1С";
      await this.logger.warn("LOCAL_INGEST_REJECTED", { message });
      this.json(response, 422, { message });
    }
  }

  private scheduleDrain(): void {
    void this.drain().catch(async (error: unknown) => {
      await this.logger.error("QUEUE_DRAIN_FAILED", { message: error instanceof Error ? error.message : String(error) });
    });
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }
}

async function readJsonBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Пакет превышает лимит 10 МБ");
    chunks.push(buffer);
  }
  if (size === 0) throw new Error("Тело запроса пустое");
  return Buffer.concat(chunks).toString("utf8");
}
