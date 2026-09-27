import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeBkzCollector, syncBkzSnapshot } from "./bkz-collector.js";
import { ids, sampleMapping, sampleReceipt, sampleSnapshot } from "../test/bkz-fixtures.js";
import type { AgentConfig } from "./types.js";

const config: AgentConfig = { crmSyncUrl: "http://127.0.0.1:1/api/integrations/1c/sync", apiKey: "a".repeat(32), localIngestKey: "b".repeat(32), queueDirectory: "unused", listenHost: "127.0.0.1", listenPort: 8261, syncIntervalSeconds: 900, requestTimeoutSeconds: 5, sentRetentionDays: 30 };
const roots: string[] = [];
async function setup() { const root = await mkdtemp(join(tmpdir(), "bkz-collector-test-")); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("BKZ durable collector", () => {
  it("keeps the exact pending body and batch ID after uncertain delivery", async () => {
    const root = await setup(); const snapshot = sampleSnapshot(); const mapping = sampleMapping();
    await initializeBkzCollector(root, config, snapshot, mapping);
    snapshot.receipts = [sampleReceipt()];
    const sender = vi.fn().mockRejectedValueOnce(new Error("connection lost after commit")).mockResolvedValue({ status: "COMPLETED", replayed: true });
    await expect(syncBkzSnapshot(root, config, snapshot, mapping, sender)).rejects.toThrow("connection lost");
    const pending = JSON.parse(await readFile(join(root, "checkpoint.json"), "utf8"));
    expect(pending.pending.delta.receipts).toHaveLength(1); expect(pending.state.documents[ids.document]).toBeUndefined();
    const newer = { ...snapshot, generatedAt: "2026-09-26T07:00:00Z", receipts: [sampleReceipt(), { ...sampleReceipt(), documentId: ids.nextDocument }] };
    await expect(syncBkzSnapshot(root, config, newer, mapping, sender)).resolves.toMatchObject({ status: "COMPLETED" });
    expect(sender.mock.calls[1]![1]).toEqual(sender.mock.calls[0]![1]);
    const checkpoint = JSON.parse(await readFile(join(root, "checkpoint.json"), "utf8"));
    expect(checkpoint.pending).toBeUndefined(); expect(checkpoint.state.documents[ids.document]).toBeDefined();
    expect(checkpoint.state.documents[ids.nextDocument]).toBeUndefined();
  });

  it("stops on partial CRM acknowledgement instead of silently dropping rejected rows", async () => {
    const root = await setup(); const snapshot = sampleSnapshot(); const mapping = sampleMapping();
    await initializeBkzCollector(root, config, snapshot, mapping);
    const initial = JSON.parse(await readFile(join(root, "checkpoint.json"), "utf8"));
    snapshot.receipts = [sampleReceipt()];
    const sender = vi.fn().mockResolvedValue({ status: "PARTIAL", summary: { quarantined: 1 } });
    await expect(syncBkzSnapshot(root, config, snapshot, mapping, sender)).rejects.toThrow("частично");
    const held = JSON.parse(await readFile(join(root, "checkpoint.json"), "utf8"));
    expect(held.state).toEqual(initial.state); expect(held.pending.delta.receipts).toHaveLength(1);
    expect(held.reviewRequired).toBe(true);
    await expect(syncBkzSnapshot(root, config, snapshot, mapping, sender)).rejects.toThrow("частично");
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("refuses destructive reinitialization, endpoint changes, missing state and concurrent runs", async () => {
    const root = await setup(); const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const sender = vi.fn();
    await expect(syncBkzSnapshot(root, config, snapshot, mapping, sender)).rejects.toThrow();
    await initializeBkzCollector(root, config, snapshot, mapping);
    await expect(initializeBkzCollector(root, config, snapshot, mapping)).rejects.toThrow();
    await expect(syncBkzSnapshot(root, { ...config, crmSyncUrl: "https://wrong.example/api/integrations/1c/sync" }, snapshot, mapping, sender)).rejects.toThrow("Не совпадают");
    await writeFile(join(root, "collector.lock"), JSON.stringify({ pid: process.pid }));
    await expect(syncBkzSnapshot(root, config, snapshot, mapping, sender)).rejects.toThrow("уже работает");
    expect(sender).not.toHaveBeenCalled();
  });

  it("writes a review report without sending or advancing the checkpoint", async () => {
    const root = await setup(); const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const sender = vi.fn();
    snapshot.receipts = [sampleReceipt()]; await initializeBkzCollector(root, config, snapshot, mapping);
    const before = await readFile(join(root, "checkpoint.json"), "utf8"); snapshot.receipts[0]!.quantity = "20";
    await expect(syncBkzSnapshot(root, config, snapshot, mapping, sender)).rejects.toThrow("сверки");
    expect(await readFile(join(root, "checkpoint.json"), "utf8")).toBe(before);
    expect(JSON.parse(await readFile(join(root, "report.json"), "utf8")).reviews).toHaveLength(1); expect(sender).not.toHaveBeenCalled();
  });

  it("sends a real HTTP request through the production transport without touching CRM databases", async () => {
    const requests: Array<{ key: unknown; body: unknown }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ key: request.headers["x-one-c-sync-key"], body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ status: "COMPLETED" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("No port");
      const local = { ...config, crmSyncUrl: `http://127.0.0.1:${address.port}/api/integrations/1c/sync` };
      const root = await setup(); const snapshot = sampleSnapshot(); const mapping = sampleMapping();
      await initializeBkzCollector(root, local, snapshot, mapping); snapshot.receipts = [sampleReceipt()];
      await expect(syncBkzSnapshot(root, local, snapshot, mapping)).resolves.toMatchObject({ status: "COMPLETED" });
      expect(requests).toHaveLength(1); expect(requests[0]!.key).toBe(config.apiKey);
      expect(requests[0]!.body).toMatchObject({ source: "1C", receipts: [expect.objectContaining({ quantity: "10", unitCost: "100" })] });
      snapshot.generatedAt = "2026-09-26T07:00:00Z";
      await expect(syncBkzSnapshot(root, local, snapshot, mapping)).resolves.toMatchObject({ status: "UNCHANGED" });
      expect(requests).toHaveLength(1);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
