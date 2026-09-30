import { convertQuantity } from "@betonflow/domain";
import { Decimal } from "decimal.js";
import {
  AuditEntityType,
  MaterialMovementType,
  Prisma,
  type MaterialType,
  type Unit,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";
import { runIdempotent } from "../lib/idempotency.js";
import { writeAudit } from "../lib/audit.js";
import { startOfAlmatyDay } from "../lib/date-filter.js";
import { requireCrmStockAuthority } from "./one-c-stock-authority-service.js";

export interface CreateMaterialInput {
  code: string;
  name: string;
  type: MaterialType;
  baseUnit: Unit;
  densityKgPerM3?: string;
  costPerBaseUnit: string;
  minimumStock: string;
  currency?: string;
}

export interface ReceiveMaterialInput {
  materialId: string;
  supplierId?: string;
  supplierName?: string;
  lotNumber: string;
  receivedAt: Date;
  expiresAt?: Date;
  certificateNumber?: string;
  certificateUrl?: string;
  quantity: string;
  unit: Unit;
  unitCost: string;
  currency?: string;
  densityKgPerM3?: string;
  qualitySnapshot?: Prisma.InputJsonValue;
}

export interface ConsumeMaterialInput {
  materialId: string;
  quantity: string;
  unit: Unit;
  consumedAt: Date;
  reason: string;
  reference?: string;
}

export async function createMaterial(
  workspaceId: string,
  actorId: string,
  input: CreateMaterialInput,
) {
  return prisma.$transaction(async (tx) => {
    const material = await tx.material.create({
      data: {
        workspaceId,
        code: input.code,
        name: input.name,
        type: input.type,
        baseUnit: input.baseUnit,
        ...(input.densityKgPerM3 === undefined
          ? {}
          : { densityKgPerM3: input.densityKgPerM3 }),
        costPerBaseUnit: input.costPerBaseUnit,
        minimumStock: input.minimumStock,
        currency: input.currency ?? "KZT",
      },
    });
    await tx.materialPriceHistory.create({
      data: {
        workspaceId,
        materialId: material.id,
        pricePerBaseUnit: material.costPerBaseUnit,
        currency: material.currency,
        effectiveAt: material.createdAt,
        source: "INITIAL",
        note: "Начальная учётная цена",
      },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "MATERIAL_CREATED",
      entityType: AuditEntityType.MATERIAL,
      entityId: material.id,
      after: material as unknown as Prisma.InputJsonValue,
    });
    return material;
  });
}

export async function receiveMaterial(
  workspaceId: string,
  actorId: string | undefined,
  idempotencyKey: string,
  input: ReceiveMaterialInput,
  origin: "CRM" | "ONE_C" = "CRM",
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(tx, {
        workspaceId,
        scope: "material-receipt",
        key: idempotencyKey,
        payload: serializeReceipt(input),
      }, async () => {
        const material = await tx.material.findFirst({
          where: { id: input.materialId, workspaceId, active: true },
        });
        if (material === null) {
          throw new ApiError(404, "MATERIAL_NOT_FOUND", "Материал не найден");
        }
        const density = input.densityKgPerM3 ?? material.densityKgPerM3?.toString();
        if (origin === "CRM") await requireCrmStockAuthority(tx, workspaceId, [material.id]);
        const normalized = convertQuantity(
          { value: input.quantity, unit: input.unit },
          material.baseUnit,
          density,
        );
        const normalizedCost = new Decimal(input.unitCost)
          .mul(new Decimal(input.quantity))
          .div(normalized.value);

        let supplierId = input.supplierId;
        if (supplierId === undefined && input.supplierName !== undefined) {
          const supplier = await tx.supplier.upsert({
            where: { workspaceId_name: { workspaceId, name: input.supplierName } },
            create: { workspaceId, name: input.supplierName },
            update: { active: true },
          });
          supplierId = supplier.id;
        }
        const lot = await tx.materialLot.create({
          data: {
            workspaceId,
            materialId: material.id,
            ...(supplierId === undefined ? {} : { supplierId }),
            lotNumber: input.lotNumber,
            receivedAt: input.receivedAt,
            ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
            ...(input.certificateNumber === undefined
              ? {}
              : { certificateNumber: input.certificateNumber }),
            ...(input.certificateUrl === undefined ? {} : { certificateUrl: input.certificateUrl }),
            initialQuantity: normalized.value.toString(),
            availableQuantity: normalized.value.toString(),
            unit: material.baseUnit,
            unitCost: normalizedCost.toString(),
            currency: input.currency ?? material.currency,
            ...(density === undefined ? {} : { densityKgPerM3: density }),
            ...(input.qualitySnapshot === undefined
              ? {}
              : { qualitySnapshot: input.qualitySnapshot }),
          },
        });
        const before = new Decimal(material.currentStock.toString());
        const after = before.add(normalized.value);
        await tx.material.update({
          where: { id: material.id },
          data: {
            currentStock: after.toString(),
            costPerBaseUnit: normalizedCost.toString(),
          },
        });
        await tx.materialPriceHistory.create({
          data: {
            workspaceId,
            materialId: material.id,
            pricePerBaseUnit: normalizedCost.toString(),
            currency: input.currency ?? material.currency,
            effectiveAt: input.receivedAt,
            source: "RECEIPT",
            referenceId: lot.id,
            note: `Приход партии ${lot.lotNumber}`,
          },
        });
        await tx.materialMovement.create({
          data: {
            workspaceId,
            materialLotId: lot.id,
            type: MaterialMovementType.RECEIPT,
            quantity: input.quantity,
            unit: input.unit,
            baseQuantity: normalized.value.toString(),
            baseUnit: material.baseUnit,
            stockBefore: before.toString(),
            stockAfter: after.toString(),
            reservedBefore: material.reservedStock,
            reservedAfter: material.reservedStock,
            idempotencyKey,
          },
        });
        await writeAudit(tx, {
          workspaceId,
          actorId,
          action: "MATERIAL_LOT_RECEIVED",
          entityType: AuditEntityType.MATERIAL_LOT,
          entityId: lot.id,
          after: {
            materialId: material.id,
            lotNumber: lot.lotNumber,
            quantity: normalized.value.toString(),
            unit: material.baseUnit,
          },
        });
        return {
          materialLotId: lot.id,
          materialId: material.id,
          currentStock: after.toString(),
          unit: material.baseUnit,
        } satisfies Prisma.InputJsonObject;
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function consumeMaterial(
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
  input: ConsumeMaterialInput,
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(tx, {
        workspaceId,
        scope: "material-consumption",
        key: idempotencyKey,
        payload: serializeConsumption(input),
      }, async () => {
        const material = await tx.material.findFirst({
          where: { id: input.materialId, workspaceId, active: true },
        });
        if (material === null) {
          throw new ApiError(404, "MATERIAL_NOT_FOUND", "Материал не найден");
        }

        const normalized = convertQuantity(
          { value: input.quantity, unit: input.unit },
          material.baseUnit,
          material.densityKgPerM3?.toString(),
        ).value;
        await requireCrmStockAuthority(tx, workspaceId, [material.id]);
        const freeStock = new Decimal(material.currentStock.toString()).sub(
          material.reservedStock.toString(),
        );
        if (freeStock.lt(normalized)) {
          throw new ApiError(409, "INSUFFICIENT_FREE_STOCK", "Недостаточно свободного остатка", {
            available: Decimal.max(0, freeStock).toString(),
            requested: normalized.toString(),
            unit: material.baseUnit,
          });
        }

        const lots = await tx.materialLot.findMany({
          where: {
            workspaceId,
            materialId: material.id,
            availableQuantity: { gt: 0 },
            OR: [{ expiresAt: null }, { expiresAt: { gte: startOfAlmatyDay(input.consumedAt) } }],
          },
          orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
        });
        let remaining = normalized;
        const allocations: Prisma.InputJsonObject[] = [];

        for (const lot of lots) {
          if (remaining.lte(0)) break;
          const availableBefore = new Decimal(lot.availableQuantity.toString());
          const reservedBefore = new Decimal(lot.reservedQuantity.toString());
          const availableToConsume = Decimal.max(0, availableBefore.sub(reservedBefore));
          if (availableToConsume.lte(0)) continue;
          const consumed = Decimal.min(availableToConsume, remaining);
          const availableAfter = availableBefore.sub(consumed);

          await tx.materialLot.update({
            where: { id: lot.id },
            data: { availableQuantity: availableAfter.toString() },
          });
          await tx.materialMovement.create({
            data: {
              workspaceId,
              materialLotId: lot.id,
              type: MaterialMovementType.CONSUMPTION,
              quantity: consumed.toString(),
              unit: material.baseUnit,
              baseQuantity: consumed.toString(),
              baseUnit: material.baseUnit,
              stockBefore: availableBefore.toString(),
              stockAfter: availableAfter.toString(),
              reservedBefore: reservedBefore.toString(),
              reservedAfter: reservedBefore.toString(),
              idempotencyKey,
              reason: input.reason,
              metadata: {
                operation: "WAREHOUSE_CONSUMPTION",
                reference: input.reference ?? null,
              },
              occurredAt: input.consumedAt,
            },
          });
          allocations.push({
            materialLotId: lot.id,
            lotNumber: lot.lotNumber,
            quantity: consumed.toString(),
            unit: material.baseUnit,
          });
          remaining = remaining.sub(consumed);
        }

        if (remaining.gt(0)) {
          throw new ApiError(409, "INSUFFICIENT_LOT_STOCK", "Свободный остаток не обеспечен партиями", {
            shortage: remaining.toString(),
            unit: material.baseUnit,
          });
        }

        const stockAfter = new Decimal(material.currentStock.toString()).sub(normalized);
        await tx.material.update({
          where: { id: material.id },
          data: { currentStock: stockAfter.toString() },
        });
        await writeAudit(tx, {
          workspaceId,
          actorId,
          action: "WAREHOUSE_MATERIAL_CONSUMED",
          entityType: AuditEntityType.MATERIAL,
          entityId: material.id,
          before: { currentStock: material.currentStock.toString() },
          after: {
            currentStock: stockAfter.toString(),
            quantity: normalized.toString(),
            unit: material.baseUnit,
            reason: input.reason,
            reference: input.reference ?? null,
            allocations,
          },
        });

        return {
          materialId: material.id,
          consumedQuantity: normalized.toString(),
          unit: material.baseUnit,
          currentStock: stockAfter.toString(),
          allocations,
        } satisfies Prisma.InputJsonObject;
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function serializeReceipt(input: ReceiveMaterialInput): Prisma.InputJsonObject {
  return {
    materialId: input.materialId,
    lotNumber: input.lotNumber,
    quantity: input.quantity,
    unit: input.unit,
    unitCost: input.unitCost,
    receivedAt: input.receivedAt.toISOString(),
    ...(input.supplierId === undefined ? {} : { supplierId: input.supplierId }),
    ...(input.supplierName === undefined ? {} : { supplierName: input.supplierName }),
  };
}

function serializeConsumption(input: ConsumeMaterialInput): Prisma.InputJsonObject {
  return {
    materialId: input.materialId,
    quantity: input.quantity,
    unit: input.unit,
    consumedAt: input.consumedAt.toISOString(),
    reason: input.reason,
    reference: input.reference ?? null,
  };
}
