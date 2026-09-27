import { afterEach, describe, expect, it, vi } from "vitest";
import { CrmSyncError, sendDelta, sendFullSnapshot } from "./sync.js";
import { sampleFullSnapshot } from "../test/full-snapshot-fixture.js";
import type { AgentConfig } from "./types.js";

const config: AgentConfig = {
  crmSyncUrl: "https://crm.example.kz/api/integrations/1c/sync",
  apiKey: "a".repeat(32),
  queueDirectory: "C:\\queue",
  listenHost: "127.0.0.1",
  listenPort: 8261,
  localIngestKey: "b".repeat(32),
  syncIntervalSeconds: 300,
  requestTimeoutSeconds: 30,
  sentRetentionDays: 30,
};

const delta = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  batchId: "1c-2026-09-03-001",
  generatedAt: "2026-09-03T10:00:00.000Z",
  source: "1C" as const,
};

afterEach(() => vi.restoreAllMocks());

describe("CRM delivery", () => {
  it("sends the complete 1C snapshot to the dedicated CRM endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "COMPLETED" }), { status: 201 }));
    await expect(sendFullSnapshot(config, sampleFullSnapshot())).resolves.toMatchObject({ status: "COMPLETED" });
    expect(fetchMock).toHaveBeenCalledWith("https://crm.example.kz/api/integrations/1c/snapshot", expect.objectContaining({
      headers: expect.objectContaining({ "x-one-c-sync-key": config.apiKey }),
      body: expect.stringContaining('"outgoingPayments"'),
    }));
  });

  it("confirms a completed delta and sends the dedicated secret", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 }));
    await expect(sendDelta(config, delta)).resolves.toMatchObject({ status: "COMPLETED" });
    expect(fetchMock).toHaveBeenCalledWith(config.crmSyncUrl, expect.objectContaining({ headers: expect.objectContaining({ "x-one-c-sync-key": config.apiKey }) }));
  });

  it("does not retry validation errors from CRM", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Неверный формат" }), { status: 422 }));
    await expect(sendDelta(config, delta)).rejects.toMatchObject<Partial<CrmSyncError>>({ retryable: false, statusCode: 422 });
  });
});
