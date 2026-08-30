import { convertQuantity } from "@betonflow/domain";
import { Decimal } from "decimal.js";
import {
  AdjustmentStatus,
  AdjustmentTargetType,
  AuditEntityType,
  MaterialMovementType,
  Prisma,
  ProductLotStatus,
  ProductMovementType,
  type Unit,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import { runIdempotent } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";

export interface CreateAdjustmentInput {
  number?: string;
  targetType: AdjustmentTargetType;
  targetId: string;
  reason: string;
  changes: Prisma.InputJsonObject;
}

interface QuantityChange {
  quantityDelta: string;
  unit: Unit;
}

export async function createAdjustment(
  workspaceId: string,
  actorId: string,
  input: CreateAdjustmentInput,
) {
  return prisma.$transaction(async (tx) => {
    const before = await loadTargetSnapshot(tx, workspaceId, input.targetType, input.targetId);
    const adjustment = await tx.adjustmentDocument.create({
      data: {
        workspaceId,
        number: input.number ?? createAdjustmentNumber(),
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        before,
        changes: input.changes,
        createdById: actorId,
      },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "ADJUSTMENT_CREATED",
      entityType: AuditEntityType.ADJUSTMENT,
      entityId: adjustment.id,
      after: adjustmentToJson(adjustment),
    });
    return adjustment;
  });
}

export async function approveAdjustment(workspaceId: string, actorId: string, adjustmentId: string) {
  return prisma.$transaction(async (tx) => {
    const adjustment = await tx.adjustmentDocument.findFirst({
      where: { id: adjustmentId, workspaceId },
    });
    if (adjustment === null) throw new ApiError(404, "ADJUSTMENT_NOT_FOUND", "Документ корректировки не найден");
    if (adjustment.status !== AdjustmentStatus.DRAFT) {
      throw new ApiError(409, "INVALID_ADJUSTMENT_STATUS", "Согласовать можно только черновик корректировки");
    }
    const updated = await tx.adjustmentDocument.update({
      where: { id: adjustment.id },
      data: {
        status: AdjustmentStatus.APPROVED,
        approvedById: actorId,
        approvedAt: new Date(),
      },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "ADJUSTMENT_APPROVED",
      entityType: AuditEntityType.ADJUSTMENT,
      entityId: adjustment.id,
      before: { status: adjustment.status },
      after: { status: updated.status, approvedAt: updated.approvedAt?.toISOString() ?? null },
    });
    return updated;
  });
}

export async function applyAdjustment(
  workspaceId: string,
  actorId: string,
  adjustmentId: string,
  idempotencyKey: string,
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(
        tx,
        {
          workspaceId,
          scope: `adjustment-apply:${adjustmentId}`,
          key: idempotencyKey,
          payload: { adjustmentId },
        },
        async () => {
          const adjustment = await tx.adjustmentDocument.findFirst({
            where: { id: adjustmentId, workspaceId },
          });
          if (adjustment === null) {
            throw new ApiError(404, "ADJUSTMENT_NOT_FOUND", "Документ корректировки не найден");
          }
          if (adjustment.status !== AdjustmentStatus.APPROVED) {
            throw new ApiError(409, "INVALID_ADJUSTMENT_STATUS", "Применить можно только согласованную корректировку");
          }

          const effect = await applyTargetChange(tx, workspaceId, adjustment);
          const updated = await tx.adjustmentDocument.update({
            where: { id: adjustment.id },
            data: {
              status: AdjustmentStatus.APPLIED,
              appliedAt: new Date(),
              idempotencyKey,
            },
          });
          await writeAudit(tx, {
            workspaceId,
            actorId,
            action: "ADJUSTMENT_APPLIED",
            entityType: AuditEntityType.ADJUSTMENT,
            entityId: adjustment.id,
            before: { status: adjustment.status },
            after: {
              status: updated.status,
              appliedAt: updated.appliedAt?.toISOString() ?? null,
              effect,
            },
          });
          return {
            adjustmentId: updated.id,
            status: updated.status,
            appliedAt: updated.appliedAt?.toISOString() ?? null,
            effect,
          } satisfies Prisma.InputJsonObject;
        },
      ),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 },
  );
}

