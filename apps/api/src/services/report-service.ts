import { Decimal } from "decimal.js";
import {
  AccountingDocumentStatus,
  AccountingDocumentType,
  ExpenseStatus,
  MaterialMovementType,
  ProductMovementType,
  ProductionBatchStatus,
  Unit,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { MAIN_REAGENTS, matchesMaterial, quantityInKilograms } from "../lib/material-identity.js";

export interface Period {
  from: Date;
  to: Date;
}

export type ProductionGroupBy = "day" | "week" | "month" | "shift" | "grade" | "line" | "operator";
export type BalanceGroupBy = "productLot" | "batch" | "grade" | "line" | "operator";

export async function getDashboard(workspaceId: string, timezone: string, selectedDay?: Period) {
  const today = selectedDay ?? currentDayRange(timezone);
  const activeStatuses: ProductionBatchStatus[] = [
    ProductionBatchStatus.PLANNED,
    ProductionBatchStatus.PREPARATION,
    ProductionBatchStatus.IN_PROGRESS,
  ];
  const analyticsFrom = new Date(today.from.getTime() - 29 * 24 * 60 * 60 * 1000);
  const [consumption, completedBatches, dispatches, availableLots, activeBatches, criticalMaterials, plannedMaterialDemand, deviations, expenses, analyticsBatches, analyticsExpenses, dailyRevenue, receivableDocuments] =
    await Promise.all([
      prisma.materialMovement.findMany({
        where: {
          workspaceId,
          type: MaterialMovementType.CONSUMPTION,
          occurredAt: { gte: today.from, lt: today.to },
        },
        select: { baseQuantity: true, baseUnit: true },
      }),
      prisma.productionBatch.findMany({
        where: { workspaceId, completedAt: { gte: today.from, lt: today.to } },
        select: {
          actualOutput: true,
          actualOutputUnit: true,
          technologicalLoss: true,
          outputAccountingUnit: true,
          totalCost: true,
        },
      }),
      prisma.productMovement.findMany({
        where: {
          workspaceId,
          type: ProductMovementType.LRT_DISPATCH,
          occurredAt: { gte: today.from, lt: today.to },
        },
        select: { quantity: true, unit: true },
      }),
      prisma.productLot.findMany({
        where: { workspaceId, availableQuantity: { gt: 0 } },
        select: { availableQuantity: true, unit: true },
      }),
      prisma.productionBatch.count({ where: { workspaceId, status: { in: activeStatuses } } }),
      prisma.material.findMany({
        where: { workspaceId, active: true },
        orderBy: { currentStock: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          currentStock: true,
          reservedStock: true,
          minimumStock: true,
          baseUnit: true,
          lots: {
            where: { availableQuantity: { gt: 0 } },
            select: { availableQuantity: true, reservedQuantity: true, unit: true },
          },
        },
      }),
      prisma.batchComponent.findMany({
        where: {
          batch: {
            workspaceId,
            status: { in: [ProductionBatchStatus.PLANNED, ProductionBatchStatus.PREPARATION] },
          },
        },
        select: {
          materialId: true,
          plannedQuantity: true,
          plannedUnit: true,
          batch: { select: { id: true, number: true, scheduledAt: true } },
        },
        orderBy: { batch: { scheduledAt: "asc" } },
      }),
      prisma.batchComponent.findMany({
        where: {
          withinTolerance: false,
          batch: { workspaceId, status: { in: activeStatuses } },
        },
        include: { batch: { select: { id: true, number: true } } },
        orderBy: { deviationPercent: "desc" },
        take: 20,
      }),
      prisma.expense.groupBy({
        by: ["currency"],
        where: {
          workspaceId,
          status: ExpenseStatus.RECORDED,
          incurredAt: { gte: today.from, lt: today.to },
        },
        _sum: { amount: true },
      }),
      prisma.productionBatch.findMany({
        where: { workspaceId, scheduledAt: { gte: analyticsFrom, lt: today.to } },
        select: {
          status: true,
          actualOutput: true,
          actualOutputUnit: true,
          technologicalLoss: true,
          productionLine: { select: { name: true } },
        },
      }),
      prisma.expense.findMany({
        where: {
          workspaceId,
          status: ExpenseStatus.RECORDED,
          incurredAt: { gte: new Date(today.from.getTime() - 6 * 24 * 60 * 60 * 1000), lt: today.to },
        },
        select: { incurredAt: true, amount: true, currency: true },
      }),
      prisma.accountingDocument.groupBy({
        by: ["currency"],
        where: {
          workspaceId,
          type: AccountingDocumentType.PAYMENT_INVOICE,
          status: { in: [AccountingDocumentStatus.ISSUED, AccountingDocumentStatus.PAID] },
          documentAt: { gte: today.from, lt: today.to },
        },
        _sum: { totalAmount: true },
      }),
      prisma.accountingDocument.findMany({
        where: {
          workspaceId,
          type: AccountingDocumentType.PAYMENT_INVOICE,
          status: AccountingDocumentStatus.ISSUED,
        },
        select: {
          id: true,
          number: true,
          counterparty: true,
          counterpartyTaxId: true,
          totalAmount: true,
          currency: true,
          documentAt: true,
          dueAt: true,
          transferId: true,
        },
        orderBy: { documentAt: "desc" },
      }),
    ]);

  const outputTotal = sumDecimals(completedBatches.map((batch) => batch.actualOutput?.toString() ?? "0"));
  const lossTotal = sumDecimals(completedBatches.map((batch) => batch.technologicalLoss.toString()));
  const demandByMaterial = plannedMaterialDemand.reduce((map, component) => {
    const current = map.get(component.materialId) ?? new Decimal(0);
    map.set(component.materialId, current.add(component.plannedQuantity.toString()));
    return map;
  }, new Map<string, Decimal>());
  const stockWarnings = criticalMaterials
    .map((material) => {
      const freeStock = material.currentStock.sub(material.reservedStock);
      const plannedDemand = demandByMaterial.get(material.id) ?? new Decimal(0);
      const projectedStock = freeStock.sub(plannedDemand);
      const level = stockWarningLevel(freeStock, projectedStock, material.minimumStock);
      if (level === null) return null;
      const affectedBatches = plannedMaterialDemand
        .filter((component) => component.materialId === material.id)
        .map((component) => ({
          id: component.batch.id,
          number: component.batch.number,
          scheduledAt: component.batch.scheduledAt.toISOString(),
          requiredQuantity: component.plannedQuantity.toString(),
          unit: component.plannedUnit,
        }));
      return {
        id: material.id,
        code: material.code,
        name: material.name,
        baseUnit: material.baseUnit,
        currentStock: material.currentStock.toString(),
        reservedStock: material.reservedStock.toString(),
        freeStock: freeStock.toString(),
        minimumStock: material.minimumStock.toString(),
        plannedDemand: plannedDemand.toString(),
        projectedStock: projectedStock.toString(),
        shortfall: Decimal.max(0, projectedStock.negated()).toString(),
        level,
        affectedBatches,
      };
    })
    .filter((warning): warning is NonNullable<typeof warning> => warning !== null)
    .sort((left, right) => stockWarningRank(left.level) - stockWarningRank(right.level));
  const critical = criticalMaterials
    .filter((material) => stockWarnings.some((warning) => warning.id === material.id))
    .map((material) => ({ ...material, freeStock: material.currentStock.sub(material.reservedStock) }));
  const mainReagents = MAIN_REAGENTS.map((definition) => {
    const materials = criticalMaterials.filter((candidate) => matchesMaterial(candidate, definition));
    if (materials.length === 0) {
      return {
        id: null,
        code: definition.code,
        name: definition.name,
        currentStock: "0",
        reservedStock: "0",
        freeStock: "0",
        minimumStock: "0",
        plannedDemand: "0",
        projectedStock: "0",
        shortfall: "0",
        baseUnit: "KG" as const,
        isCritical: true,
        warningLevel: "MISSING" as const,
        missing: true,
      };
    }
    const lots = materials.flatMap((material) => material.lots);
    const currentStock = lots.length === 0
      ? sumDecimals(materials.map((material) => quantityInKilograms(material.currentStock, material.baseUnit).toString()))
      : sumDecimals(lots.map((lot) => quantityInKilograms(lot.availableQuantity, lot.unit).toString()));
    const reservedStock = lots.length === 0
      ? sumDecimals(materials.map((material) => quantityInKilograms(material.reservedStock, material.baseUnit).toString()))
      : sumDecimals(lots.map((lot) => quantityInKilograms(lot.reservedQuantity, lot.unit).toString()));
    const minimumStock = sumDecimals(materials.map((material) => quantityInKilograms(material.minimumStock, material.baseUnit).toString()));
    const plannedDemand = sumDecimals(materials.map((material) => (
      quantityInKilograms(demandByMaterial.get(material.id) ?? 0, material.baseUnit).toString()
    )));
    const freeStock = currentStock.sub(reservedStock);
    const projectedStock = freeStock.sub(plannedDemand);
    const warningLevel = stockWarningLevel(freeStock, projectedStock, minimumStock);
    return {
      id: materials[0]?.id ?? null,
      code: definition.code,
      name: definition.name,
      currentStock: currentStock.toString(),
      reservedStock: reservedStock.toString(),
      freeStock: freeStock.toString(),
      minimumStock: minimumStock.toString(),
      plannedDemand: plannedDemand.toString(),
      projectedStock: projectedStock.toString(),
      shortfall: Decimal.max(0, projectedStock.negated()).toString(),
      baseUnit: Unit.KG,
      isCritical: warningLevel !== null,
      warningLevel,
      missing: false,
    };
  });

  return {
    period: { from: today.from.toISOString(), to: today.to.toISOString(), timezone },
    metrics: {
      consumedMaterials: groupQuantities(consumption.map((item) => ({ value: item.baseQuantity, unit: item.baseUnit }))),
      produced: groupQuantities(
        completedBatches.map((batch) => ({ value: batch.actualOutput ?? 0, unit: batch.actualOutputUnit })),
      ),
      sentToLrt: groupQuantities(dispatches.map((item) => ({ value: item.quantity, unit: item.unit }))),
      availableProduct: groupQuantities(
        availableLots.map((lot) => ({ value: lot.availableQuantity, unit: lot.unit })),
      ),
      activeBatches,
      lossPercent: outputTotal.isZero() ? "0" : lossTotal.div(outputTotal.add(lossTotal)).mul(100).toFixed(2),
      criticalStockCount: critical.length,
      deviationBatchCount: new Set(deviations.map((component) => component.batchId)).size,
      productionCost: sumDecimals(completedBatches.map((batch) => batch.totalCost.toString())).toFixed(2),
      operatingExpenses: expenses.map((expense) => ({
        amount: expense._sum.amount?.toString() ?? "0",
        currency: expense.currency,
      })),
      dailyRevenue: dailyRevenue.map((revenue) => ({
        amount: revenue._sum.totalAmount?.toString() ?? "0",
        currency: revenue.currency,
      })),
      accountsReceivable: groupMoneyByCurrency(receivableDocuments),
    },
    receivables: summarizeReceivables(receivableDocuments, today.to),
    criticalMaterials: critical,
    stockWarnings,
    mainReagents,
    deviations,
    productionTrend: await productionTrend(workspaceId, today.from, timezone),
    analytics: {
      batchStatuses: summarizeBatchStatuses(analyticsBatches),
      productionByLine: summarizeProductionByLine(analyticsBatches),
      expenseTrend: summarizeExpenseTrend(analyticsExpenses, today.from, timezone),
    },
  };
}

type StockWarningLevel = "OUT_OF_STOCK" | "SHORTAGE" | "CRITICAL" | "LOW_AFTER_PLAN";

function stockWarningLevel(
  freeStock: Decimal,
  projectedStock: Decimal,
  minimumStock: { toString(): string },
): StockWarningLevel | null {
  const minimum = new Decimal(minimumStock.toString());
  if (freeStock.lte(0)) return "OUT_OF_STOCK";
  if (projectedStock.lt(0)) return "SHORTAGE";
  if (minimum.gt(0) && freeStock.lte(minimum)) return "CRITICAL";
  if (minimum.gt(0) && projectedStock.lte(minimum)) return "LOW_AFTER_PLAN";
  return null;
}

function stockWarningRank(level: StockWarningLevel): number {
  return {
    OUT_OF_STOCK: 0,
    SHORTAGE: 1,
    CRITICAL: 2,
    LOW_AFTER_PLAN: 3,
  }[level];
}

export async function getProductionReport(workspaceId: string, period: Period) {
  const batches = await prisma.productionBatch.findMany({
    where: { workspaceId, scheduledAt: { gte: period.from, lte: period.to } },
    include: {
      recipeVersion: { include: { recipe: true } },
      productionLine: true,
      productionTank: true,
      operator: true,
      components: true,
      productLots: true,
    },
    orderBy: { scheduledAt: "asc" },
  });
  return batches.map((batch) => ({
    batchNumber: batch.number,
    scheduledAt: batch.scheduledAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? "",
    status: batch.status,
    recipe: batch.recipeVersion.recipe.name,
    recipeVersion: batch.recipeVersion.version,
    concreteGrade: batch.concreteGrade,
    productionLine: batch.productionLine.name,
    productionTank: batch.productionTank?.name ?? "",
    operator: batch.operator.name,
    plannedVolume: batch.plannedVolume.toString(),
    actualVolume: batch.actualVolume?.toString() ?? "",
    volumeUnit: batch.plannedVolumeUnit,
    plannedOutput: batch.plannedOutput.toString(),
    actualOutput: batch.actualOutput?.toString() ?? "",
    goodOutput: batch.goodOutput?.toString() ?? "",
    rejectedOutput: batch.rejectedOutput.toString(),
    technologicalLoss: batch.technologicalLoss.toString(),
    outputUnit: batch.outputAccountingUnit,
    totalCost: batch.totalCost.toString(),
    costPerUnit: batch.costPerOutputUnit.toString(),
    currency: batch.currency,
    deviations: batch.components.filter((component) => !component.withinTolerance).length,
  }));
}

export async function getExpenseReport(workspaceId: string, period: Period) {
  const expenses = await prisma.expense.findMany({
    where: { workspaceId, incurredAt: { gte: period.from, lte: period.to } },
    include: { createdBy: { select: { name: true } } },
    orderBy: [{ incurredAt: "asc" }, { number: "asc" }],
  });
  return expenses.map((expense) => ({
    expenseNumber: expense.number,
    incurredAt: expense.incurredAt.toISOString(),
    status: expense.status,
    category: expense.category,
    costCenter: expense.costCenter,
    paymentMethod: expense.paymentMethod,
    description: expense.description,
    counterparty: expense.counterparty ?? "",
    documentNumber: expense.documentNumber ?? "",
    amount: expense.amount.toString(),
    currency: expense.currency,
    createdBy: expense.createdBy.name,
    cancellationReason: expense.cancellationReason ?? "",
  }));
}

export async function getProductionSummary(
  workspaceId: string,
  period: Period,
  groupBy: ProductionGroupBy,
) {
  const rows = await getProductionReport(workspaceId, period);
  const groups = new Map<
    string,
    {
      batches: number;
      plannedOutput: Decimal;
      actualOutput: Decimal;
      goodOutput: Decimal;
      rejectedOutput: Decimal;
      technologicalLoss: Decimal;
      totalCost: Decimal;
      currency: string;
      outputUnit: string;
    }
  >();
  for (const row of rows) {
    const key = productionGroupKey(row, groupBy);
    const current = groups.get(key) ?? {
      batches: 0,
      plannedOutput: new Decimal(0),
      actualOutput: new Decimal(0),
      goodOutput: new Decimal(0),
      rejectedOutput: new Decimal(0),
      technologicalLoss: new Decimal(0),
      totalCost: new Decimal(0),
      currency: row.currency,
      outputUnit: row.outputUnit,
    };
    current.batches += 1;
    current.plannedOutput = current.plannedOutput.add(row.plannedOutput || 0);
    current.actualOutput = current.actualOutput.add(row.actualOutput || 0);
    current.goodOutput = current.goodOutput.add(row.goodOutput || 0);
    current.rejectedOutput = current.rejectedOutput.add(row.rejectedOutput || 0);
    current.technologicalLoss = current.technologicalLoss.add(row.technologicalLoss || 0);
    current.totalCost = current.totalCost.add(row.totalCost || 0);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([group, values]) => ({
    groupBy,
    group,
    batches: values.batches,
    plannedOutput: values.plannedOutput.toString(),
    actualOutput: values.actualOutput.toString(),
    goodOutput: values.goodOutput.toString(),
    rejectedOutput: values.rejectedOutput.toString(),
    technologicalLoss: values.technologicalLoss.toString(),
    totalCost: values.totalCost.toFixed(2),
    outputUnit: values.outputUnit,
    currency: values.currency,
  }));
}

export async function getMaterialConsumptionReport(workspaceId: string, period: Period) {
  const components = await prisma.batchComponent.findMany({
    where: { batch: { workspaceId, scheduledAt: { gte: period.from, lte: period.to } } },
    include: {
      material: true,
      batch: { select: { number: true, scheduledAt: true, status: true } },
    },
    orderBy: { batch: { scheduledAt: "asc" } },
  });
  return components.map((component) => ({
    batchNumber: component.batch.number,
    date: component.batch.scheduledAt.toISOString(),
    batchStatus: component.batch.status,
    materialCode: component.material.code,
    materialName: component.materialNameSnapshot,
    materialType: component.materialTypeSnapshot,
    planned: component.plannedQuantity.toString(),
    reserved: component.reservedQuantity.toString(),
    actual: component.actualQuantity.toString(),
    returned: component.returnedQuantity.toString(),
    loss: component.lossQuantity.toString(),
    unit: component.actualUnit,
    deviation: component.deviationQuantity.toString(),
    deviationPercent: component.deviationPercent.toString(),
    withinTolerance: component.withinTolerance,
    componentCost: component.componentCost.toString(),
    currency: component.currency,
  }));
}

export async function getRecipeEfficiencyReport(workspaceId: string, period: Period) {
  const batches = await prisma.productionBatch.findMany({
    where: {
      workspaceId,
      completedAt: { gte: period.from, lte: period.to },
      status: { in: [
        ProductionBatchStatus.COMPLETED,
        ProductionBatchStatus.PARTIALLY_TRANSFERRED,
        ProductionBatchStatus.FULLY_TRANSFERRED,
        ProductionBatchStatus.REJECTED,
      ] },
    },
    include: { recipeVersion: { include: { recipe: true } } },
    orderBy: { completedAt: "asc" },
  });
  const groups = new Map<string, {
    recipe: string;
    version: number;
    grade: string;
    batches: number;
    planned: Decimal;
    actual: Decimal;
    good: Decimal;
    rejected: Decimal;
    loss: Decimal;
    cost: Decimal;
    unit: string;
    currency: string;
  }>();
  for (const batch of batches) {
    const key = batch.recipeVersionId;
    const current = groups.get(key) ?? {
      recipe: batch.recipeVersion.recipe.name,
      version: batch.recipeVersion.version,
      grade: batch.concreteGrade,
      batches: 0,
      planned: new Decimal(0),
      actual: new Decimal(0),
      good: new Decimal(0),
      rejected: new Decimal(0),
      loss: new Decimal(0),
      cost: new Decimal(0),
      unit: batch.outputAccountingUnit,
      currency: batch.currency,
    };
    current.batches += 1;
    current.planned = current.planned.add(batch.plannedOutput.toString());
    current.actual = current.actual.add(batch.actualOutput?.toString() ?? 0);
    current.good = current.good.add(batch.goodOutput?.toString() ?? 0);
    current.rejected = current.rejected.add(batch.rejectedOutput.toString());
    current.loss = current.loss.add(batch.technologicalLoss.toString());
    current.cost = current.cost.add(batch.totalCost.toString());
    groups.set(key, current);
  }
  return [...groups.values()].map((row) => ({
    recipe: row.recipe,
    recipeVersion: row.version,
    concreteGrade: row.grade,
    batches: row.batches,
    plannedOutput: row.planned.toString(),
    actualOutput: row.actual.toString(),
    goodOutput: row.good.toString(),
    rejectedOutput: row.rejected.toString(),
    technologicalLoss: row.loss.toString(),
    yieldPercent: row.planned.isZero() ? "0" : row.actual.div(row.planned).mul(100).toFixed(2),
    goodYieldPercent: row.actual.isZero() ? "0" : row.good.div(row.actual).mul(100).toFixed(2),
    lossPercent: row.actual.add(row.loss).isZero() ? "0" : row.loss.div(row.actual.add(row.loss)).mul(100).toFixed(2),
    totalCost: row.cost.toFixed(2),
    costPerUnit: row.actual.isZero() ? "0" : row.cost.div(row.actual).toFixed(2),
    outputUnit: row.unit,
    currency: row.currency,
  }));
}

export async function getLrtTransferReport(workspaceId: string, period: Period) {
  const transfers = await prisma.lrtTransfer.findMany({
    where: { workspaceId, transferAt: { gte: period.from, lte: period.to } },
    include: {
      sender: true,
      customer: true,
      items: { include: { productLot: true, batch: true } },
    },
    orderBy: { transferAt: "asc" },
  });
  return transfers.flatMap((transfer) => transfer.items.map((item) => ({
    transferNumber: transfer.number,
    transferAt: transfer.transferAt.toISOString(),
    sentAt: transfer.sentAt?.toISOString() ?? "",
    acceptedAt: transfer.acceptedAt?.toISOString() ?? "",
    status: transfer.status,
    productLot: item.productLot.number,
    batchNumber: item.batch.number,
    concreteGrade: item.productLot.concreteGrade,
    requested: item.requestedQuantity.toString(),
    sent: item.sentQuantity.toString(),
    accepted: item.acceptedQuantity.toString(),
    rejected: item.rejectedQuantity.toString(),
    returned: item.returnedQuantity.toString(),
    unit: item.unit,
    sender: transfer.sender.name,
    receiver: transfer.customer?.name ?? "",
    transport: transfer.transport ?? "",
  })));
}

export async function getProductBalanceReport(workspaceId: string, period: Period) {
  const lots = await prisma.productLot.findMany({
    where: { workspaceId, producedAt: { lte: period.to } },
    include: {
      batch: { include: { productionLine: true, productionTank: true, operator: true } },
      movements: { where: { occurredAt: { lte: period.to } }, orderBy: { occurredAt: "asc" } },
    },
    orderBy: { producedAt: "asc" },
  });
  return lots.map((lot) => {
    const before = lot.movements.filter((movement) => movement.occurredAt < period.from);
    const within = lot.movements.filter(
      (movement) => movement.occurredAt >= period.from && movement.occurredAt <= period.to,
    );
    const opening = before.at(-1)?.balanceAfter.toString() ?? "0";
    const produced = sumMovement(within, ProductMovementType.PRODUCTION);
    const returned = sumMovement(within, ProductMovementType.LRT_RETURN);
    const sent = sumMovement(within, ProductMovementType.LRT_DISPATCH);
    const writtenOff = sumMovement(within, ProductMovementType.WRITEOFF);
    const rejected = sumMovement(within, ProductMovementType.REJECT);
    const other = sumMovement(within, ProductMovementType.OTHER_SHIPMENT);
    const adjustments = sumMovement(within, ProductMovementType.ADJUSTMENT);
    const closing = new Decimal(opening)
      .add(produced)
      .add(returned)
      .add(adjustments)
      .sub(sent)
      .sub(writtenOff)
      .sub(rejected)
      .sub(other);
    return {
      productLot: lot.number,
      batchNumber: lot.batch.number,
      concreteGrade: lot.concreteGrade,
      productionLine: lot.batch.productionLine.name,
      productionTank: lot.batch.productionTank?.name ?? "",
      operator: lot.batch.operator.name,
      unit: lot.unit,
      opening: new Decimal(opening).toString(),
      produced: produced.toString(),
      returned: returned.toString(),
      sentToLrt: sent.toString(),
      writtenOff: writtenOff.toString(),
      rejected: rejected.toString(),
      otherShipments: other.toString(),
      adjustments: adjustments.toString(),
      closing: closing.toString(),
    };
  });
}

export async function getProductBalanceSummary(
  workspaceId: string,
  period: Period,
  groupBy: BalanceGroupBy,
) {
  const rows = await getProductBalanceReport(workspaceId, period);
  const groups = new Map<string, {
    opening: Decimal;
    produced: Decimal;
    returned: Decimal;
    sent: Decimal;
    writtenOff: Decimal;
    rejected: Decimal;
    other: Decimal;
    adjustments: Decimal;
    closing: Decimal;
    unit: string;
  }>();
  for (const row of rows) {
    const key = balanceGroupKey(row, groupBy);
    const current = groups.get(key) ?? {
      opening: new Decimal(0), produced: new Decimal(0), returned: new Decimal(0), sent: new Decimal(0),
      writtenOff: new Decimal(0), rejected: new Decimal(0), other: new Decimal(0), adjustments: new Decimal(0),
      closing: new Decimal(0), unit: row.unit,
    };
    current.opening = current.opening.add(row.opening);
    current.produced = current.produced.add(row.produced);
    current.returned = current.returned.add(row.returned);
    current.sent = current.sent.add(row.sentToLrt);
    current.writtenOff = current.writtenOff.add(row.writtenOff);
    current.rejected = current.rejected.add(row.rejected);
    current.other = current.other.add(row.otherShipments);
    current.adjustments = current.adjustments.add(row.adjustments);
    current.closing = current.closing.add(row.closing);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([group, row]) => ({
    groupBy,
    group,
    unit: row.unit,
    opening: row.opening.toString(),
    produced: row.produced.toString(),
    returned: row.returned.toString(),
    sentToLrt: row.sent.toString(),
    writtenOff: row.writtenOff.toString(),
    rejected: row.rejected.toString(),
    otherShipments: row.other.toString(),
    adjustments: row.adjustments.toString(),
    closing: row.closing.toString(),
  }));
}

export async function getProductLotTrace(workspaceId: string, productLotId: string) {
  return prisma.productLot.findFirst({
    where: { id: productLotId, workspaceId },
    include: {
      batch: {
        include: {
          recipeVersion: { include: { recipe: true } },
          operator: true,
          productionLine: true,
          qualityChecks: { include: { performedBy: true } },
        },
      },
      materialTrace: {
        include: {
          allocation: {
            include: {
              materialLot: { include: { material: true, supplier: true } },
              batchComponent: true,
            },
          },
        },
      },
      movements: { include: { transferItem: { include: { transfer: true } } }, orderBy: { occurredAt: "asc" } },
    },
  });
}

function groupQuantities(
  values: Array<{ value: { toString(): string } | string | number; unit: string }>,
): Array<{ unit: string; value: string }> {
  const grouped = new Map<string, Decimal>();
  for (const item of values) {
    grouped.set(item.unit, (grouped.get(item.unit) ?? new Decimal(0)).add(item.value.toString()));
  }
  return [...grouped.entries()].map(([unit, value]) => ({ unit, value: value.toString() }));
}

function sumDecimals(values: string[]): Decimal {
  return values.reduce<Decimal>((sum, value) => sum.add(value), new Decimal(0));
}

function groupMoneyByCurrency(
  rows: Array<{ totalAmount: { toString(): string }; currency: string }>,
): Array<{ amount: string; currency: string }> {
  const totals = new Map<string, Decimal>();
  for (const row of rows) {
    totals.set(row.currency, (totals.get(row.currency) ?? new Decimal(0)).add(row.totalAmount.toString()));
  }
  return [...totals.entries()].map(([currency, amount]) => ({ currency, amount: amount.toString() }));
}

function summarizeReceivables(
  documents: Array<{
    counterparty: string;
    counterpartyTaxId: string | null;
    totalAmount: { toString(): string };
    currency: string;
    documentAt: Date;
    dueAt: Date | null;
    transferId: string | null;
  }>,
  now: Date,
) {
  const counterparties = new Map<string, {
    counterparty: string;
    counterpartyTaxId: string | null;
    currency: string;
    amount: Decimal;
    overdueAmount: Decimal;
    invoiceCount: number;
    linkedShipmentCount: number;
    lastDocumentAt: Date;
    nearestDueAt: Date | null;
  }>();
  for (const document of documents) {
    const identity = document.counterpartyTaxId?.trim() || document.counterparty.trim().toLocaleUpperCase("ru-RU");
    const key = `${identity}\u0000${document.currency}`;
    const current = counterparties.get(key) ?? {
      counterparty: document.counterparty,
      counterpartyTaxId: document.counterpartyTaxId,
      currency: document.currency,
      amount: new Decimal(0),
      overdueAmount: new Decimal(0),
      invoiceCount: 0,
      linkedShipmentCount: 0,
      lastDocumentAt: document.documentAt,
      nearestDueAt: document.dueAt,
    };
    current.amount = current.amount.add(document.totalAmount.toString());
    current.invoiceCount += 1;
    if (document.transferId !== null) current.linkedShipmentCount += 1;
    if (document.documentAt > current.lastDocumentAt) current.lastDocumentAt = document.documentAt;
    if (document.dueAt !== null && (current.nearestDueAt === null || document.dueAt < current.nearestDueAt)) {
      current.nearestDueAt = document.dueAt;
    }
    if (document.dueAt !== null && document.dueAt < now) {
      current.overdueAmount = current.overdueAmount.add(document.totalAmount.toString());
    }
    counterparties.set(key, current);
  }
  return [...counterparties.values()]
    .sort((left, right) => right.amount.comparedTo(left.amount))
    .map((item) => ({
      counterparty: item.counterparty,
      counterpartyTaxId: item.counterpartyTaxId,
      currency: item.currency,
      amount: item.amount.toString(),
      overdueAmount: item.overdueAmount.toString(),
      invoiceCount: item.invoiceCount,
      linkedShipmentCount: item.linkedShipmentCount,
      lastDocumentAt: item.lastDocumentAt.toISOString(),
      nearestDueAt: item.nearestDueAt?.toISOString() ?? null,
    }));
}

function sumMovement(
  movements: Array<{ type: ProductMovementType; quantity: { toString(): string } }>,
  type: ProductMovementType,
): Decimal {
  return sumDecimals(
    movements.filter((movement) => movement.type === type).map((movement) => movement.quantity.toString()),
  );
}

async function productionTrend(workspaceId: string, todayStart: Date, timezone: string) {
  const from = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const batches = await prisma.productionBatch.findMany({
    where: { workspaceId, completedAt: { gte: from } },
    select: { completedAt: true, actualOutput: true, sentToLrt: true, technologicalLoss: true },
  });
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const rows = new Map<string, { produced: Decimal; sent: Decimal; loss: Decimal }>();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(todayStart.getTime() - offset * 24 * 60 * 60 * 1000);
    rows.set(formatter.format(date), {
      produced: new Decimal(0),
      sent: new Decimal(0),
      loss: new Decimal(0),
    });
  }
  for (const batch of batches) {
    if (batch.completedAt === null) continue;
    const key = formatter.format(batch.completedAt);
    const row = rows.get(key);
    if (row === undefined) continue;
    row.produced = row.produced.add(batch.actualOutput?.toString() ?? 0);
    row.sent = row.sent.add(batch.sentToLrt.toString());
    row.loss = row.loss.add(batch.technologicalLoss.toString());
  }
  return [...rows.entries()].map(([date, values]) => ({
    date,
    produced: values.produced.toString(),
    sent: values.sent.toString(),
    loss: values.loss.toString(),
  }));
}

