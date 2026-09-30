import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOneCSyncStatus } from "./one-c-status-service.js";

const mocks = vi.hoisted(() => ({ run: vi.fn(), baseline: vi.fn() }));
vi.mock("../lib/prisma.js", () => ({ prisma: {
  oneCSyncRun: { findFirst: mocks.run }, oneCSourceSnapshot: { findFirst: mocks.baseline },
} }));

describe("1C data freshness", () => {
  beforeEach(() => { mocks.run.mockReset(); mocks.baseline.mockReset(); });
  it("does not hide an approved source that has never delivered a projected snapshot", async () => {
    mocks.run.mockResolvedValue(null);
    mocks.baseline.mockResolvedValue({ id: "baseline" });
    expect(await getOneCSyncStatus("workspace")).toMatchObject({ configured: true, state: "WAITING", snapshotAt: null });
  });
  it("marks data stale after 45 minutes, not according to the selected UI period", async () => {
    mocks.run.mockResolvedValueOnce({ status: "COMPLETED" })
      .mockResolvedValueOnce({ generatedAt: new Date("2026-09-30T08:00:00Z"), completedAt: new Date("2026-09-30T08:00:05Z") })
      .mockResolvedValueOnce(null);
    expect(await getOneCSyncStatus("workspace", new Date("2026-09-30T08:46:00Z"))).toMatchObject({ state: "STALE" });
  });
  it("shows a failed retry of a newer snapshot even when its initial run predates a success", async () => {
    mocks.run.mockResolvedValueOnce({ status: "COMPLETED" })
      .mockResolvedValueOnce({ generatedAt: new Date("2026-09-30T08:00:00Z"), completedAt: new Date("2026-09-30T08:05:00Z") })
      .mockResolvedValueOnce({ error: { code: "ONE_C_STOCK_CONFLICT", message: "Конфликт" } });
    expect(await getOneCSyncStatus("workspace", new Date("2026-09-30T08:15:00Z"))).toMatchObject({ state: "ERROR" });
    expect(mocks.run.mock.calls[2]?.[0].where).toMatchObject({ status: "FAILED",
      generatedAt: { gte: new Date("2026-09-30T08:00:00Z") }, completedAt: { gt: new Date("2026-09-30T08:05:00Z") } });
  });
});