async function applyTargetChange(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  adjustment: {
    id: string;
    targetId: string;
    targetType: AdjustmentTargetType;
    reason: string;
    changes: Prisma.JsonValue;
  },
): Promise<Prisma.InputJsonObject> {
  if (adjustment.targetType === AdjustmentTargetType.MATERIAL_LOT) {
    const change = parseQuantityChange(adjustment.changes);
    const lot = await tx.materialLot.findFirst({ where: { id: adjustment.targetId, workspaceId } });
    if (lot === null) throw new ApiError(404, "MATERIAL_LOT_NOT_FOUND", "Партия материала не найдена");
    const delta = convertQuantity(
      { value: change.quantityDelta, unit: change.unit },
      lot.unit,
      lot.densityKgPerM3?.toString(),
    ).value;
    const before = new Decimal(lot.availableQuantity.toString());
    const after = before.add(delta);
    if (after.isNegative() || after.lt(lot.reservedQuantity.toString())) {
      throw new ApiError(409, "INVALID_ADJUSTED_STOCK", "Корректировка нарушает доступный или зарезервированный остаток");
    }
    const material = await tx.material.findFirst({ where: { id: lot.materialId, workspaceId } });
    if (material === null) throw new ApiError(404, "MATERIAL_NOT_FOUND", "Материал не найден");
    const materialAfter = new Decimal(material.currentStock.toString()).add(delta);
    if (materialAfter.isNegative()) throw new ApiError(409, "INVALID_ADJUSTED_STOCK", "Остаток материала не может быть отрицательным");
    await tx.materialLot.update({ where: { id: lot.id }, data: { availableQuantity: after.toString() } });
    await tx.material.update({ where: { id: material.id }, data: { currentStock: materialAfter.toString() } });
    await tx.materialMovement.create({
      data: {
        workspaceId,
        materialLotId: lot.id,
        type: MaterialMovementType.ADJUSTMENT,
        quantity: delta.toString(),
        unit: lot.unit,
        baseQuantity: delta.toString(),
        baseUnit: lot.unit,
        stockBefore: before.toString(),
        stockAfter: after.toString(),
        reservedBefore: lot.reservedQuantity.toString(),
        reservedAfter: lot.reservedQuantity.toString(),
        idempotencyKey: adjustment.id,
        reason: adjustment.reason,
        metadata: { adjustmentId: adjustment.id },
      },
    });
    return { targetType: adjustment.targetType, quantityDelta: delta.toString(), unit: lot.unit, balanceAfter: after.toString() };
  }

  if (adjustment.targetType === AdjustmentTargetType.PRODUCT_LOT) {
    const change = parseQuantityChange(adjustment.changes);
    const lot = await tx.productLot.findFirst({ where: { id: adjustment.targetId, workspaceId } });
    if (lot === null) throw new ApiError(404, "PRODUCT_LOT_NOT_FOUND", "Партия готовой продукции не найдена");
    const delta = convertQuantity(
      { value: change.quantityDelta, unit: change.unit },
      lot.unit,
      lot.densityKgPerM3?.toString(),
    ).value;
    const before = new Decimal(lot.availableQuantity.toString());
    const after = before.add(delta);
    if (after.isNegative()) throw new ApiError(409, "INVALID_ADJUSTED_BALANCE", "Остаток продукта не может быть отрицательным");
    await tx.productLot.update({
      where: { id: lot.id },
      data: {
        availableQuantity: after.toString(),
        status: after.isZero() ? ProductLotStatus.DEPLETED : ProductLotStatus.AVAILABLE,
      },
    });
    await tx.productionBatch.update({ where: { id: lot.batchId }, data: { availableOutput: after.toString() } });
    await tx.productMovement.create({
      data: {
        workspaceId,
        productLotId: lot.id,
        type: ProductMovementType.ADJUSTMENT,
        quantity: delta.toString(),
        unit: lot.unit,
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
        idempotencyKey: adjustment.id,
        reason: adjustment.reason,
        metadata: { adjustmentId: adjustment.id },
      },
    });
    return { targetType: adjustment.targetType, quantityDelta: delta.toString(), unit: lot.unit, balanceAfter: after.toString() };
  }

  // Completed production records and transfer source documents remain immutable.
  // For these targets the approved correction is an auditable overlay document.
  return { targetType: adjustment.targetType, overlayOnly: true };
}