function summarizeBatchStatuses(rows: Array<{ status: ProductionBatchStatus }>) {
  const counts = new Map<ProductionBatchStatus, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

function summarizeProductionByLine(rows: Array<{
  productionLine: { name: string };
  actualOutput: { toString(): string } | null;
  actualOutputUnit: string;
  technologicalLoss: { toString(): string };
}>) {
  const lines = new Map<string, { produced: Decimal; loss: Decimal; unit: string }>();
  for (const row of rows) {
    const current = lines.get(row.productionLine.name) ?? {
      produced: new Decimal(0),
      loss: new Decimal(0),
      unit: row.actualOutputUnit,
    };
    current.produced = current.produced.add(row.actualOutput?.toString() ?? 0);
    current.loss = current.loss.add(row.technologicalLoss.toString());
    lines.set(row.productionLine.name, current);
  }
  return [...lines.entries()].map(([line, values]) => ({
    line,
    produced: values.produced.toString(),
    loss: values.loss.toString(),
    unit: values.unit,
  }));
}

function summarizeExpenseTrend(
  rows: Array<{ incurredAt: Date; amount: { toString(): string }; currency: string }>,
  todayStart: Date,
  timezone: string,
) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const days = new Map<string, Map<string, Decimal>>();
  for (let offset = 6; offset >= 0; offset -= 1) {
    days.set(formatter.format(new Date(todayStart.getTime() - offset * 24 * 60 * 60 * 1000)), new Map());
  }
  for (const row of rows) {
    const key = formatter.format(row.incurredAt);
    const currencies = days.get(key);
    if (currencies === undefined) continue;
    currencies.set(row.currency, (currencies.get(row.currency) ?? new Decimal(0)).add(row.amount.toString()));
  }
  return [...days.entries()].flatMap(([date, currencies]) => {
    if (currencies.size === 0) return [{ date, amount: "0", currency: "KZT" }];
    return [...currencies.entries()].map(([currency, amount]) => ({ date, amount: amount.toString(), currency }));
  });
}

