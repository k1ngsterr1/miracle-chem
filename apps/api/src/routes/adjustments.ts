import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import {
  AdjustmentStatus,
  AdjustmentTargetType,
  Prisma,
  UserRole,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody } from "../lib/validation.js";
import {
  applyAdjustment,
  approveAdjustment,
  createAdjustment,
} from "../services/adjustment-service.js";
import { requireIdempotencyKey, type ApiRequest } from "../lib/http.js";

const createSchema = z.object({
  number: z.string().trim().min(1).max(80).optional(),
  targetType: z.nativeEnum(AdjustmentTargetType),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(5).max(5000),
  changes: z.record(z.string(), z.unknown()),
});

const privilegedRoles: UserRole[] = [UserRole.ADMIN, UserRole.TECHNOLOGIST];

@Controller("adjustments")
export class AdjustmentController {
  @Get()
  async list(
    @Req() request: ApiRequest,
    @Query() query: { status?: string; targetType?: string; targetId?: string },
  ) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const status = Object.values(AdjustmentStatus).includes(query.status as AdjustmentStatus)
      ? (query.status as AdjustmentStatus)
      : undefined;
    const targetType = Object.values(AdjustmentTargetType).includes(query.targetType as AdjustmentTargetType)
      ? (query.targetType as AdjustmentTargetType)
      : undefined;
    return {
      items: await prisma.adjustmentDocument.findMany({
        where: {
          workspaceId,
          ...(status === undefined ? {} : { status }),
          ...(targetType === undefined ? {} : { targetType }),
          ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
        },
        include: {
          createdBy: { select: { id: true, name: true, role: true } },
          approvedBy: { select: { id: true, name: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    };
  }

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const row = await prisma.adjustmentDocument.findFirst({
      where: { id, workspaceId },
      include: { createdBy: true, approvedBy: true },
    });
    if (row === null) throw new ApiError(404, "ADJUSTMENT_NOT_FOUND", "Документ корректировки не найден");
    return row;
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(createSchema, body);
    return createAdjustment(workspaceId, actor.id, {
      ...input,
      changes: input.changes as Prisma.InputJsonObject,
    });
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  async approve(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    assertPrivileged(actor.role);
    return approveAdjustment(workspaceId, actor.id, id);
  }

  @Post(":id/apply")
  @HttpCode(HttpStatus.OK)
  async apply(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    assertPrivileged(actor.role);
    return applyAdjustment(
      workspaceId,
      actor.id,
      id,
      requireIdempotencyKey(request.headers),
    );
  }
}

function assertPrivileged(role: UserRole): void {
  if (!privilegedRoles.includes(role)) {
    throw new ApiError(403, "ADJUSTMENT_FORBIDDEN", "Согласование и применение доступны администратору или технологу");
  }
}
