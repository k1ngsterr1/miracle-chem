import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
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
