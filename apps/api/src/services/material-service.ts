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
  actorId: string,
  idempotencyKey: string,
  input: ReceiveMaterialInput,
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

