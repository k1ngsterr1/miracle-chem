import type { FastifyInstance } from "fastify";
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

const createSchema = z.object({
  number: z.string().trim().min(1).max(80).optional(),
  targetType: z.nativeEnum(AdjustmentTargetType),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(5).max(5000),
  changes: z.record(z.string(), z.unknown()),
});

const privilegedRoles: UserRole[] = [UserRole.ADMIN, UserRole.TECHNOLOGIST];

export async function registerAdjustmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/adjustments", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const query = request.query as { status?: string; targetType?: string; targetId?: string };
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
  });

  app.get<{ Params: { id: string } }>("/adjustments/:id", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const row = await prisma.adjustmentDocument.findFirst({
      where: { id: request.params.id, workspaceId },
      include: { createdBy: true, approvedBy: true },
    });
    if (row === null) throw new ApiError(404, "ADJUSTMENT_NOT_FOUND", "Документ корректировки не найден");
    return row;
  });

  app.post("/adjustments", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(createSchema, request.body);
    const result = await createAdjustment(workspaceId, actor.id, {
      ...input,
      changes: input.changes as Prisma.InputJsonObject,
    });
    return reply.status(201).send(result);
  });

  app.post<{ Params: { id: string } }>("/adjustments/:id/approve", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    assertPrivileged(actor.role);
    return approveAdjustment(workspaceId, actor.id, request.params.id);
  });

  app.post<{ Params: { id: string } }>("/adjustments/:id/apply", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    assertPrivileged(actor.role);
    return applyAdjustment(
      workspaceId,
      actor.id,
      request.params.id,
      requireIdempotencyKey(request.headers),
    );
  });
}

function assertPrivileged(role: UserRole): void {
  if (!privilegedRoles.includes(role)) {
    throw new ApiError(403, "ADJUSTMENT_FORBIDDEN", "Согласование и применение доступны администратору или технологу");
  }
}

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const value = headers["idempotency-key"];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Добавьте заголовок Idempotency-Key");
  }
  return value;
}
