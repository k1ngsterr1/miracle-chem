import {
  convertQuantity,
  deviation,
  plannedComponentQuantity,
  recipeScaleFactor,
} from "@betonflow/domain";
import { Decimal } from "decimal.js";
import {
  AuditEntityType,
  MaterialMovementType,
  Prisma,
  ProductLotStatus,
  ProductMovementType,
  ProductionBatchStatus,
  RecipeStatus,
  type Unit,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";
import { runIdempotent } from "../lib/idempotency.js";
import { writeAudit } from "../lib/audit.js";
import { startOfAlmatyDay } from "../lib/date-filter.js";

export interface CreateBatchInput {
  number: string;
  scheduledAt: Date;
  recipeVersionId: string;
  plannedVolume: string;
  plannedVolumeUnit: Unit;
  operatorId: string;
  productionLineId?: string;
  productionTankId?: string;
  comments?: string;
}

export interface ConsumptionComponentInput {
  batchComponentId: string;
  actualQuantity: string;
  actualUnit: Unit;
  lossQuantity?: string;
  lossUnit?: Unit;
}

export interface ConfirmConsumptionInput {
  components: ConsumptionComponentInput[];
  allowNegativeStock?: boolean;
  overrideReason?: string;
}

export interface CompleteBatchInput {
  productLotNumber: string;
  actualVolume: string;
  actualVolumeUnit: Unit;
  actualOutput: string;
  goodOutput: string;
  rejectedOutput: string;
  technologicalLoss: string;
  outputUnit: Unit;
  densityKgPerM3?: string;
  qualitySummary?: Prisma.InputJsonValue;
  comments?: string;
}

const BUILT_IN_FORMULAS = [
  { code: "planned-component", expression: "normPerM3 * plannedVolumeM3" },
  { code: "scale-factor", expression: "requiredVolume / baseVolume" },
  { code: "water-cement-ratio", expression: "waterMass / cementMass" },
  { code: "deviation-percent", expression: "(actual - planned) / planned * 100" },
  { code: "unit-cost", expression: "batchCost / actualOutput" },
];

export async function createBatch(
  workspaceId: string,
  actorId: string,
  input: CreateBatchInput,
) {
  return prisma.$transaction(async (tx) => {
    const recipeVersion = await tx.recipeVersion.findFirst({
      where: { id: input.recipeVersionId, workspaceId },
      include: {
        recipe: true,
        components: { include: { material: true }, orderBy: { position: "asc" } },
      },
    });
    if (recipeVersion === null) {
      throw new ApiError(404, "RECIPE_VERSION_NOT_FOUND", "Версия рецептуры не найдена");
    }
    if (recipeVersion.recipe.status !== RecipeStatus.ACTIVE) {
      throw new ApiError(422, "RECIPE_NOT_ACTIVE", "Для замеса нужна активная рецептура");
    }
    const operator = await tx.user.findFirst({ where: { id: input.operatorId, workspaceId, active: true } });
    if (operator === null) throw new ApiError(422, "OPERATOR_NOT_FOUND", "Оператор не найден");
    const lineCandidates = await tx.productionLine.findMany({
      where: {
        workspaceId,
        active: true,
        ...(input.productionLineId === undefined ? {} : { id: input.productionLineId }),
      },
      take: 2,
    });
    const line = lineCandidates.length === 1 ? lineCandidates[0] ?? null : null;
    if (line === null) {
      throw new ApiError(
        422,
        input.productionLineId === undefined && lineCandidates.length > 1 ? "LINE_REQUIRED" : "LINE_NOT_FOUND",
        input.productionLineId === undefined && lineCandidates.length > 1 ? "Выберите производственную линию" : "Производственная линия не найдена",
      );
    }
    const tankCandidates = await tx.productionTank.findMany({
      where: {
        workspaceId,
        productionLineId: line.id,
        active: true,
        ...(input.productionTankId === undefined ? {} : { id: input.productionTankId }),
      },
      take: 2,
    });
    const tank = tankCandidates.length === 1 ? tankCandidates[0] ?? null : null;
    if (tank === null) {
      throw new ApiError(
        422,
        input.productionTankId === undefined && tankCandidates.length > 1 ? "TANK_REQUIRED" : "TANK_NOT_FOUND",
        input.productionTankId === undefined && tankCandidates.length > 1 ? "Выберите производственный чан" : "Производственный чан не найден",
      );
    }

    const plannedVolumeM3 = convertQuantity(
      { value: input.plannedVolume, unit: input.plannedVolumeUnit },
      "M3",
    ).value;
    const baseVolumeM3 = convertQuantity(
      { value: recipeVersion.baseBatchVolume.toString(), unit: recipeVersion.volumeUnit },
      "M3",
    ).value;
    const scaleFactor = recipeScaleFactor(plannedVolumeM3, baseVolumeM3);
    const plannedOutput = new Decimal(recipeVersion.plannedYield.toString()).mul(scaleFactor);
    const recipeSnapshot = recipeToSnapshot(recipeVersion);

    const batch = await tx.productionBatch.create({
      data: {
        workspaceId,
        number: input.number,
        scheduledAt: input.scheduledAt,
        recipeVersionId: recipeVersion.id,
        recipeSnapshot,
        formulaSnapshot: BUILT_IN_FORMULAS,
        concreteGrade: recipeVersion.concreteGrade,
        plannedVolume: input.plannedVolume,
        plannedVolumeUnit: input.plannedVolumeUnit,
        plannedOutput: plannedOutput.toString(),
        plannedOutputUnit: recipeVersion.yieldUnit,
        actualVolumeUnit: input.plannedVolumeUnit,
        actualOutputUnit: recipeVersion.yieldUnit,
        outputAccountingUnit: recipeVersion.yieldUnit,
        operatorId: operator.id,
        productionLineId: line.id,
        productionTankId: tank.id,
        currency: recipeVersion.components[0]?.material.currency ?? "KZT",
        ...(input.comments === undefined ? {} : { comments: input.comments }),
        components: {
          create: recipeVersion.components.map((component) => {
            const plannedInRecipeUnit = plannedComponentQuantity(
              component.normPerM3.toString(),
              plannedVolumeM3,
            );
            const planned = convertQuantity(
              { value: plannedInRecipeUnit, unit: component.unit },
              component.material.baseUnit,
              component.material.densityKgPerM3?.toString(),
            );
            return {
              materialId: component.materialId,
              materialNameSnapshot: component.material.name,
              materialTypeSnapshot: component.material.type,
              plannedQuantity: planned.value.toString(),
              plannedUnit: component.material.baseUnit,
              reservedUnit: component.material.baseUnit,
              actualUnit: component.material.baseUnit,
              returnedUnit: component.material.baseUnit,
              lossUnit: component.material.baseUnit,
              deviationUnit: component.material.baseUnit,
              allowedDeviationPercent: component.allowedDeviationPercent,
              unitCostSnapshot: component.material.costPerBaseUnit,
              currency: component.material.currency,
              moisturePercent: component.moisturePercent,
              absorptionPercent: component.absorptionPercent,
            };
          }),
        },
      },
      include: { components: { include: { material: true } }, recipeVersion: true },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "BATCH_PLANNED",
      entityType: AuditEntityType.PRODUCTION_BATCH,
      entityId: batch.id,
      after: {
        number: batch.number,
        recipeVersionId: batch.recipeVersionId,
        plannedVolume: batch.plannedVolume.toString(),
        plannedVolumeUnit: batch.plannedVolumeUnit,
      },
    });
    return batch;
  });
}

export async function startBatch(
  workspaceId: string,
  actorId: string,
  batchId: string,
  idempotencyKey: string,
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(tx, {
        workspaceId,
        scope: `batch-start:${batchId}`,
        key: idempotencyKey,
        payload: { batchId },
      }, async () => {
        const batch = await tx.productionBatch.findFirst({
          where: { id: batchId, workspaceId },
          include: { components: { include: { material: true } } },
        });
        if (batch === null) throw new ApiError(404, "BATCH_NOT_FOUND", "Замес не найден");
        if (batch.status !== ProductionBatchStatus.PLANNED) {
          throw new ApiError(409, "INVALID_BATCH_STATUS", "Запустить можно только запланированный замес", {
            status: batch.status,
          });
        }

        for (const component of batch.components) {
          let remaining = new Decimal(component.plannedQuantity.toString());
          const lots = await tx.materialLot.findMany({
            where: {
              workspaceId,
              materialId: component.materialId,
              availableQuantity: { gt: 0 },
              OR: [{ expiresAt: null }, { expiresAt: { gte: startOfAlmatyDay(new Date()) } }],
            },
            orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
          });
          for (const lot of lots) {
            if (remaining.lte(0)) break;
            const free = new Decimal(lot.availableQuantity.toString()).sub(lot.reservedQuantity.toString());
            if (free.lte(0)) continue;
            const reserve = Decimal.min(free, remaining);
            const reservedBefore = new Decimal(lot.reservedQuantity.toString());
            await tx.materialLot.update({
              where: { id: lot.id },
              data: { reservedQuantity: reservedBefore.add(reserve).toString() },
            });
            await tx.batchMaterialAllocation.create({
              data: {
                batchComponentId: component.id,
                materialLotId: lot.id,
                reservedQuantity: reserve.toString(),
                unit: component.plannedUnit,
                unitCostSnapshot: lot.unitCost,
              },
            });
            await tx.materialMovement.create({
              data: {
                workspaceId,
                materialLotId: lot.id,
                batchId: batch.id,
                type: MaterialMovementType.RESERVATION,
                quantity: reserve.toString(),
                unit: component.plannedUnit,
                baseQuantity: reserve.toString(),
                baseUnit: component.plannedUnit,
                stockBefore: lot.availableQuantity,
                stockAfter: lot.availableQuantity,
                reservedBefore: reservedBefore.toString(),
                reservedAfter: reservedBefore.add(reserve).toString(),
                idempotencyKey,
              },
            });
            remaining = remaining.sub(reserve);
          }
          if (remaining.gt(0)) {
            throw new ApiError(
              409,
              "INSUFFICIENT_STOCK",
              `Недостаточно материала «${component.materialNameSnapshot}»`,
              {
                materialId: component.materialId,
                shortage: remaining.toString(),
                unit: component.plannedUnit,
              },
            );
          }
          await tx.batchComponent.update({
            where: { id: component.id },
            data: { reservedQuantity: component.plannedQuantity },
          });
          await tx.material.update({
            where: { id: component.materialId },
            data: { reservedStock: { increment: component.plannedQuantity } },
          });
        }

        const updated = await tx.productionBatch.update({
          where: { id: batch.id },
          data: { status: ProductionBatchStatus.IN_PROGRESS, startedAt: new Date() },
        });
        await writeAudit(tx, {
          workspaceId,
          actorId,
          action: "BATCH_STARTED_AND_MATERIALS_RESERVED",
          entityType: AuditEntityType.PRODUCTION_BATCH,
          entityId: batch.id,
          before: { status: batch.status },
          after: { status: updated.status, startedAt: updated.startedAt?.toISOString() ?? null },
        });
        return {
          batchId: batch.id,
          status: updated.status,
          startedAt: updated.startedAt?.toISOString() ?? null,
        } satisfies Prisma.InputJsonObject;
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 },
  );
}

export async function confirmBatchConsumption(
  workspaceId: string,
  actorId: string,
  batchId: string,
  idempotencyKey: string,
  input: ConfirmConsumptionInput,
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(tx, {
        workspaceId,
        scope: `batch-consumption:${batchId}`,
        key: idempotencyKey,
        payload: input as unknown as Prisma.InputJsonValue,
      }, async () => {
        const batch = await tx.productionBatch.findFirst({
          where: { id: batchId, workspaceId },
          include: {
            components: {
              include: {
                material: true,
                allocations: { include: { materialLot: true } },
              },
            },
            materialMovements: {
              where: { type: MaterialMovementType.CONSUMPTION },
              take: 1,
            },
          },
        });
        if (batch === null) throw new ApiError(404, "BATCH_NOT_FOUND", "Замес не найден");
        if (batch.status !== ProductionBatchStatus.IN_PROGRESS) {
          throw new ApiError(409, "INVALID_BATCH_STATUS", "Факт можно подтвердить только для активного замеса");
        }
        if (batch.materialMovements.length > 0) {
          throw new ApiError(
            409,
            "CONSUMPTION_ALREADY_CONFIRMED",
            "Фактический расход по этому замесу уже подтверждён",
          );
        }
        if (input.components.length !== batch.components.length) {
          throw new ApiError(400, "ALL_COMPONENTS_REQUIRED", "Передайте факт по каждому компоненту замеса");
        }

        for (const component of batch.components) {
          const actualInput = input.components.find((item) => item.batchComponentId === component.id);
          if (actualInput === undefined) {
            throw new ApiError(400, "COMPONENT_FACT_MISSING", `Нет факта для ${component.materialNameSnapshot}`);
          }
          const actual = convertQuantity(
            { value: actualInput.actualQuantity, unit: actualInput.actualUnit },
            component.actualUnit,
            component.material.densityKgPerM3?.toString(),
          ).value;
          const loss = convertQuantity(
            {
              value: actualInput.lossQuantity ?? "0",
              unit: actualInput.lossUnit ?? actualInput.actualUnit,
            },
            component.lossUnit,
            component.material.densityKgPerM3?.toString(),
          ).value;
          if (loss.gt(actual)) {
            throw new ApiError(422, "LOSS_EXCEEDS_CONSUMPTION", "Потери не могут превышать фактический расход");
          }
          const materialStock = new Decimal(component.material.currentStock.toString());
          if (materialStock.lt(actual) && input.allowNegativeStock !== true) {
            throw new ApiError(409, "INSUFFICIENT_STOCK", `Недостаточно ${component.materialNameSnapshot}`, {
              available: materialStock.toString(),
              requested: actual.toString(),
              unit: component.actualUnit,
            });
          }

          let remaining = actual;
          let released = new Decimal(0);
          for (const allocation of component.allocations) {
            const reserved = new Decimal(allocation.reservedQuantity.toString());
            const consumed = Decimal.min(remaining, reserved);
            const returned = reserved.sub(consumed);
            const lot = allocation.materialLot;
            const availableBefore = new Decimal(lot.availableQuantity.toString());
            const reservedBefore = new Decimal(lot.reservedQuantity.toString());
            await tx.materialLot.update({
              where: { id: lot.id },
              data: {
                availableQuantity: availableBefore.sub(consumed).toString(),
                reservedQuantity: Decimal.max(0, reservedBefore.sub(reserved)).toString(),
              },
            });
            await tx.batchMaterialAllocation.update({
              where: { id: allocation.id },
              data: {
                consumedQuantity: consumed.toString(),
                returnedQuantity: returned.toString(),
              },
            });
            if (consumed.gt(0)) {
              await tx.materialMovement.create({
                data: {
                  workspaceId,
                  materialLotId: lot.id,
                  batchId: batch.id,
                  type: MaterialMovementType.CONSUMPTION,
                  quantity: consumed.toString(),
                  unit: component.actualUnit,
                  baseQuantity: consumed.toString(),
                  baseUnit: component.actualUnit,
                  stockBefore: availableBefore.toString(),
                  stockAfter: availableBefore.sub(consumed).toString(),
                  reservedBefore: reservedBefore.toString(),
                  reservedAfter: Decimal.max(0, reservedBefore.sub(reserved)).toString(),
                  idempotencyKey,
                },
              });
            }
            if (returned.gt(0)) {
              await tx.materialMovement.create({
                data: {
                  workspaceId,
                  materialLotId: lot.id,
                  batchId: batch.id,
                  type: MaterialMovementType.RESERVATION_RELEASE,
                  quantity: returned.toString(),
                  unit: component.returnedUnit,
                  baseQuantity: returned.toString(),
                  baseUnit: component.returnedUnit,
                  stockBefore: availableBefore.sub(consumed).toString(),
                  stockAfter: availableBefore.sub(consumed).toString(),
                  reservedBefore: reservedBefore.sub(consumed).toString(),
                  reservedAfter: Decimal.max(0, reservedBefore.sub(reserved)).toString(),
                  idempotencyKey,
                },
              });
            }
            remaining = remaining.sub(consumed);
            released = released.add(returned);
          }

          if (remaining.gt(0)) {
            await consumeUnreservedStock(
              tx,
              workspaceId,
              batch.id,
              component.id,
              component.materialId,
              component.actualUnit,
              remaining,
              idempotencyKey,
              input.allowNegativeStock === true,
            );
          }

          const planned = new Decimal(component.plannedQuantity.toString());
          const absoluteDeviation = actual.sub(planned);
          const deviationPercent = planned.isZero()
            ? new Decimal(0)
            : deviation(actual, planned).percent;
          const withinTolerance = deviationPercent.abs().lte(component.allowedDeviationPercent.toString());
          const consumedAllocations = await tx.batchMaterialAllocation.findMany({
            where: { batchComponentId: component.id, consumedQuantity: { gt: 0 } },
            select: { consumedQuantity: true, unitCostSnapshot: true },
          });
          const componentCost = consumedAllocations.reduce(
            (sum, allocation) => sum.add(
              new Decimal(allocation.consumedQuantity.toString())
                .mul(allocation.unitCostSnapshot.toString()),
            ),
            new Decimal(0),
          );
          await tx.batchComponent.update({
            where: { id: component.id },
            data: {
              actualQuantity: actual.toString(),
              returnedQuantity: released.toString(),
              lossQuantity: loss.toString(),
              deviationQuantity: absoluteDeviation.toString(),
              deviationPercent: deviationPercent.toString(),
              withinTolerance,
              componentCost: componentCost.toString(),
            },
          });
          await tx.material.update({
            where: { id: component.materialId },
            data: {
              currentStock: materialStock.sub(actual).toString(),
              reservedStock: Decimal.max(
                0,
                new Decimal(component.material.reservedStock.toString()).sub(component.reservedQuantity.toString()),
              ).toString(),
            },
          });
        }

        if (input.allowNegativeStock === true) {
          await tx.productionBatch.update({
            where: { id: batch.id },
            data: { negativeStockOverride: true },
          });
        }
        await writeAudit(tx, {
          workspaceId,
          actorId,
          action: "BATCH_CONSUMPTION_CONFIRMED",
          entityType: AuditEntityType.PRODUCTION_BATCH,
          entityId: batch.id,
          after: {
            components: input.components as unknown as Prisma.InputJsonValue,
            negativeStockOverride: input.allowNegativeStock ?? false,
            overrideReason: input.overrideReason ?? null,
          },
        });
        return {
          batchId: batch.id,
          status: batch.status,
          consumptionConfirmed: true,
        } satisfies Prisma.InputJsonObject;
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 },
  );
}

export async function cancelBatch(
  workspaceId: string,
  actorId: string,
  batchId: string,
  idempotencyKey: string,
  reason: string,
) {
  return prisma.$transaction(
    (tx) => runIdempotent(tx, {
      workspaceId,
      scope: `batch-cancel:${batchId}`,
      key: idempotencyKey,
      payload: { batchId, reason },
    }, async () => {
      const batch = await tx.productionBatch.findFirst({
        where: { id: batchId, workspaceId },
        include: {
          components: {
            include: { material: true, allocations: { include: { materialLot: true } } },
          },
          materialMovements: { where: { type: MaterialMovementType.CONSUMPTION }, take: 1 },
        },
      });
      if (batch === null) throw new ApiError(404, "BATCH_NOT_FOUND", "Замес не найден");
      const cancellable: ProductionBatchStatus[] = [
        ProductionBatchStatus.PLANNED,
        ProductionBatchStatus.PREPARATION,
        ProductionBatchStatus.IN_PROGRESS,
      ];
      if (!cancellable.includes(batch.status)) {
        throw new ApiError(409, "INVALID_BATCH_STATUS", "Этот замес уже нельзя отменить");
      }
      if (batch.materialMovements.length > 0) {
        throw new ApiError(409, "CONSUMPTION_ALREADY_CONFIRMED", "После списания факт исправляется корректирующим документом");
      }
      for (const component of batch.components) {
        let released = new Decimal(0);
        for (const allocation of component.allocations) {
          const reserved = new Decimal(allocation.reservedQuantity.toString())
            .sub(allocation.consumedQuantity.toString())
            .sub(allocation.returnedQuantity.toString());
          if (reserved.lte(0)) continue;
          const lot = allocation.materialLot;
          const reservedBefore = new Decimal(lot.reservedQuantity.toString());
          const reservedAfter = Decimal.max(0, reservedBefore.sub(reserved));
          await tx.materialLot.update({
            where: { id: lot.id },
            data: { reservedQuantity: reservedAfter.toString() },
          });
          await tx.batchMaterialAllocation.update({
            where: { id: allocation.id },
            data: { returnedQuantity: { increment: reserved.toString() } },
          });
          await tx.materialMovement.create({
            data: {
              workspaceId,
              materialLotId: lot.id,
              batchId: batch.id,
              type: MaterialMovementType.RESERVATION_RELEASE,
              quantity: reserved.toString(),
              unit: allocation.unit,
              baseQuantity: reserved.toString(),
              baseUnit: allocation.unit,
              stockBefore: lot.availableQuantity,
              stockAfter: lot.availableQuantity,
              reservedBefore: reservedBefore.toString(),
              reservedAfter: reservedAfter.toString(),
              idempotencyKey,
              reason,
            },
          });
          released = released.add(reserved);
        }
        if (released.gt(0)) {
          await tx.batchComponent.update({
            where: { id: component.id },
            data: { returnedQuantity: { increment: released.toString() } },
          });
          await tx.material.update({
            where: { id: component.materialId },
            data: {
              reservedStock: Decimal.max(
                0,
                new Decimal(component.material.reservedStock.toString()).sub(released),
              ).toString(),
            },
          });
        }
      }
      const updated = await tx.productionBatch.update({
        where: { id: batch.id },
        data: {
          status: ProductionBatchStatus.CANCELLED,
          comments: batch.comments === null || batch.comments.trim() === ""
            ? `Отмена: ${reason}`
            : `${batch.comments}\nОтмена: ${reason}`,
        },
      });
      await writeAudit(tx, {
        workspaceId,
        actorId,
        action: "BATCH_CANCELLED",
        entityType: AuditEntityType.PRODUCTION_BATCH,
        entityId: batch.id,
        before: { status: batch.status },
        after: { status: updated.status, reason },
      });
      return { batchId: batch.id, status: updated.status } satisfies Prisma.InputJsonObject;
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 },
  );
}

export async function completeBatch(
  workspaceId: string,
  actorId: string,
  batchId: string,
  idempotencyKey: string,
  input: CompleteBatchInput,
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(tx, {
        workspaceId,
        scope: `batch-complete:${batchId}`,
        key: idempotencyKey,
        payload: input as unknown as Prisma.InputJsonValue,
      }, async () => {
        const batch = await tx.productionBatch.findFirst({
          where: { id: batchId, workspaceId },
          include: {
            components: { include: { allocations: true } },
            materialMovements: { where: { type: MaterialMovementType.CONSUMPTION } },
          },
        });
        if (batch === null) throw new ApiError(404, "BATCH_NOT_FOUND", "Замес не найден");
        if (batch.status !== ProductionBatchStatus.IN_PROGRESS) {
          throw new ApiError(409, "INVALID_BATCH_STATUS", "Завершить можно только активный замес");
        }
        if (batch.materialMovements.length === 0) {
          throw new ApiError(422, "CONSUMPTION_NOT_CONFIRMED", "Сначала подтвердите фактический расход");
        }
        const actualOutput = new Decimal(input.actualOutput);
        const goodOutput = new Decimal(input.goodOutput);
        const rejectedOutput = new Decimal(input.rejectedOutput);
        if (!goodOutput.add(rejectedOutput).eq(actualOutput)) {
          throw new ApiError(
            422,
            "OUTPUT_BALANCE_MISMATCH",
            "Фактический выход должен равняться сумме годного продукта и брака",
          );
        }
        const totalCost = batch.components.reduce(
          (sum, component) => sum.add(component.componentCost.toString()),
          new Decimal(0),
        );
        const cost = {
          total: totalCost,
          perProductUnit: goodOutput.isZero() ? new Decimal(0) : totalCost.div(goodOutput),
        };
        const productLot = await tx.productLot.create({
          data: {
            workspaceId,
            batchId: batch.id,
            number: input.productLotNumber,
            concreteGrade: batch.concreteGrade,
            status: goodOutput.isZero() ? ProductLotStatus.REJECTED : ProductLotStatus.AVAILABLE,
            producedQuantity: actualOutput.toString(),
            goodQuantity: goodOutput.toString(),
            rejectedQuantity: rejectedOutput.toString(),
            lossQuantity: input.technologicalLoss,
            availableQuantity: goodOutput.toString(),
            unit: input.outputUnit,
            ...(input.densityKgPerM3 === undefined ? {} : { densityKgPerM3: input.densityKgPerM3 }),
            totalCost: cost.total.toString(),
            unitCost: cost.perProductUnit.toString(),
            currency: batch.currency,
            ...(input.qualitySummary === undefined ? {} : { qualitySnapshot: input.qualitySummary }),
            materialTrace: {
              create: batch.components.flatMap((component) =>
                component.allocations
                  .filter((allocation) => allocation.consumedQuantity.gt(0))
                  .map((allocation) => ({
                    allocationId: allocation.id,
                    consumedQuantity: allocation.consumedQuantity,
                    unit: allocation.unit,
                  })),
              ),
            },
          },
        });
        await tx.productMovement.create({
          data: {
            workspaceId,
            productLotId: productLot.id,
            type: ProductMovementType.PRODUCTION,
            quantity: goodOutput.toString(),
            unit: input.outputUnit,
            balanceBefore: 0,
            balanceAfter: goodOutput.toString(),
            idempotencyKey,
          },
        });
        const updated = await tx.productionBatch.update({
          where: { id: batch.id },
          data: {
            status:
              goodOutput.isZero() ? ProductionBatchStatus.REJECTED : ProductionBatchStatus.COMPLETED,
            completedAt: new Date(),
            lockedAt: new Date(),
            actualVolume: input.actualVolume,
            actualVolumeUnit: input.actualVolumeUnit,
            actualOutput: input.actualOutput,
            actualOutputUnit: input.outputUnit,
            goodOutput: input.goodOutput,
            rejectedOutput: input.rejectedOutput,
            technologicalLoss: input.technologicalLoss,
            availableOutput: input.goodOutput,
            outputAccountingUnit: input.outputUnit,
            totalCost: cost.total.toString(),
            costPerOutputUnit: cost.perProductUnit.toString(),
            ...(input.qualitySummary === undefined ? {} : { qualitySummary: input.qualitySummary }),
            ...(input.comments === undefined ? {} : { comments: input.comments }),
          },
        });
        await writeAudit(tx, {
          workspaceId,
          actorId,
          action: "BATCH_COMPLETED_AND_LOCKED",
          entityType: AuditEntityType.PRODUCTION_BATCH,
          entityId: batch.id,
          before: { status: batch.status },
          after: {
            status: updated.status,
            productLotId: productLot.id,
            actualOutput: input.actualOutput,
            goodOutput: input.goodOutput,
            totalCost: cost.total.toString(),
          },
        });
        return {
          batchId: batch.id,
          status: updated.status,
          productLotId: productLot.id,
          productLotNumber: productLot.number,
          availableQuantity: productLot.availableQuantity.toString(),
          unit: productLot.unit,
          totalCost: cost.total.toString(),
          costPerOutputUnit: cost.perProductUnit.toString(),
        } satisfies Prisma.InputJsonObject;
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 },
  );
}

async function consumeUnreservedStock(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  batchId: string,
  batchComponentId: string,
  materialId: string,
  unit: Unit,
  requested: Decimal,
  idempotencyKey: string,
  allowNegative: boolean,
): Promise<void> {
  let remaining = requested;
  const lots = await tx.materialLot.findMany({
    where: { workspaceId, materialId },
    orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
  });
  for (const lot of lots) {
    if (remaining.lte(0)) break;
    const available = new Decimal(lot.availableQuantity.toString());
    const reserved = new Decimal(lot.reservedQuantity.toString());
    const free = available.sub(reserved);
    if (free.lte(0)) continue;
    const consumed = Decimal.min(free, remaining);
    await consumeFromLot(
      tx,
      workspaceId,
      batchId,
      batchComponentId,
      lot.id,
      unit,
      consumed,
      available,
      reserved,
      lot.unitCost,
      idempotencyKey,
    );
    remaining = remaining.sub(consumed);
  }
  if (remaining.gt(0)) {
    if (!allowNegative || lots[0] === undefined) {
      throw new ApiError(409, "INSUFFICIENT_STOCK", "Недостаточно свободного складского остатка", {
        materialId,
        shortage: remaining.toString(),
        unit,
      });
    }
    const lot = lots[0];
    const fresh = await tx.materialLot.findUniqueOrThrow({ where: { id: lot.id } });
    await consumeFromLot(
      tx,
      workspaceId,
      batchId,
      batchComponentId,
      lot.id,
      unit,
      remaining,
      new Decimal(fresh.availableQuantity.toString()),
      new Decimal(fresh.reservedQuantity.toString()),
      lot.unitCost,
      idempotencyKey,
    );
  }
}

async function consumeFromLot(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  batchId: string,
  batchComponentId: string,
  materialLotId: string,
  unit: Unit,
  consumed: Decimal,
  availableBefore: Decimal,
  reservedBefore: Decimal,
  unitCost: Prisma.Decimal,
  idempotencyKey: string,
): Promise<void> {
  await tx.materialLot.update({
    where: { id: materialLotId },
    data: { availableQuantity: availableBefore.sub(consumed).toString() },
  });
  await tx.batchMaterialAllocation.upsert({
    where: { batchComponentId_materialLotId: { batchComponentId, materialLotId } },
    create: {
      batchComponentId,
      materialLotId,
      consumedQuantity: consumed.toString(),
      unit,
      unitCostSnapshot: unitCost,
    },
    update: { consumedQuantity: { increment: consumed.toString() } },
  });
  await tx.materialMovement.create({
    data: {
      workspaceId,
      materialLotId,
      batchId,
      type: MaterialMovementType.CONSUMPTION,
      quantity: consumed.toString(),
      unit,
      baseQuantity: consumed.toString(),
      baseUnit: unit,
      stockBefore: availableBefore.toString(),
      stockAfter: availableBefore.sub(consumed).toString(),
      reservedBefore: reservedBefore.toString(),
      reservedAfter: reservedBefore.toString(),
      idempotencyKey,
    },
  });
}

function recipeToSnapshot(recipeVersion: {
  id: string;
  version: number;
  concreteGrade: string;
  baseBatchVolume: Prisma.Decimal;
  volumeUnit: Unit;
  waterCementRatio: Prisma.Decimal | null;
  plannedYield: Prisma.Decimal;
  yieldUnit: Unit;
  technologyInstructions: string;
  snapshotHash: string;
  recipe: { id: string; code: string; name: string };
  components: Array<{
    materialId: string;
    normPerM3: Prisma.Decimal;
    unit: Unit;
    allowedDeviationPercent: Prisma.Decimal;
    moisturePercent: Prisma.Decimal;
    absorptionPercent: Prisma.Decimal;
    material: { code: string; name: string; baseUnit: Unit; costPerBaseUnit: Prisma.Decimal };
  }>;
}): Prisma.InputJsonObject {
  return {
    recipeId: recipeVersion.recipe.id,
    recipeCode: recipeVersion.recipe.code,
    recipeName: recipeVersion.recipe.name,
    recipeVersionId: recipeVersion.id,
    version: recipeVersion.version,
    concreteGrade: recipeVersion.concreteGrade,
    baseBatchVolume: recipeVersion.baseBatchVolume.toString(),
    volumeUnit: recipeVersion.volumeUnit,
    waterCementRatio: recipeVersion.waterCementRatio?.toString() ?? null,
    plannedYield: recipeVersion.plannedYield.toString(),
    yieldUnit: recipeVersion.yieldUnit,
    technologyInstructions: recipeVersion.technologyInstructions,
    snapshotHash: recipeVersion.snapshotHash,
    components: recipeVersion.components.map((component) => ({
      materialId: component.materialId,
      materialCode: component.material.code,
      materialName: component.material.name,
      normPerM3: component.normPerM3.toString(),
      unit: component.unit,
      allowedDeviationPercent: component.allowedDeviationPercent.toString(),
      moisturePercent: component.moisturePercent.toString(),
      absorptionPercent: component.absorptionPercent.toString(),
      baseUnit: component.material.baseUnit,
      unitCost: component.material.costPerBaseUnit.toString(),
    })),
  };
}
