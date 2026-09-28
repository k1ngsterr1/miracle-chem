import { createServer, request as httpRequest, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleFullSnapshot } from "../test/full-snapshot-fixture.js";
import { SyncAgent } from "./runtime.js";
import { readLocalAgentStatus, readLocalBatchState, submitSnapshotToAgent } from "./local-client.js";
import type { AgentConfig } from "./types.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function post(port: number, path: string, payload: unknown, key: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method: "POST",
      headers: { "content-type": "application/json", "x-agent-ingest-key": key } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown }));
    });
    request.on("error", reject);
    request.end(JSON.stringify(payload));
  });
}

describe("native 1C full snapshot ingress", () => {
  it("keeps the serve process as queue owner while CLI-like status requests run", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-single-consumer-"));
    roots.push(root);
    let releaseRemote!: () => void;
    let remoteAccepted!: () => void;
    const remoteStarted = new Promise<void>((resolve) => { remoteAccepted = resolve; });
    const remote = createServer((request, response: ServerResponse) => {
      request.resume();
      remoteAccepted();
      releaseRemote = () => response.end(JSON.stringify({ status: "COMPLETED" }));
      response.setHeader("content-type", "application/json");
    });
    await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
    const remotePort = (remote.address() as AddressInfo).port;
    const config: AgentConfig = { crmSyncUrl: `http://127.0.0.1:${remotePort}/api/integrations/1c/sync`,
      apiKey: "a".repeat(32), queueDirectory: join(root, "queue"), listenHost: "127.0.0.1", listenPort: 0,
      localIngestKey: "b".repeat(32), syncIntervalSeconds: 900, requestTimeoutSeconds: 5, sentRetentionDays: 30 };
    const agent = new SyncAgent(config);
    await agent.initialize();
    const local = await agent.serve();
    const localConfig = { ...config, listenPort: (local.address() as AddressInfo).port };
    try {
      expect(await submitSnapshotToAgent(localConfig, sampleFullSnapshot())).toMatchObject({ duplicate: false });
      await remoteStarted;
      expect(await readLocalBatchState(localConfig, "1c-full-snapshot-001")).toBe("sending");
      expect((await readLocalAgentStatus(localConfig)).queue).toMatchObject({ sending: 1, pending: 0 });
      await expect(new SyncAgent(localConfig).serve()).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(await readLocalBatchState(localConfig, "1c-full-snapshot-001")).toBe("sending");
      releaseRemote();
      for (let attempt = 0; attempt < 100 && await readLocalBatchState(localConfig, "1c-full-snapshot-001") !== "sent"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(await readLocalBatchState(localConfig, "1c-full-snapshot-001")).toBe("sent");
    } finally {
      await new Promise<void>((resolve) => local.close(() => resolve()));
      await new Promise<void>((resolve) => remote.close(() => resolve()));
    }
  });

  it("rejects an oversized snapshot before adding it to the durable queue", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-oversized-snapshot-"));
    roots.push(root);
    const config: AgentConfig = { crmSyncUrl: "https://crm.example.kz/api/integrations/1c/sync",
      apiKey: "a".repeat(32), queueDirectory: join(root, "queue"), listenHost: "127.0.0.1", listenPort: 0,
      localIngestKey: "b".repeat(32), syncIntervalSeconds: 900, requestTimeoutSeconds: 30, sentRetentionDays: 30 };
    const agent = new SyncAgent(config);
    await agent.initialize();
    const snapshot = sampleFullSnapshot();
    snapshot.snapshot.organizations[0]!.name = "X".repeat(10 * 1024 * 1024);
    await expect(agent.enqueueSnapshot(snapshot)).rejects.toThrow("превышает лимит CRM");
    expect((await agent.status()).queue).toEqual({ pending: 0, sending: 0, sent: 0, failed: 0 });
  });

  it("requires the local key and acknowledges only after durable queueing", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-snapshot-http-"));
    roots.push(root);
    const config: AgentConfig = { crmSyncUrl: "https://crm.example.kz/api/integrations/1c/sync",
      apiKey: "a".repeat(32), queueDirectory: join(root, "queue"),
      listenHost: "127.0.0.1", listenPort: 0, localIngestKey: "b".repeat(32),
      syncIntervalSeconds: 900, requestTimeoutSeconds: 5, sentRetentionDays: 30 };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "COMPLETED" }), { status: 201 }));
    const agent = new SyncAgent(config);
    await agent.initialize();
    const server = await agent.serve();
    try {
      const port = (server.address() as AddressInfo).port;
      expect((await post(port, "/v1/snapshot", sampleFullSnapshot(), "wrong-key")).status).toBe(401);
      const accepted = await post(port, "/v1/snapshot", sampleFullSnapshot(), config.localIngestKey);
      expect(accepted).toMatchObject({ status: 202, body: { queued: true, batchId: "1c-full-snapshot-001" } });
      let queue = (await agent.status()).queue as Record<string, number>;
      for (let attempt = 0; attempt < 100 && queue.sent !== 1; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        queue = (await agent.status()).queue as Record<string, number>;
      }
      expect(queue).toEqual({ pending: 0, sending: 0, sent: 1, failed: 0 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
