import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { Decimal } from "decimal.js";
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
import { requireIdempotencyKey, type ApiRequest } from "../lib/http.js";
import {
  completeBatch,
  cancelBatch,
  confirmBatchConsumption,
  createBatch,
  startBatch,
} from "../services/batch-service.js";
import { getBatchEconomics } from "../services/batch-economics-service.js";
import { dayPeriodFromQuery } from "../lib/date-filter.js";

const createSchema = z.object({
  number: z.string().trim().min(1).max(80),
  scheduledAt: z.coerce.date(),
  recipeVersionId: z.string().uuid(),
  plannedVolume: positiveDecimalString,
  plannedVolumeUnit: z.nativeEnum(Unit),
  operatorId: z.string().uuid(),
  productionLineId: z.string().uuid().optional(),
  productionTankId: z.string().uuid().optional(),
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

@Controller("batches")
export class BatchController {
  @Get()
  async list(
    @Req() request: ApiRequest,
    @Query() query: { status?: string; from?: string; to?: string; date?: string },
  ) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const selectedDay = dayPeriodFromQuery(query.date);
    const status = query.status !== undefined && Object.values(ProductionBatchStatus).includes(query.status as ProductionBatchStatus)
      ? (query.status as ProductionBatchStatus)
      : undefined;
    const items = await prisma.productionBatch.findMany({
      where: {
        workspaceId,
        ...(status === undefined ? {} : { status }),
        ...(query.from === undefined && query.to === undefined && selectedDay === undefined
          ? {}
          : {
              scheduledAt: {
                ...(query.from === undefined ? (selectedDay === undefined ? {} : { gte: selectedDay.from }) : { gte: new Date(query.from) }),
                ...(query.to === undefined ? (selectedDay === undefined ? {} : { lte: selectedDay.to }) : { lte: new Date(query.to) }),
              },
            }),
      },
      include: {
        operator: { select: { id: true, name: true } },
        productionLine: { select: { id: true, code: true, name: true } },
        productionTank: { select: { id: true, code: true, name: true } },
        // The list is rendered very frequently (date changes, filters, dashboard).
        // A recipe version also holds all formula components, which belong only on
        // the detail screen; returning that graph here needlessly enlarges every
        // list response.
        recipeVersion: {
          select: {
            id: true,
            version: true,
            concreteGrade: true,
            recipe: { select: { name: true, code: true } },
          },
        },
      },
      orderBy: { scheduledAt: "desc" },
      take: 500,
    });
    return { items };
  }

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const batch = await prisma.productionBatch.findFirst({
      where: { id, workspaceId },
      include: {
        operator: true,
        productionLine: true,
        productionTank: true,
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
    if (batch === null) throw new ApiError(404, "BATCH_NOT_FOUND", "Замес не найден");
    const economics = await getBatchEconomics(workspaceId, batch.id);
    const stockReadiness = buildBatchStockReadiness(batch);
    return { ...batch, economics, stockReadiness };
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createBatch(workspaceId, actor.id, parseBody(createSchema, body));
  }

  @Post(":id/start")
  @HttpCode(HttpStatus.OK)
  async start(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return startBatch(workspaceId, actor.id, id, requireIdempotencyKey(request.headers));
  }

  @Post(":id/consumption")
  @HttpCode(HttpStatus.OK)
  async confirmConsumption(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(consumptionSchema, body);
    if (input.allowNegativeStock === true && actor.role !== UserRole.ADMIN) {
      throw new ApiError(403, "NEGATIVE_STOCK_FORBIDDEN", "Отрицательный остаток может разрешить только администратор");
    }
    if (input.allowNegativeStock === true && input.overrideReason === undefined) {
      throw new ApiError(400, "OVERRIDE_REASON_REQUIRED", "Укажите причину разрешения отрицательного остатка");
    }
    return confirmBatchConsumption(
      workspaceId,
      actor.id,
      id,
      requireIdempotencyKey(request.headers),
      input,
    );
  }

  @Post(":id/complete")
  @HttpCode(HttpStatus.OK)
  async complete(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const parsed = parseBody(completeSchema, body);
    return completeBatch(
      workspaceId,
      actor.id,
      id,
      requireIdempotencyKey(request.headers),
      {
        ...parsed,
        qualitySummary: parsed.qualitySummary as Prisma.InputJsonValue | undefined,
      },
    );
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(cancelSchema, body);
    return cancelBatch(
      workspaceId,
      actor.id,
      id,
      requireIdempotencyKey(request.headers),
      input.reason,
    );
  }

  @Post(":id/quality-checks")
  async addQualityCheck(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(qualitySchema, body);
    const batch = await prisma.productionBatch.findFirst({ where: { id, workspaceId } });
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
    return check;
  }
}

function buildBatchStockReadiness(batch: {
  status: ProductionBatchStatus;
  components: Array<{
    id: string;
    materialNameSnapshot: string;
    plannedQuantity: Prisma.Decimal;
    plannedUnit: Unit;
    material: {
      currentStock: Prisma.Decimal;
      reservedStock: Prisma.Decimal;
      minimumStock: Prisma.Decimal;
      baseUnit: Unit;
    };
  }>;
}) {
  if (batch.status !== ProductionBatchStatus.PLANNED && batch.status !== ProductionBatchStatus.PREPARATION) {
    return { status: "NOT_APPLICABLE" as const, warnings: [] };
  }
  const warnings = batch.components.flatMap((component) => {
    const freeStock = new Decimal(component.material.currentStock.toString())
      .sub(component.material.reservedStock.toString());
    const required = new Decimal(component.plannedQuantity.toString());
    const projectedStock = freeStock.sub(required);
    const minimumStock = new Decimal(component.material.minimumStock.toString());
    const level = freeStock.lte(0)
      ? "OUT_OF_STOCK" as const
      : projectedStock.lt(0)
        ? "SHORTAGE" as const
        : minimumStock.gt(0) && freeStock.lte(minimumStock)
          ? "CRITICAL" as const
          : minimumStock.gt(0) && projectedStock.lte(minimumStock)
            ? "LOW_AFTER_BATCH" as const
            : null;
    if (level === null) return [];
    return [{
      batchComponentId: component.id,
      materialName: component.materialNameSnapshot,
      level,
      freeStock: freeStock.toString(),
      requiredQuantity: required.toString(),
      projectedStock: projectedStock.toString(),
      shortfall: Decimal.max(0, projectedStock.negated()).toString(),
      minimumStock: minimumStock.toString(),
      unit: component.plannedUnit,
    }];
  });
  return {
    status: warnings.some((warning) => ["OUT_OF_STOCK", "SHORTAGE"].includes(warning.level))
      ? "SHORTAGE" as const
      : warnings.length > 0 ? "LOW" as const : "READY" as const,
    warnings,
  };
}