function productionGroupKey(
  row: Awaited<ReturnType<typeof getProductionReport>>[number],
  groupBy: ProductionGroupBy,
): string {
  if (groupBy === "grade") return row.concreteGrade;
  if (groupBy === "line") return row.productionLine;
  if (groupBy === "operator") return row.operator;
  const date = new Date(row.scheduledAt);
  if (groupBy === "month") return row.scheduledAt.slice(0, 7);
  if (groupBy === "week") return isoWeek(date);
  const day = row.scheduledAt.slice(0, 10);
  if (groupBy === "shift") {
    const hour = date.getUTCHours();
    return `${day} · ${hour >= 8 && hour < 20 ? "08:00–20:00" : "20:00–08:00"}`;
  }
  return day;
}

function balanceGroupKey(
  row: Awaited<ReturnType<typeof getProductBalanceReport>>[number],
  groupBy: BalanceGroupBy,
): string {
  if (groupBy === "productLot") return row.productLot;
  if (groupBy === "batch") return row.batchNumber;
  if (groupBy === "grade") return row.concreteGrade;
  if (groupBy === "line") return row.productionLine;
  return row.operator;
}

function isoWeek(date: Date): string {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function currentDayRange(timezone: string): Period {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const utcGuess = Date.UTC(parts.year ?? 1970, (parts.month ?? 1) - 1, parts.day ?? 1);
  const offsetProbe = new Date(utcGuess);
  const probeParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(offsetProbe)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const represented = Date.UTC(
    probeParts.year ?? 1970,
    (probeParts.month ?? 1) - 1,
    probeParts.day ?? 1,
    probeParts.hour ?? 0,
    probeParts.minute ?? 0,
  );
  const offset = represented - utcGuess;
  const from = new Date(utcGuess - offset);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}
