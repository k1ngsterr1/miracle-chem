import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
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
  rejectOneCSyncReview,
  requireOneCSyncKey,
  syncOneCDelta,
} from "../services/one-c-sync-service.js";

const resolutionSchema = z.object({ note: z.string().trim().max(1_000).optional() });
const rejectionSchema = z.object({ note: z.string().trim().min(3).max(1_000) });

@Controller("integrations/1c")
export class OneCSyncController {
  /** Called by the outbound Windows Sync Agent beside the offline 1C installation. */
  @Post("sync")
  async sync(@Req() request: ApiRequest, @Body() body: unknown) {
    requireOneCSyncKey(request.headers["x-one-c-sync-key"]);
    return syncOneCDelta(parseBody(oneCDeltaSchema, body));
  }

  @Get("runs")
  async runs(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "MATERIALS_VIEW");
    return { items: await listOneCSyncRuns(workspaceId) };
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
