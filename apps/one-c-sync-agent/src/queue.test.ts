import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableQueue } from "./queue.js";
import { sampleFullSnapshot } from "../test/full-snapshot-fixture.js";

const directories: string[] = [];

function sampleDelta(batchId = "1c-2026-09-03-001") {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    batchId,
    generatedAt: "2026-09-03T10:00:00.000Z",
    source: "1C" as const,
    customers: [],
    suppliers: [],
    materials: [],
    receipts: [],
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("durable agent queue", () => {
  it("retains a full financial snapshot and rejects a changed payload with the same batchId", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-full-snapshot-"));
    directories.push(root);
    const queue = new DurableQueue(root);
    await queue.initialize();
    const snapshot = sampleFullSnapshot();
    expect(await queue.enqueue(snapshot)).toMatchObject({ duplicate: false });
    expect(await queue.enqueue(snapshot)).toMatchObject({ duplicate: true });
    const changed = structuredClone(snapshot);
    changed.snapshot.receivables = [{ organizationId: changed.organizationExternalId, amountDebit: "1" }];
    await expect(queue.enqueue(changed)).rejects.toThrow("другим содержимым");
    const entry = await queue.claimNext();
    expect(entry?.kind).toBe("snapshot");
    expect((entry?.delta as typeof snapshot).snapshot.incomingPayments).toHaveLength(1);
    await queue.succeed(entry!);
  });

  it("serializes concurrent writes for the same full-snapshot batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-full-race-"));
    directories.push(root);
    const queue = new DurableQueue(root);
    await queue.initialize();
    const first = sampleFullSnapshot();
    const changed = structuredClone(first);
    changed.snapshot.receivables = [{ amountDebit: "1" }];
    const results = await Promise.allSettled([queue.enqueue(first), queue.enqueue(changed)]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await queue.counts()).pending).toBe(1);
  });

  it("keeps the same batch id once and retains it through retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-agent-"));
    directories.push(root);
    const queue = new DurableQueue(root);
    await queue.initialize();

    expect(await queue.enqueue(sampleDelta())).toEqual({ batchId: "1c-2026-09-03-001", duplicate: false });
    expect(await queue.enqueue(sampleDelta())).toEqual({ batchId: "1c-2026-09-03-001", duplicate: true });
    const first = await queue.claimNext();
    expect(first?.delta.batchId).toBe("1c-2026-09-03-001");
    await queue.retry(first!);
    const retry = await queue.claimNext();
    await queue.succeed(retry!);

    expect(await queue.counts()).toEqual({ pending: 0, sending: 0, sent: 1, failed: 0 });
  });

  it("reports the current batch state independently of older failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-agent-batch-state-"));
    directories.push(root);
    const queue = new DurableQueue(root);
    await queue.initialize();
    await queue.enqueue(sampleDelta("older-failed"));
    await queue.fail((await queue.claimNext())!);
    await queue.enqueue(sampleDelta("current-delivered"));
    await queue.succeed((await queue.claimNext())!);

    expect(await queue.batchState("older-failed")).toBe("failed");
    expect(await queue.batchState("current-delivered")).toBe("sent");
    expect(await queue.batchState("missing-batch")).toBeNull();
    expect((await queue.counts()).failed).toBe(1);
  });

  it("sends recovered backlog in arrival order instead of batch hash order", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-agent-order-"));
    directories.push(root);
    const queue = new DurableQueue(root);
    await queue.initialize();
    const [firstId, secondId] = ["older-snapshot", "newer-snapshot"];
    await queue.enqueue(sampleDelta(firstId));
    await queue.enqueue(sampleDelta(secondId));
    const name = (id: string) => `${createHash("sha256").update(id).digest("hex")}.json`;
    await utimes(join(root, "pending", name(firstId)), new Date("2026-09-01T10:00:00Z"), new Date("2026-09-01T10:00:00Z"));
    await utimes(join(root, "pending", name(secondId)), new Date("2026-09-01T10:01:00Z"), new Date("2026-09-01T10:01:00Z"));
    expect((await new DurableQueue(root).claimNext())?.delta.batchId).toBe(firstId);
  });

  it("keeps the original order when an older snapshot is retried", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-agent-retry-order-"));
    directories.push(root);
    const queue = new DurableQueue(root);
    await queue.initialize();
    await queue.enqueue(sampleDelta("older"));
    const [oldFile] = await readdir(join(root, "pending"));
    const oldTime = new Date("2026-09-01T10:00:00Z");
    await utimes(join(root, "pending", oldFile!), oldTime, oldTime);
    await queue.retry((await queue.claimNext())!);
    await queue.enqueue(sampleDelta("newer"));
    expect((await queue.claimNext())?.delta.batchId).toBe("older");
  });

  it("removes expired sent files when starting", async () => {
    const root = await mkdtemp(join(tmpdir(), "miracle-chem-agent-"));
    directories.push(root);
    const queue = new DurableQueue(root, 1);
    await queue.initialize();
    await queue.enqueue(sampleDelta("1c-2026-09-03-expired"));
    const entry = await queue.claimNext();
    await queue.succeed(entry!);

    const [fileName] = await readdir(join(root, "sent"));
    const expiredAt = new Date(Date.now() - 2 * 86_400_000);
    await utimes(join(root, "sent", fileName!), expiredAt, expiredAt);

    expect(await new DurableQueue(root, 1).initialize()).toEqual({ removedSent: 1 });
    expect(await queue.counts()).toEqual({ pending: 0, sending: 0, sent: 0, failed: 0 });
  });
});
