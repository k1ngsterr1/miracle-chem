import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDelta } from "./delta.js";
import { parseFullSnapshot } from "./full-snapshot.js";
import type { OneCDelta, OneCFullSnapshotEnvelope } from "./types.js";

type QueueArea = "pending" | "sending" | "sent" | "failed";

export interface QueueEntry {
  path: string;
  fileName: string;
  kind: "delta" | "snapshot";
  delta: OneCDelta | OneCFullSnapshotEnvelope;
}

function parseMessage(value: unknown): QueueEntry["delta"] {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === "FULL_SNAPSHOT"
    ? parseFullSnapshot(value)
    : parseDelta(value);
}

function fingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) :
    item !== null && typeof item === "object"
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
      : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export class DurableQueue {
  private pendingNames: string[] | null = null;
  private enqueueTail: Promise<void> = Promise.resolve();

  public constructor(private readonly root: string, private readonly sentRetentionDays = 30) {}

  public async initialize(): Promise<{ removedSent: number }> {
    await Promise.all((["pending", "sending", "sent", "failed"] as const).map((area) => mkdir(this.directory(area), { recursive: true })));
    await this.recoverInterruptedSends();
    return { removedSent: await this.pruneExpiredSent() };
  }

  public async enqueue(deltaValue: unknown): Promise<{ batchId: string; duplicate: boolean }> {
    // Two simultaneous HTTP requests must not both pass the existence check and
    // rename different payloads over the same batchId.
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.enqueueTail;
    this.enqueueTail = next;
    await previous;
    try {
      return await this.enqueueUnlocked(deltaValue);
    } finally {
      release();
    }
  }

  private async enqueueUnlocked(deltaValue: unknown): Promise<{ batchId: string; duplicate: boolean }> {
    const delta = parseMessage(deltaValue);
    const fileName = this.fileName(delta.batchId);
    for (const area of ["pending", "sending", "sent", "failed"] as const) {
      try {
        const existingPath = join(this.directory(area), fileName);
        await stat(existingPath);
        const existing = parseMessage(JSON.parse(await readFile(existingPath, "utf8")) as unknown);
        if (fingerprint(existing) !== fingerprint(delta)) throw new Error("batchId уже занят другим содержимым");
        return { batchId: delta.batchId, duplicate: true };
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    const target = join(this.directory("pending"), fileName);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(delta)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, target);
    if (this.pendingNames !== null) this.pendingNames.push(fileName);
    return { batchId: delta.batchId, duplicate: false };
  }

  public async claimNext(): Promise<QueueEntry | null> {
    if (this.pendingNames === null) this.pendingNames = (await readdir(this.directory("pending"))).filter((file) => file.endsWith(".json")).sort();
    for (;;) {
      const fileName = this.pendingNames.shift();
      if (fileName === undefined) {
        this.pendingNames = null;
        return null;
      }
      const from = join(this.directory("pending"), fileName);
      const to = join(this.directory("sending"), fileName);
      try {
        await rename(from, to);
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      try {
        const content = await readFile(to, "utf8");
        const delta = parseMessage(JSON.parse(content) as unknown);
        return { path: to, fileName, kind: "kind" in delta && delta.kind === "FULL_SNAPSHOT" ? "snapshot" : "delta", delta };
      } catch (error) {
        await this.move(to, "failed");
        throw new Error(`Повреждён файл локальной очереди ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  public async succeed(entry: QueueEntry): Promise<void> {
    await this.move(entry.path, "sent");
  }

  public async retry(entry: QueueEntry): Promise<void> {
    await this.move(entry.path, "pending");
    // The in-memory list has already removed this entry while it was being sent.
    // Put it back first so callers that immediately retry can claim it again
    // without forcing a new directory scan.
    if (this.pendingNames !== null) this.pendingNames.unshift(entry.fileName);
  }

  public async fail(entry: QueueEntry): Promise<void> {
    await this.move(entry.path, "failed");
  }

  public async counts(): Promise<Record<QueueArea, number>> {
    const result = {} as Record<QueueArea, number>;
    for (const area of ["pending", "sending", "sent", "failed"] as const) {
      result[area] = (await readdir(this.directory(area))).filter((file) => file.endsWith(".json")).length;
    }
    return result;
  }

  public async pruneExpiredSent(): Promise<number> {
    const deadline = Date.now() - this.sentRetentionDays * 86_400_000;
    let removed = 0;
    for (const fileName of (await readdir(this.directory("sent"))).filter((file) => file.endsWith(".json"))) {
      const path = join(this.directory("sent"), fileName);
      if ((await stat(path)).mtimeMs < deadline) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  private async recoverInterruptedSends(): Promise<void> {
    for (const fileName of (await readdir(this.directory("sending"))).filter((file) => file.endsWith(".json"))) {
      await this.move(join(this.directory("sending"), fileName), "pending");
    }
    this.pendingNames = null;
  }

  private async move(path: string, to: QueueArea): Promise<void> {
    await rename(path, join(this.directory(to), path.split(/[\\/]/u).at(-1) ?? "unknown.json"));
  }

  private directory(area: QueueArea): string {
    return join(this.root, area);
  }

  private fileName(batchId: string): string {
    return `${createHash("sha256").update(batchId).digest("hex")}.json`;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
