import { OneCSyncRunStatus } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";

const STALE_AFTER_MS = 45 * 60 * 1000;

export async function getOneCSyncStatus(workspaceId: string, now = new Date()) {
  const [latest, successful] = await Promise.all([
    prisma.oneCSyncRun.findFirst({ where: { workspaceId, source: "1C_FULL_SNAPSHOT" }, orderBy: { startedAt: "desc" },
      select: { status: true, error: true, startedAt: true } }),
    prisma.oneCSyncRun.findFirst({ where: { workspaceId, source: "1C_FULL_SNAPSHOT", status: OneCSyncRunStatus.COMPLETED,
      summary: { path: ["appliedToOperationalTables"], equals: true } }, orderBy: { generatedAt: "desc" },
      select: { generatedAt: true, completedAt: true } }),
  ]);
  const [baseline, failed] = await Promise.all([
    latest ? Promise.resolve(true) : prisma.oneCSourceSnapshot.findFirst({ where: { workspaceId }, select: { id: true } }),
    prisma.oneCSyncRun.findFirst({ where: { workspaceId, source: "1C_FULL_SNAPSHOT", status: OneCSyncRunStatus.FAILED,
      ...(successful ? { generatedAt: { gte: successful.generatedAt }, completedAt: { gt: successful.completedAt ?? new Date(0) } } : {}) },
      orderBy: { completedAt: "desc" }, select: { error: true } }),
  ]);
  const error = failed?.error as { code?: string; message?: string } | null | undefined;
  return {
    configured: Boolean(latest || baseline),
    state: error ? "ERROR" : !successful ? "WAITING"
      : now.getTime() - successful.generatedAt.getTime() > STALE_AFTER_MS ? "STALE" : "CURRENT",
    snapshotAt: successful?.generatedAt.toISOString() ?? null,
    receivedAt: successful?.completedAt?.toISOString() ?? null,
    error: error ? { code: error.code ?? "ONE_C_SNAPSHOT_FAILED", message: error.message ?? "Ошибка обмена" } : null,
    // Server cannot observe the Windows queue when its network is down.
    queueState: "UNKNOWN",
  };
}
