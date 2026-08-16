import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AuditEntityType,
  ProductionBatchStatus,
  Prisma,
  QualityCheckStatus,
  Unit,
  UserRole,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { nonNegativeDecimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import {
  completeBatch,
  cancelBatch,
  confirmBatchConsumption,
  createBatch,
  startBatch,
} from "../services/batch-service.js";

const createSchema = z.object({
  number: z.string().trim().min(1).max(80),
  scheduledAt: z.coerce.date(),
  recipeVersionId: z.string().uuid(),
  plannedVolume: positiveDecimalString,
  plannedVolumeUnit: z.nativeEnum(Unit),
  operatorId: z.string().uuid(),
  productionLineId: z.string().uuid(),
  comments: z.string().max(5000).optional(),
});

const consumptionSchema = z.object({
  components: z.array(
    z.object({
      batchComponentId: z.string().uuid(),
      actualQuantity: nonNegativeDecimalString,
      actualUnit: z.nativeEnum(Unit),
      lossQuantity: nonNegativeDecimalString.optional(),
      lossUnit: z.nativeEnum(Unit).optional(),
    }),
  ).min(1),
  allowNegativeStock: z.boolean().optional(),
  overrideReason: z.string().trim().min(5).max(1000).optional(),
});

const completeSchema = z.object({
  productLotNumber: z.string().trim().min(1).max(100),
  actualVolume: positiveDecimalString,
  actualVolumeUnit: z.nativeEnum(Unit),
  actualOutput: positiveDecimalString,
  goodOutput: nonNegativeDecimalString,
  rejectedOutput: nonNegativeDecimalString,
  technologicalLoss: nonNegativeDecimalString,
  outputUnit: z.nativeEnum(Unit),
  densityKgPerM3: positiveDecimalString.optional(),
  qualitySummary: z.record(z.string(), z.unknown()).optional(),
  comments: z.string().max(5000).optional(),
});

const qualitySchema = z.object({
  performedById: z.string().uuid(),
  status: z.nativeEnum(QualityCheckStatus),
  checkedAt: z.coerce.date().optional(),
  slumpMm: nonNegativeDecimalString.optional(),
  temperatureC: z.union([z.string(), z.number()]).transform(String).optional(),
  densityKgPerM3: positiveDecimalString.optional(),
  strengthMpa: nonNegativeDecimalString.optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  comments: z.string().max(5000).optional(),
});

const cancelSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

export async function registerBatchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/batches", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const query = request.query as { status?: string; from?: string; to?: string };
    const status = query.status !== undefined && Object.values(ProductionBatchStatus).includes(query.status as ProductionBatchStatus)
      ? (query.status as ProductionBatchStatus)
      : undefined;
    const items = await prisma.productionBatch.findMany({
      where: {
        workspaceId,
        ...(status === undefined ? {} : { status }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              scheduledAt: {
                ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
                ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
              },
            }),
      },
      include: {
        operator: { select: { id: true, name: true } },
        productionLine: { select: { id: true, code: true, name: true } },
        recipeVersion: { include: { recipe: { select: { name: true, code: true } } } },
        _count: { select: { qualityChecks: true } },
      },
      orderBy: { scheduledAt: "desc" },
      take: 500,
    });
    return { items };
  });

  app.get<{ Params: { id: string } }>("/batches/:id", async (request, reply) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const batch = await prisma.productionBatch.findFirst({
      where: { id: request.params.id, workspaceId },
      include: {
        operator: true,
        productionLine: true,
        recipeVersion: { include: { recipe: true } },
        components: {
          include: {
            material: true,
            allocations: { include: { materialLot: { include: { supplier: true } } } },
          },
        },
        productLots: { include: { materialTrace: { include: { allocation: { include: { materialLot: true } } } } } },
        qualityChecks: { include: { performedBy: true }, orderBy: { checkedAt: "desc" } },
        materialMovements: { include: { materialLot: true }, orderBy: { occurredAt: "desc" } },
      },
    });
    if (batch === null) return reply.status(404).send({ error: { code: "BATCH_NOT_FOUND" } });
    return batch;
  });

  app.post("/batches", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const batch = await createBatch(workspaceId, actor.id, parseBody(createSchema, request.body));
    return reply.status(201).send(batch);
  });

  app.post<{ Params: { id: string } }>("/batches/:id/start", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return startBatch(workspaceId, actor.id, request.params.id, requireIdempotencyKey(request.headers));
  });

  app.post<{ Params: { id: string } }>("/batches/:id/consumption", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(consumptionSchema, request.body);
    if (input.allowNegativeStock === true && actor.role !== UserRole.ADMIN) {
      throw new ApiError(403, "NEGATIVE_STOCK_FORBIDDEN", "Отрицательный остаток может разрешить только администратор");
    }
    if (input.allowNegativeStock === true && input.overrideReason === undefined) {
      throw new ApiError(400, "OVERRIDE_REASON_REQUIRED", "Укажите причину разрешения отрицательного остатка");
    }
    return confirmBatchConsumption(
      workspaceId,
      actor.id,
      request.params.id,
      requireIdempotencyKey(request.headers),
      input,
    );
  });

  app.post<{ Params: { id: string } }>("/batches/:id/complete", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const parsed = parseBody(completeSchema, request.body);
    return completeBatch(
      workspaceId,
      actor.id,
      request.params.id,
      requireIdempotencyKey(request.headers),
      {
        ...parsed,
        qualitySummary: parsed.qualitySummary as Prisma.InputJsonValue | undefined,
      },
    );
  });

  app.post<{ Params: { id: string } }>("/batches/:id/cancel", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(cancelSchema, request.body);
    return cancelBatch(
      workspaceId,
      actor.id,
      request.params.id,
      requireIdempotencyKey(request.headers),
      input.reason,
    );
  });

  app.post<{ Params: { id: string } }>("/batches/:id/quality-checks", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(qualitySchema, request.body);
    const batch = await prisma.productionBatch.findFirst({ where: { id: request.params.id, workspaceId } });
    if (batch === null) throw new ApiError(404, "BATCH_NOT_FOUND", "Замес не найден");
    const performer = await prisma.user.findFirst({ where: { id: input.performedById, workspaceId, active: true } });
    if (performer === null) throw new ApiError(422, "QUALITY_PERFORMER_NOT_FOUND", "Ответственный за контроль не найден");
    const check = await prisma.$transaction(async (tx) => {
      const created = await tx.qualityCheck.create({
        data: {
          workspaceId,
          batchId: batch.id,
          performedById: input.performedById,
          status: input.status,
          checkedAt: input.checkedAt ?? new Date(),
          ...(input.slumpMm === undefined ? {} : { slumpMm: input.slumpMm }),
          ...(input.temperatureC === undefined ? {} : { temperatureC: input.temperatureC }),
          ...(input.densityKgPerM3 === undefined ? {} : { densityKgPerM3: input.densityKgPerM3 }),
          ...(input.strengthMpa === undefined ? {} : { strengthMpa: input.strengthMpa }),
          ...(input.metrics === undefined
            ? {}
            : { metrics: input.metrics as Prisma.InputJsonValue }),
          ...(input.comments === undefined ? {} : { comments: input.comments }),
        },
      });
      await writeAudit(tx, {
        workspaceId,
        actorId: actor.id,
        action: "QUALITY_CHECK_RECORDED",
        entityType: AuditEntityType.QUALITY_CHECK,
        entityId: created.id,
        after: {
          batchId: batch.id,
          performedById: created.performedById,
          status: created.status,
          checkedAt: created.checkedAt.toISOString(),
        },
      });
      return created;
    });
    return reply.status(201).send(check);
  });
}

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const value = headers["idempotency-key"];
  if (typeof value !== "string") {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Добавьте заголовок Idempotency-Key");
  }
  return value;
}
