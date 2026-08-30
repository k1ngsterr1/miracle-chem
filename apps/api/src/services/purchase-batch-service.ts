import { convertQuantity } from "@betonflow/domain";
import { Decimal } from "decimal.js";
import type { DayPeriod } from "../lib/date-filter.js";
import {
  AuditEntityType,
  MaterialMovementType,
  Prisma,
  type Unit,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import { runIdempotent } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";

export interface PurchaseBatchItemInput {
  materialId: string;
  supplierName?: string;
  quantity: string;
  unit: Unit;
  unitCost: string;
  expiresAt?: Date;
  certificateNumber?: string;
}

export interface CreatePurchaseBatchInput {
  number: string;
  receivedAt: Date;
  recipeVersionId?: string;
  targetSalePrice?: string;
  currency?: string;
  notes?: string;
  items: PurchaseBatchItemInput[];
}

const purchaseBatchInclude = {
  materialLots: {
    include: {
      material: true,
      supplier: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  recipeVersion: {
    include: {
      recipe: { select: { id: true, code: true, name: true } },
      components: {
        include: { material: true },
        orderBy: { position: "asc" },
      },
    },
  },
} satisfies Prisma.PurchaseBatchInclude;

export async function createPurchaseBatch(
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
  input: CreatePurchaseBatchInput,
) {
  return prisma.$transaction(
    (tx) => runIdempotent(tx, {
      workspaceId,
      scope: "purchase-batch",
      key: idempotencyKey,
      payload: serializePurchaseBatch(input),
    }, async () => {
      const existing = await tx.purchaseBatch.findUnique({
        where: { workspaceId_number: { workspaceId, number: input.number } },
        select: { id: true },
      });
      if (existing !== null) {
        throw new ApiError(409, "PURCHASE_BATCH_EXISTS", "Партия закупки с таким номером уже существует");
      }

      const materialIds = input.items.map((item) => item.materialId);
      if (new Set(materialIds).size !== materialIds.length) {
        throw new ApiError(400, "DUPLICATE_PURCHASE_MATERIAL", "Один реагент нельзя добавить в партию дважды");
      }
      const materials = await tx.material.findMany({
        where: { workspaceId, active: true, id: { in: materialIds } },
      });
      if (materials.length !== materialIds.length) {
        throw new ApiError(404, "PURCHASE_MATERIAL_NOT_FOUND", "Один из реагентов не найден");
      }
      if (input.recipeVersionId !== undefined) {
        const recipeVersion = await tx.recipeVersion.findFirst({
          where: { id: input.recipeVersionId, workspaceId },
          select: { id: true },
        });
        if (recipeVersion === null) {
          throw new ApiError(404, "RECIPE_VERSION_NOT_FOUND", "Рецептура для расчёта не найдена");
        }
      }

      const batch = await tx.purchaseBatch.create({
        data: {
          workspaceId,
          number: input.number,
          receivedAt: input.receivedAt,
          ...(input.recipeVersionId === undefined ? {} : { recipeVersionId: input.recipeVersionId }),
          ...(input.targetSalePrice === undefined ? {} : { targetSalePrice: input.targetSalePrice }),
          currency: input.currency ?? "KZT",
          ...(input.notes === undefined ? {} : { notes: input.notes }),
        },
      });

      const createdLots: Prisma.InputJsonObject[] = [];
      for (const [index, item] of input.items.entries()) {
        const material = materials.find((candidate) => candidate.id === item.materialId);
        if (material === undefined) continue;
        const density = material.densityKgPerM3?.toString();
        const normalized = convertQuantity(
          { value: item.quantity, unit: item.unit },
          material.baseUnit,
          density,
        );
        const normalizedCost = new Decimal(item.unitCost)
          .mul(item.quantity)
          .div(normalized.value);

        let supplierId: string | undefined;
        if (item.supplierName !== undefined) {
          const supplier = await tx.supplier.upsert({
            where: { workspaceId_name: { workspaceId, name: item.supplierName } },
            create: { workspaceId, name: item.supplierName },
            update: { active: true },
          });
          supplierId = supplier.id;
        }

        const lot = await tx.materialLot.create({
          data: {
            workspaceId,
            purchaseBatchId: batch.id,
            materialId: material.id,
            ...(supplierId === undefined ? {} : { supplierId }),
            lotNumber: `${input.number}-${String(index + 1).padStart(2, "0")}`,
            receivedAt: input.receivedAt,
            ...(item.expiresAt === undefined ? {} : { expiresAt: item.expiresAt }),
            ...(item.certificateNumber === undefined ? {} : { certificateNumber: item.certificateNumber }),
            initialQuantity: normalized.value.toString(),
            availableQuantity: normalized.value.toString(),
            unit: material.baseUnit,
            unitCost: normalizedCost.toString(),
            currency: input.currency ?? material.currency,
            ...(density === undefined ? {} : { densityKgPerM3: density }),
          },
        });
        const stockBefore = new Decimal(material.currentStock.toString());
        const stockAfter = stockBefore.add(normalized.value);
        await tx.material.update({
          where: { id: material.id },
          data: {
            currentStock: stockAfter.toString(),
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
            source: "PURCHASE_BATCH",
            referenceId: lot.id,
            note: `Закупочная партия №${batch.number}`,
          },
        });
        await tx.materialMovement.create({
          data: {
            workspaceId,
            materialLotId: lot.id,
            type: MaterialMovementType.RECEIPT,
            quantity: item.quantity,
            unit: item.unit,
            baseQuantity: normalized.value.toString(),
            baseUnit: material.baseUnit,
            stockBefore: stockBefore.toString(),
            stockAfter: stockAfter.toString(),
            reservedBefore: material.reservedStock,
            reservedAfter: material.reservedStock,
            idempotencyKey,
            metadata: { purchaseBatchId: batch.id, purchaseBatchNumber: batch.number },
            occurredAt: input.receivedAt,
          },
        });
        createdLots.push({
          materialLotId: lot.id,
          materialId: material.id,
          quantity: normalized.value.toString(),
          unit: material.baseUnit,
          unitCost: normalizedCost.toDecimalPlaces(4).toString(),
        });
      }

      await writeAudit(tx, {
        workspaceId,
        actorId,
        action: "PURCHASE_BATCH_RECEIVED",
        entityType: AuditEntityType.PURCHASE_BATCH,
        entityId: batch.id,
        after: {
          number: batch.number,
          receivedAt: batch.receivedAt.toISOString(),
          recipeVersionId: batch.recipeVersionId,
          targetSalePrice: batch.targetSalePrice?.toString() ?? null,
          items: createdLots,
        },
      });

      return {
        purchaseBatchId: batch.id,
        number: batch.number,
        itemCount: createdLots.length,
      } satisfies Prisma.InputJsonObject;
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function listPurchaseBatches(workspaceId: string, selectedDay?: DayPeriod) {
  const [batches, suppliers] = await Promise.all([
    prisma.purchaseBatch.findMany({
      where: {
        workspaceId,
        ...(selectedDay === undefined ? {} : { receivedAt: { gte: selectedDay.from, lte: selectedDay.to } }),
      },
      include: purchaseBatchInclude,
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.supplier.findMany({
      where: { workspaceId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { items: batches.map(serializePurchaseBatchResult), suppliers };
}

function serializePurchaseBatchResult(batch: Prisma.PurchaseBatchGetPayload<{ include: typeof purchaseBatchInclude }>) {
  const totalCost = batch.materialLots.reduce(
    (sum, lot) => sum.add(new Decimal(lot.initialQuantity.toString()).mul(lot.unitCost.toString())),
    new Decimal(0),
  );
  const remainingCost = batch.materialLots.reduce(
    (sum, lot) => sum.add(new Decimal(lot.availableQuantity.toString()).mul(lot.unitCost.toString())),
    new Decimal(0),
  );
  const recipeVersion = batch.recipeVersion;
  const components = recipeVersion?.components.map((component) => {
    const requirement = convertQuantity(
      { value: component.normPerM3.toString(), unit: component.unit },
      component.material.baseUnit,
      component.material.densityKgPerM3?.toString(),
    ).value;
    const lots = batch.materialLots.filter((lot) => lot.materialId === component.materialId);
    const receivedInBatch = lots.reduce(
      (sum, lot) => sum.add(lot.initialQuantity.toString()),
      new Decimal(0),
    );
    const remainingInBatch = lots.reduce(
      (sum, lot) => sum.add(lot.availableQuantity.toString()),
      new Decimal(0),
    );
    const freeStock = Decimal.max(
      0,
      new Decimal(component.material.currentStock.toString()).sub(component.material.reservedStock.toString()),
    );
    const maximumOutput = requirement.isZero() ? null : freeStock.div(requirement);
    const outputFromBatch = requirement.isZero() ? null : receivedInBatch.div(requirement);
    return {
      materialId: component.materialId,
      code: component.material.code,
      name: component.material.name,
      requirementPerM3: requirement.toDecimalPlaces(6).toString(),
      unit: component.material.baseUnit,
      receivedInBatch: receivedInBatch.toDecimalPlaces(6).toString(),
      remainingInBatch: remainingInBatch.toDecimalPlaces(6).toString(),
      freeStock: freeStock.toDecimalPlaces(6).toString(),
      remainingAfterOneM3: Decimal.max(0, freeStock.sub(requirement)).toDecimalPlaces(6).toString(),
      maximumOutput: maximumOutput?.toDecimalPlaces(3).toString() ?? null,
      outputFromBatch: outputFromBatch?.toDecimalPlaces(3).toString() ?? null,
      unitCost: component.material.costPerBaseUnit.toDecimalPlaces(4).toString(),
      costPerM3: requirement.mul(component.material.costPerBaseUnit.toString()).toDecimalPlaces(4).toString(),
    };
  }) ?? [];
  const availableLimits = components
    .map((component) => component.maximumOutput)
    .filter((value): value is string => value !== null)
    .map((value) => new Decimal(value));
  const batchLimits = components
    .map((component) => component.outputFromBatch)
    .filter((value): value is string => value !== null)
    .map((value) => new Decimal(value));
  const maximumOutput = availableLimits.length === 0 ? new Decimal(0) : Decimal.min(...availableLimits);
  const outputFromBatch = batchLimits.length === 0 ? new Decimal(0) : Decimal.min(...batchLimits);
  const costPerM3 = components.reduce((sum, component) => sum.add(component.costPerM3), new Decimal(0));
  const salePrice = batch.targetSalePrice === null ? null : new Decimal(batch.targetSalePrice.toString());
  const projectedRevenue = salePrice?.mul(maximumOutput) ?? null;
  const projectedProductionCost = costPerM3.mul(maximumOutput);

  return {
    id: batch.id,
    number: batch.number,
    receivedAt: batch.receivedAt,
    currency: batch.currency,
    targetSalePrice: batch.targetSalePrice?.toString() ?? null,
    notes: batch.notes,
    totalCost: totalCost.toDecimalPlaces(2).toString(),
    remainingCost: remainingCost.toDecimalPlaces(2).toString(),
    items: batch.materialLots.map((lot) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      material: {
        id: lot.material.id,
        code: lot.material.code,
        name: lot.material.name,
        baseUnit: lot.material.baseUnit,
      },
      supplier: lot.supplier,
      initialQuantity: lot.initialQuantity.toString(),
      availableQuantity: lot.availableQuantity.toString(),
      reservedQuantity: lot.reservedQuantity.toString(),
      unit: lot.unit,
      unitCost: lot.unitCost.toString(),
      lineCost: new Decimal(lot.initialQuantity.toString()).mul(lot.unitCost.toString()).toDecimalPlaces(2).toString(),
    })),
    forecast: recipeVersion === null ? null : {
      recipe: {
        id: recipeVersion.recipe.id,
        code: recipeVersion.recipe.code,
        name: recipeVersion.recipe.name,
        versionId: recipeVersion.id,
        version: recipeVersion.version,
        concreteGrade: recipeVersion.concreteGrade,
      },
      maximumOutput: maximumOutput.toDecimalPlaces(3).toString(),
      outputFromBatch: outputFromBatch.toDecimalPlaces(3).toString(),
      costPerM3: costPerM3.toDecimalPlaces(2).toString(),
      targetSalePrice: salePrice?.toDecimalPlaces(2).toString() ?? null,
      marginPerM3: salePrice?.sub(costPerM3).toDecimalPlaces(2).toString() ?? null,
      projectedRevenue: projectedRevenue?.toDecimalPlaces(2).toString() ?? null,
      projectedProductionCost: projectedProductionCost.toDecimalPlaces(2).toString(),
      projectedProfit: projectedRevenue?.sub(projectedProductionCost).toDecimalPlaces(2).toString() ?? null,
      components,
    },
  };
}

function serializePurchaseBatch(input: CreatePurchaseBatchInput): Prisma.InputJsonObject {
  return {
    number: input.number,
    receivedAt: input.receivedAt.toISOString(),
    recipeVersionId: input.recipeVersionId ?? null,
    targetSalePrice: input.targetSalePrice ?? null,
    currency: input.currency ?? "KZT",
    notes: input.notes ?? null,
    items: input.items.map((item) => ({
      materialId: item.materialId,
      supplierName: item.supplierName ?? null,
      quantity: item.quantity,
      unit: item.unit,
      unitCost: item.unitCost,
      expiresAt: item.expiresAt?.toISOString() ?? null,
      certificateNumber: item.certificateNumber ?? null,
    })),
  };
}
