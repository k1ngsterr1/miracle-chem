import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { ApiError } from "../lib/api-error.js";
import type { ApiRequest } from "../lib/http.js";
import { getRequestContext } from "../lib/request-context.js";
import { requirePermission } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { parseBody } from "../lib/validation.js";
import {
  approveOneCSyncReview,
  listOneCSyncReviews,
  listOneCSyncRuns,
  oneCDeltaSchema,
  requireOneCSyncBinding,
  rejectOneCSyncReview,
  requireOneCSyncKey,
  syncOneCDelta,
} from "../services/one-c-sync-service.js";
import { fullSnapshotSchema, receiveFullSnapshot } from "../services/one-c-full-snapshot-service.js";
import { getOneCFinance } from "../services/one-c-finance-service.js";
import { reconcileLatestOneCWorkspace } from "../services/one-c-reconciliation-service.js";
import { readOneCSourceSection, type OneCSourceSection } from "../services/one-c-source-read-service.js";
import { finalizeOneCArchive, listOneCArchives, oneCArchiveChunkSchema, oneCArchiveStartSchema,
  readOneCArchiveChunk, receiveOneCArchiveChunk, startOneCArchive } from "../services/one-c-archive-service.js";

const resolutionSchema = z.object({ note: z.string().trim().max(1_000).optional() });
const rejectionSchema = z.object({ note: z.string().trim().min(3).max(1_000) });

@Controller("integrations/1c")
export class OneCSyncController {
  /** Called by the outbound Windows Sync Agent beside the offline 1C installation. */
  @Post("sync")
  async sync(@Req() request: ApiRequest, @Body() body: unknown) {
    requireOneCSyncKey(request.headers["x-one-c-sync-key"]);
    const input = parseBody(oneCDeltaSchema, body);
    requireOneCSyncBinding(input);
    if (config.oneCSyncWorkspaceId && input.workspaceId.toLowerCase() === config.oneCSyncWorkspaceId.toLowerCase()) {
      throw new ApiError(409, "ONE_C_FULL_SNAPSHOT_ONLY", "Для рабочего контура 1С разрешён только сверенный полный снимок");
    }
    return syncOneCDelta(input);
  }

  /** Immutable full 1C source snapshot. Operational projections are reconciled separately. */
  @Post("snapshot")
  async snapshot(@Req() request: ApiRequest, @Body() body: unknown) {
    requireOneCSyncKey(request.headers["x-one-c-sync-key"]);
    const input = parseBody(fullSnapshotSchema, body);
    requireOneCSyncBinding(input);
    return receiveFullSnapshot(input);
  }

  @Post("archive/start")
  async archiveStart(@Req() request: ApiRequest, @Body() body: unknown) {
    requireOneCSyncKey(request.headers["x-one-c-sync-key"]);
    const input = parseBody(oneCArchiveStartSchema, body);
    requireOneCSyncBinding(input);
    return startOneCArchive(input);
  }

  @Post("archive/:id/chunks")
  async archiveChunk(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    requireOneCSyncKey(request.headers["x-one-c-sync-key"]);
    return receiveOneCArchiveChunk(id, parseBody(oneCArchiveChunkSchema, body));
  }

  @Post("archive/:id/finalize")
  async archiveFinalize(@Req() request: ApiRequest, @Param("id") id: string) {
    requireOneCSyncKey(request.headers["x-one-c-sync-key"]);
    return finalizeOneCArchive(id);
  }

  @Get("archive")
  async archives(@Req() request: ApiRequest, @Res({ passthrough: true }) response: Response) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ONE_C_ARCHIVE_VIEW");
    response.setHeader("Cache-Control", "no-store");
    return { items: await listOneCArchives(workspaceId) };
  }

  @Get("archive/:id/collections/:key/chunks/:index")
  async archiveRecords(@Req() request: ApiRequest, @Param("id") id: string, @Param("key") key: string,
      @Param("index") index: string, @Res({ passthrough: true }) response: Response) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ONE_C_ARCHIVE_VIEW");
    response.setHeader("Cache-Control", "no-store");
    const chunkIndex = Number(index);
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) throw new ApiError(400, "INVALID_ARCHIVE_CHUNK_INDEX", "Неверный номер порции");
    return readOneCArchiveChunk(workspaceId, actor.id, id, key, chunkIndex);
  }

  @Get("runs")
  async runs(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "MATERIALS_VIEW");
    return { items: await listOneCSyncRuns(workspaceId) };
  }

  @Get("finance")
  async finance(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ACCOUNTING_VIEW");
    return getOneCFinance(workspaceId);
  }

  @Get("reconciliation")
  async reconciliation(@Req() request: ApiRequest, @Res({ passthrough: true }) response: Response) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ONE_C_ARCHIVE_VIEW");
    response.setHeader("Cache-Control", "no-store");
    return reconcileLatestOneCWorkspace(workspaceId);
  }

  @Get("source/:section")
  async sourceSection(@Req() request: ApiRequest, @Param("section") section: string,
      @Res({ passthrough: true }) response: Response) {
    const permission = section === "warehouses" ? "MATERIALS_VIEW"
      : section === "receipts" || section === "contracts" ? "ONE_C_SOURCE_FINANCE_VIEW"
        : section === "specifications" || section === "production" ? "RECIPES_VIEW" : null;
    if (!permission) throw new ApiError(404, "ONE_C_SOURCE_SECTION_NOT_FOUND", "Раздел данных 1С не найден");
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, permission);
    response.setHeader("Cache-Control", "no-store");
    return readOneCSourceSection(workspaceId, actor.id, section as OneCSourceSection);
  }

  @Get("reviews")
  async reviews(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "MATERIALS_VIEW");
    return { items: await listOneCSyncReviews(workspaceId) };
  }

  @Post("reviews/:id/approve")
  async approve(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "MATERIALS_MANAGE");
    const input = parseBody(resolutionSchema, body);
    return approveOneCSyncReview(workspaceId, actor.id, id, input.note);
  }

  @Post("reviews/:id/reject")
  async reject(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "MATERIALS_MANAGE");
    return rejectOneCSyncReview(workspaceId, actor.id, id, parseBody(rejectionSchema, body).note);
  }
}
