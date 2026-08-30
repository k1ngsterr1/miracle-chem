import { Decimal } from "decimal.js";
import {
  AccountingDocumentStatus,
  AccountingDocumentType,
  LrtTransferStatus,
  MaterialMovementType,
  type Unit,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";

const REVENUE_STATUSES = [AccountingDocumentStatus.ISSUED, AccountingDocumentStatus.PAID];
const SHIPPED_STATUSES = [
  LrtTransferStatus.SENT,
  LrtTransferStatus.ACCEPTED,
  LrtTransferStatus.PARTIALLY_ACCEPTED,
  LrtTransferStatus.REJECTED,
];

export async function getBatchEconomics(workspaceId: string, batchId: string) {
  const batch = await prisma.productionBatch.findFirst({
    where: { id: batchId, workspaceId },
    select: {
      id: true,
      currency: true,
      totalCost: true,
      actualOutput: true,
      goodOutput: true,
      outputAccountingUnit: true,
      components: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          materialId: true,
          materialNameSnapshot: true,
          plannedQuantity: true,
          plannedUnit: true,
          actualQuantity: true,
          actualUnit: true,
          lossQuantity: true,
          lossUnit: true,
          componentCost: true,
          currency: true,
          allocations: {
            where: { consumedQuantity: { gt: 0 } },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              consumedQuantity: true,
              unit: true,
              unitCostSnapshot: true,
              materialLot: {
                select: {
                  id: true,
                  lotNumber: true,
                  supplier: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
      materialMovements: {
        where: { type: MaterialMovementType.CONSUMPTION },
        select: { id: true },
        take: 1,
      },
      lrtTransferItems: {
        where: {
          sentQuantity: { gt: 0 },
          transfer: { workspaceId, status: { in: SHIPPED_STATUSES } },
        },
        select: {
          id: true,
          sentQuantity: true,
          returnedQuantity: true,
          unit: true,
          transfer: {
            select: {
              id: true,
              number: true,
              status: true,
              items: {
                select: {
                  id: true,
                  batchId: true,
                  sentQuantity: true,
                  returnedQuantity: true,
                  unit: true,
                },
              },
              accountingDocuments: {
                where: {
                  type: AccountingDocumentType.PAYMENT_INVOICE,
                  status: { in: REVENUE_STATUSES },
                },
                select: {
                  id: true,
                  number: true,
                  status: true,
                  currency: true,
                  subtotal: true,
                  items: { select: { quantity: true, unit: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (batch === null) return null;

  const components = batch.components.map((component) => {
    const lots = component.allocations.map((allocation) => {
      const quantity = new Decimal(allocation.consumedQuantity.toString());
      const unitCost = new Decimal(allocation.unitCostSnapshot.toString());
      return {
        allocationId: allocation.id,
        materialLotId: allocation.materialLot.id,
        lotNumber: allocation.materialLot.lotNumber,
        supplier: allocation.materialLot.supplier,
        quantity: quantity.toString(),
        unit: allocation.unit,
        unitCost: unitCost.toString(),
        cost: quantity.mul(unitCost).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
      };
    });
    const lotCost = lots.reduce((sum, lot) => sum.add(lot.cost), new Decimal(0));
    const recordedCost = new Decimal(component.componentCost.toString());
    const actualCost = lots.length > 0 ? lotCost : recordedCost;
    const actualQuantity = new Decimal(component.actualQuantity.toString());
    return {
      batchComponentId: component.id,
      materialId: component.materialId,
      materialName: component.materialNameSnapshot,
      plannedQuantity: component.plannedQuantity.toString(),
      plannedUnit: component.plannedUnit,
      actualQuantity: actualQuantity.toString(),
      actualUnit: component.actualUnit,
      lossQuantity: component.lossQuantity.toString(),
      lossUnit: component.lossUnit,
      averageUnitCost: actualQuantity.isZero()
        ? "0"
        : actualCost.div(actualQuantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
      actualCost: actualCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
      currency: component.currency,
      costSource: lots.length > 0 ? "WAREHOUSE_LOTS" as const : "RECORDED_COMPONENT" as const,
      lots,
    };
  });
  const componentCost = components.reduce((sum, component) => sum.add(component.actualCost), new Decimal(0));
  const actualQuantities = [...components.reduce((totals, component) => {
    const current = totals.get(component.actualUnit) ?? new Decimal(0);
    totals.set(component.actualUnit, current.add(component.actualQuantity));
    return totals;
  }, new Map<Unit, Decimal>()).entries()].map(([unit, value]) => ({
    value: value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString(),
    unit,
  }));
  const recordedBatchCost = new Decimal(batch.totalCost.toString());
  const actualMaterialCost = components.length > 0 ? componentCost : recordedBatchCost;
  const saleableOutput = new Decimal(batch.goodOutput?.toString() ?? batch.actualOutput?.toString() ?? "0");
  const actualUnitCost = saleableOutput.isZero() ? new Decimal(0) : actualMaterialCost.div(saleableOutput);

  let shippedQuantity = new Decimal(0);
  let invoicedQuantity = new Decimal(0);
  let invoicedRevenue = new Decimal(0);
  let paidRevenue = new Decimal(0);
  let currencyMismatch = false;
  const revenueDocuments: Array<{
    id: string;
    number: string;
    status: AccountingDocumentStatus;
    transferId: string;
    transferNumber: string;
    allocatedAmount: string;
    currency: string;
  }> = [];

  for (const transferItem of batch.lrtTransferItems) {
    const batchNetQuantity = netShipped(transferItem.sentQuantity, transferItem.returnedQuantity);
    shippedQuantity = shippedQuantity.add(batchNetQuantity);
    const transferNetQuantity = transferItem.transfer.items.reduce(
      (sum, item) => sum.add(netShipped(item.sentQuantity, item.returnedQuantity)),
      new Decimal(0),
    );
    if (batchNetQuantity.isZero() || transferNetQuantity.isZero()) continue;
    const batchShare = batchNetQuantity.div(transferNetQuantity);
    let transferInvoicedQuantity = new Decimal(0);
    let hasQuantityFromDocuments = false;

    for (const document of transferItem.transfer.accountingDocuments) {
      if (document.currency !== batch.currency) {
        currencyMismatch = true;
        continue;
      }
      const allocatedAmount = new Decimal(document.subtotal.toString()).mul(batchShare);
      invoicedRevenue = invoicedRevenue.add(allocatedAmount);
      if (document.status === AccountingDocumentStatus.PAID) paidRevenue = paidRevenue.add(allocatedAmount);
      revenueDocuments.push({
        id: document.id,
        number: document.number,
        status: document.status,
        transferId: transferItem.transfer.id,
        transferNumber: transferItem.transfer.number,
        allocatedAmount: allocatedAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
        currency: document.currency,
      });
      const documentedQuantity = document.items.reduce((sum, item) => {
        return unitsMatch(item.unit, transferItem.unit) ? sum.add(item.quantity.toString()) : sum;
      }, new Decimal(0));
      if (documentedQuantity.gt(0)) {
        transferInvoicedQuantity = transferInvoicedQuantity.add(documentedQuantity);
        hasQuantityFromDocuments = true;
      }
    }

    if (transferItem.transfer.accountingDocuments.some((document) => document.currency === batch.currency)) {
      const recognizedTransferQuantity = hasQuantityFromDocuments
        ? Decimal.min(transferNetQuantity, transferInvoicedQuantity)
        : transferNetQuantity;
      invoicedQuantity = invoicedQuantity.add(recognizedTransferQuantity.mul(batchShare));
    }
  }

  invoicedQuantity = Decimal.min(shippedQuantity, invoicedQuantity);
  const soldCost = actualUnitCost.mul(invoicedQuantity);
  const grossProfit = invoicedRevenue.sub(soldCost);
  const marginPercent = invoicedRevenue.isZero()
    ? null
    : grossProfit.div(invoicedRevenue).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
  const consumptionConfirmed = batch.materialMovements.length > 0
    || (saleableOutput.gt(0) && actualMaterialCost.gt(0));
  const calculationStatus = !consumptionConfirmed
    ? "NO_CONSUMPTION"
    : saleableOutput.isZero()
      ? "NOT_COMPLETED"
      : shippedQuantity.isZero()
        ? "NO_SHIPMENT"
        : invoicedRevenue.isZero()
          ? currencyMismatch ? "CURRENCY_MISMATCH" : "NO_INVOICE"
          : "CALCULATED";

  return {
    calculationStatus,
    consumptionConfirmed,
    currency: batch.currency,
    actualQuantities,
    actualMaterialCost: actualMaterialCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
    actualUnitCost: actualUnitCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
    outputUnit: batch.outputAccountingUnit,
    shippedQuantity: shippedQuantity.toString(),
    invoicedQuantity: invoicedQuantity.toString(),
    invoicedRevenue: invoicedRevenue.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
    paidRevenue: paidRevenue.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
    soldCost: soldCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
    grossProfit: calculationStatus === "CALCULATED"
      ? grossProfit.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()
      : null,
    marginPercent: calculationStatus === "CALCULATED" ? marginPercent : null,
    currencyMismatch,
    costSource: components.some((component) => component.costSource === "WAREHOUSE_LOTS")
      ? "WAREHOUSE_LOTS" as const
      : "RECORDED_BATCH" as const,
    components,
    revenueDocuments,
  };
}

function netShipped(sent: Decimal.Value, returned: Decimal.Value): Decimal {
  return Decimal.max(0, new Decimal(sent).sub(returned));
}

function unitsMatch(documentUnit: string, transferUnit: Unit): boolean {
  const normalized = documentUnit.trim().toLocaleUpperCase("ru-RU").replaceAll("³", "3");
  const aliases: Record<Unit, string[]> = {
    G: ["G", "Г"],
    KG: ["KG", "КГ"],
    T: ["T", "Т", "ТОННА", "ТОНН"],
    ML: ["ML", "МЛ"],
    L: ["L", "Л"],
    M3: ["M3", "М3", "КУБ", "КУБ.М"],
    PCS: ["PCS", "ШТ", "ШТУКИ"],
  };
  return aliases[transferUnit].includes(normalized);
}