async function loadTargetSnapshot(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  targetType: AdjustmentTargetType,
  targetId: string,
): Promise<Prisma.InputJsonValue> {
  if (targetType === AdjustmentTargetType.MATERIAL_LOT) {
    const row = await tx.materialLot.findFirst({ where: { id: targetId, workspaceId }, include: { material: true } });
    if (row === null) throw new ApiError(404, "MATERIAL_LOT_NOT_FOUND", "Партия материала не найдена");
    return {
      id: row.id,
      lotNumber: row.lotNumber,
      materialId: row.materialId,
      materialName: row.material.name,
      availableQuantity: row.availableQuantity.toString(),
      reservedQuantity: row.reservedQuantity.toString(),
      unit: row.unit,
    };
  }
  if (targetType === AdjustmentTargetType.PRODUCT_LOT) {
    const row = await tx.productLot.findFirst({ where: { id: targetId, workspaceId } });
    if (row === null) throw new ApiError(404, "PRODUCT_LOT_NOT_FOUND", "Партия готовой продукции не найдена");
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      availableQuantity: row.availableQuantity.toString(),
      unit: row.unit,
    };
  }
  if (targetType === AdjustmentTargetType.PRODUCTION_BATCH) {
    const row = await tx.productionBatch.findFirst({ where: { id: targetId, workspaceId } });
    if (row === null) throw new ApiError(404, "BATCH_NOT_FOUND", "Замес не найден");
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      actualOutput: row.actualOutput?.toString() ?? null,
      availableOutput: row.availableOutput.toString(),
      unit: row.outputAccountingUnit,
      lockedAt: row.lockedAt?.toISOString() ?? null,
    };
  }
  const row = await tx.lrtTransfer.findFirst({ where: { id: targetId, workspaceId } });
  if (row === null) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Отгрузка не найдена");
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    sentAt: row.sentAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}

function parseQuantityChange(value: Prisma.JsonValue): QuantityChange {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ApiError(422, "INVALID_ADJUSTMENT_CHANGE", "Для остатка укажите quantityDelta и unit");
  }
  const quantityDelta = value.quantityDelta;
  const unit = value.unit;
  if (typeof quantityDelta !== "string" || !/^-?\d+(?:\.\d+)?$/u.test(quantityDelta)) {
    throw new ApiError(422, "INVALID_ADJUSTMENT_CHANGE", "quantityDelta должен быть десятичной строкой");
  }
  const units: Unit[] = ["G", "KG", "T", "ML", "L", "M3", "PCS"];
  if (typeof unit !== "string" || !units.includes(unit as Unit)) {
    throw new ApiError(422, "INVALID_ADJUSTMENT_CHANGE", "Укажите допустимую единицу измерения");
  }
  return { quantityDelta, unit: unit as Unit };
}

function createAdjustmentNumber(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
  return `ADJ-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function adjustmentToJson(value: {
  id: string;
  number: string;
  status: AdjustmentStatus;
  targetType: AdjustmentTargetType;
  targetId: string;
  reason: string;
}): Prisma.InputJsonObject {
  return {
    id: value.id,
    number: value.number,
    status: value.status,
    targetType: value.targetType,
    targetId: value.targetId,
    reason: value.reason,
  };
}
