import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  AccountingDocumentStatus, AccountingDocumentType, MaterialMovementType,
  OneCSyncEntityType, Prisma, type Unit,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import type { FullSnapshotEnvelope } from "./one-c-full-snapshot-service.js";
import { projectOneCDirectories } from "./one-c-directory-service.js";
import { mapOneCMaterialUnit } from "./one-c-material-unit.js";

type Snapshot = FullSnapshotEnvelope["snapshot"];
type Transaction = Prisma.TransactionClient;

function number(value: string, field: string): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new ApiError(422, "ONE_C_NUMBER_INVALID", `Некорректное число 1С: ${field}`);
  return parsed;
}

function localDate(value: string): Date {
  // The approved BKZ mapping for this workspace uses Kazakhstan's fixed +05:00 offset.
  const parsed = new Date(`${value}+05:00`);
  if (Number.isNaN(parsed.getTime())) throw new ApiError(422, "ONE_C_DATE_INVALID", "Некорректная дата документа 1С");
  return parsed;
}

function sourceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function projectFullSnapshot(tx: Transaction, input: FullSnapshotEnvelope, snapshotSha256: string) {
  const { snapshot, workspaceId, sourceInstanceId, organizationExternalId } = input;
  if (snapshot.organizations.length !== 1 || snapshot.organizations[0]?.externalId !== organizationExternalId) {
    throw new ApiError(422, "ONE_C_ORGANIZATION_AMBIGUOUS", "Автообновление доступно только для одной сверенной организации 1С");
  }
  for (const rows of [snapshot.receipts, snapshot.balances, snapshot.accountingInventory,
    snapshot.receivables, snapshot.sales, snapshot.invoices, snapshot.incomingPayments, snapshot.outgoingPayments]) {
    if (rows.some((row) => row.organizationId !== organizationExternalId)) {
      throw new ApiError(422, "ONE_C_ORGANIZATION_MISMATCH", "Снимок содержит данные другой организации 1С");
    }
  }

  const directoryChanges = await projectOneCDirectories(tx, input);
  const materialRefs = await tx.oneCExternalReference.findMany({
    where: { workspaceId, source: "1C", entityType: OneCSyncEntityType.MATERIAL,
      externalId: { startsWith: `${sourceInstanceId}:` } },
    select: { externalId: true, internalId: true },
  });
  const materialByExternalId = new Map(materialRefs.map((ref) => [ref.externalId.slice(sourceInstanceId.length + 1), ref.internalId]));
  const sourceMaterials = new Map(snapshot.materials.map((row) => [row.externalId, row]));
  const requested = new Map<string, Map<string, { quantity: Decimal; sourceQuantity: Decimal;
    sourceUnitName: string; quantityFactor: string; amount: Decimal; accountCode: string }>>();
  for (const balance of snapshot.accountingInventory) {
    const materialId = materialByExternalId.get(balance.materialId);
    if (!materialId) throw new ApiError(422, "ONE_C_MATERIAL_UNMAPPED", `Не согласована номенклатура остатка ${balance.materialId}`);
    const sourceMaterial = sourceMaterials.get(balance.materialId);
    const group = sourceMaterial?.groupName;
    const unit = sourceMaterial ? mapOneCMaterialUnit(sourceMaterial) : null;
    if (!unit) throw new ApiError(422, "ONE_C_MATERIAL_UNIT_UNMAPPED", "Единица бухгалтерского остатка 1С не согласована");
    const expectedAccount = group === "Материалы" ? "1310" : group === "Готовая продукция" ? "1320" : group === "Товары" ? "1330" : null;
    // Root-level items have no directory classification. Keep the actual source
    // account (schema permits only 1310/1320/1330), never infer one from OTHER.
    if (group !== null && balance.accountCode !== expectedAccount) throw new ApiError(422, "ONE_C_ACCOUNT_MISMATCH", "Счёт остатка 1С не соответствует группе номенклатуры");
    const sourceQuantity = number(balance.quantityDebit, "quantityDebit")
      .sub(number(balance.quantityCredit, "quantityCredit"));
    const quantity = sourceQuantity.mul(unit.quantityFactor);
    const amount = number(balance.amountDebit, "amountDebit").sub(number(balance.amountCredit, "amountCredit"));
    if (quantity.isNegative() || amount.isNegative() || quantity.isZero() !== amount.isZero()) {
      throw new ApiError(422, "ONE_C_BALANCE_INVALID", "Количество и сумма бухгалтерского остатка 1С не согласованы");
    }
    const byWarehouse = requested.get(materialId) ?? new Map();
    if (byWarehouse.has(balance.warehouseId)) throw new ApiError(422, "ONE_C_BALANCE_DUPLICATE", "Повторный бухгалтерский остаток материала и склада");
    byWarehouse.set(balance.warehouseId, { quantity, sourceQuantity, sourceUnitName: sourceMaterial!.unitName,
      quantityFactor: unit.quantityFactor, amount, accountCode: balance.accountCode });
    requested.set(materialId, byWarehouse);
  }

  const customerRefs = await tx.oneCExternalReference.findMany({
    where: { workspaceId, source: "1C", entityType: OneCSyncEntityType.CUSTOMER,
      externalId: { startsWith: `${sourceInstanceId}:` } },
    select: { externalId: true, internalId: true },
  });
  const customerByExternalId = new Map(customerRefs.map((ref) => [ref.externalId.slice(sourceInstanceId.length + 1), ref.internalId]));
  const counterparties = new Map(snapshot.counterparties.map((row) => [row.externalId, row]));
  for (const row of [...snapshot.sales, ...snapshot.invoices]) {
    if (!customerByExternalId.has(row.counterpartyId) || !counterparties.has(row.counterpartyId)) {
      throw new ApiError(422, "ONE_C_CUSTOMER_UNMAPPED", `Не согласован клиент документа ${row.externalId}`);
    }
  }

  let inventoryChanges = 0;
  for (const ref of materialRefs) {
    const material = await tx.material.findFirst({ where: { id: ref.internalId, workspaceId }, select: {
      id: true, name: true, currentStock: true, reservedStock: true, baseUnit: true, costPerBaseUnit: true,
      lots: { select: { id: true, lotNumber: true, availableQuantity: true, reservedQuantity: true } },
    } });
    if (!material) throw new ApiError(422, "ONE_C_MATERIAL_MISSING", "Согласованный материал отсутствует в CRM");
    const nonSourceStock = material.lots.filter((lot) => !lot.lotNumber.startsWith("1C-OPEN-") && lot.availableQuantity.gt(0));
    if (nonSourceStock.length || material.reservedStock.gt(0) || material.lots.some((lot) => lot.reservedQuantity.gt(0))) {
      throw new ApiError(409, "ONE_C_STOCK_CONFLICT", `Обмен остановлен: у «${material.name}» есть локальные партии или резервы`, {
        materialId: material.id, reservedStock: material.reservedStock.toString(),
        localLots: nonSourceStock.map((lot) => ({ id: lot.id, number: lot.lotNumber, quantity: lot.availableQuantity.toString() })),
        reservedLots: material.lots.filter((lot) => lot.reservedQuantity.gt(0)).map((lot) => ({ id: lot.id, number: lot.lotNumber, quantity: lot.reservedQuantity.toString() })),
      });
    }
    let stock = new Decimal(material.currentStock.toString());
    const lotStock = material.lots.reduce((total, lot) => total.add(lot.availableQuantity.toString()), new Decimal(0));
    if (!stock.eq(lotStock)) throw new ApiError(409, "ONE_C_STOCK_INCONSISTENT", "Остаток материала и суммы партий CRM расходятся");
    const byWarehouse = requested.get(material.id) ?? new Map();
    const sourceRow = sourceMaterials.get(ref.externalId.slice(sourceInstanceId.length + 1));
    if (sourceRow && mapOneCMaterialUnit(sourceRow)?.quantityFactor === "1000") {
      const incomingStock = [...byWarehouse.values()].reduce((sum, balance) => sum.add(balance.quantity), new Decimal(0));
      const incomingValue = [...byWarehouse.values()].reduce((sum, balance) => sum.add(balance.amount), new Decimal(0));
      const currentCost = new Decimal(material.costPerBaseUnit.toString());
      const incomingCost = incomingStock.gt(0) ? incomingValue.div(incomingStock) : new Decimal(0);
      const stockRatio = stock.gt(0) ? incomingStock.div(stock) : null;
      const costRatio = currentCost.gt(0) && incomingStock.gt(0) ? incomingCost.div(currentCost) : null;
      if (incomingStock.gt(0) && (!costRatio || costRatio.lt("0.1") || costRatio.gt("10") ||
          (stockRatio !== null && (stockRatio.lt("0.01") || stockRatio.gt("100"))))) {
        throw new ApiError(409, "ONE_C_UNIT_SCALE_REVIEW_REQUIRED",
          `Остаток или учётная цена «${material.name}» после перевода тонн в килограммы требуют сверки.`,
          { materialId: material.id, sourceUnitName: sourceRow.unitName,
            currentStockKg: stock.toString(), proposedStockKg: incomingStock.toString(),
            currentCostKztPerKg: currentCost.toString(), proposedCostKztPerKg: incomingCost.toString() });
      }
    }
    const warehouses = new Set([...byWarehouse.keys(), ...material.lots
      .filter((lot) => lot.lotNumber.startsWith("1C-OPEN-"))
      .map((lot) => lot.lotNumber.slice("1C-OPEN-".length))]);
    for (const warehouseId of warehouses) {
      const balance = byWarehouse.get(warehouseId);
      const quantity = balance?.quantity ?? new Decimal(0);
      const amount = balance?.amount ?? new Decimal(0);
      const cost = quantity.isZero() ? "0" : amount.div(quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
      const lotNumber = `1C-OPEN-${warehouseId}`;
      const old = material.lots.find((lot) => lot.lotNumber === lotNumber);
      if (!old && quantity.isZero()) continue;
      const oldQuantity = old ? new Decimal(old.availableQuantity.toString()) : new Decimal(0);
      const metadata = { source: "1C_OPENING_BALANCE", snapshotSha256, sourceWarehouseId: warehouseId,
        accountCode: balance?.accountCode ?? null, bookValue: amount.toString(), valuation: "1C_ACCOUNTING_BALANCE",
        sourceUnitName: balance?.sourceUnitName ?? sourceRow?.unitName ?? null,
        sourceQuantity: balance?.sourceQuantity.toString() ?? "0",
        quantityFactor: balance?.quantityFactor ?? (sourceRow ? mapOneCMaterialUnit(sourceRow)?.quantityFactor : null) ?? null };
      const lot = old
        ? await tx.materialLot.update({ where: { id: old.id }, data: { availableQuantity: quantity.toString(), unitCost: cost,
          qualitySnapshot: metadata } })
        : await tx.materialLot.create({ data: { workspaceId, materialId: material.id, lotNumber,
          receivedAt: new Date(snapshot.generatedAt), initialQuantity: quantity.toString(),
          availableQuantity: quantity.toString(), reservedQuantity: "0", unit: material.baseUnit,
          unitCost: cost, currency: "KZT", qualitySnapshot: metadata } });
      const difference = quantity.sub(oldQuantity);
      if (!difference.isZero()) {
        const after = stock.add(difference);
        await tx.materialMovement.create({ data: { workspaceId, materialLotId: lot.id,
          type: MaterialMovementType.ADJUSTMENT, quantity: difference.abs().toString(), unit: material.baseUnit,
          baseQuantity: difference.abs().toString(), baseUnit: material.baseUnit,
          stockBefore: stock.toString(), stockAfter: after.toString(), reservedBefore: "0", reservedAfter: "0",
          reason: "Сверка бухгалтерского остатка 1С", occurredAt: new Date(snapshot.generatedAt),
          metadata: { source: "1C", snapshotSha256, warehouseId, signedDifference: difference.toString(),
            bookValue: amount.toString(), sourceUnitName: metadata.sourceUnitName,
            sourceQuantity: metadata.sourceQuantity, quantityFactor: metadata.quantityFactor } } });
        stock = after;
        inventoryChanges += 1;
      }
    }
    const bookValue = [...byWarehouse.values()].reduce((sum, balance) => sum.add(balance.amount), new Decimal(0));
    const currentCost = stock.gt(0) ? bookValue.div(stock).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString() : null;
    if (currentCost !== null && !material.costPerBaseUnit.eq(currentCost)) {
      await tx.materialPriceHistory.create({ data: { workspaceId, materialId: material.id,
        pricePerBaseUnit: currentCost, currency: "KZT", effectiveAt: new Date(snapshot.generatedAt),
        source: "ONE_C_ACCOUNTING_BALANCE",
        note: "Средняя учётная цена по бухгалтерскому остатку" } });
    }
    await tx.material.update({ where: { id: material.id }, data: { currentStock: stock.toString(),
      ...(currentCost !== null ? { costPerBaseUnit: currentCost } : {}) } });
  }

  const importedBy = await tx.user.findFirst({ where: { workspaceId, email: `1c-import-${workspaceId}@miracle-chem.local` }, select: { id: true } });
  if (!importedBy) throw new ApiError(409, "ONE_C_STAGING_USER_MISSING", "Технический пользователь проверочного контура 1С отсутствует");
  let documentChanges = 0;
  const presentDocuments = new Set<string>();
  for (const kind of ["SALE", "INVOICE"] as const) {
    const rows = kind === "SALE" ? snapshot.sales : snapshot.invoices;
    const lines = kind === "SALE" ? snapshot.saleLines : snapshot.invoiceLines;
    for (const row of rows) {
      const sourceKey = `${kind}:${row.externalId}`;
      presentDocuments.add(sourceKey);
      const itemRows = lines.filter((line) => line.documentId === row.externalId);
      const customer = counterparties.get(row.counterpartyId)!;
      const rowHash = sourceHash({ row, itemRows, customer: { name: customer.name, taxId: customer.taxId },
        productNames: itemRows.map((line) => sourceMaterials.get(line.materialId)?.name) });
      // Buyer invoices do not require posting in 1C; a non-deleted invoice is issued.
      const status = row.deleted ? AccountingDocumentStatus.CANCELLED
        : kind === "INVOICE" || row.posted ? AccountingDocumentStatus.ISSUED : AccountingDocumentStatus.DRAFT;
      const existing = await tx.accountingDocument.findFirst({ where: { workspaceId,
        details: { path: ["externalId"], equals: row.externalId } },
        select: { id: true, details: true, status: true } });
      const previousDetails = existing?.details && typeof existing.details === "object" && !Array.isArray(existing.details)
        ? existing.details as Record<string, unknown> : null;
      if (previousDetails?.oneCPayloadHash === rowHash && existing?.status === status) continue;
      const vat = itemRows.reduce((sum, line) => sum.add(number(line.vatAmount, "line.vatAmount")), new Decimal(0));
      const total = number(row.amount, "document.amount");
      if (vat.gt(total)) throw new ApiError(422, "ONE_C_DOCUMENT_TOTAL_INVALID", "НДС документа превышает сумму");
      const documentAt = localDate(row.documentAt);
      const items = itemRows.map((line) => {
        const product = sourceMaterials.get(line.materialId);
        if (!product) throw new ApiError(422, "ONE_C_DOCUMENT_MATERIAL_MISSING", "Номенклатура строки документа отсутствует в снимке");
        const quantity = number(line.quantity, "line.quantity");
        const amount = number(line.amount, "line.amount").sub(number(line.vatAmount, "line.vatAmount"));
        if (quantity.lte(0) || amount.isNegative()) throw new ApiError(422, "ONE_C_DOCUMENT_LINE_INVALID", "Неверное количество или сумма строки 1С");
        return { description: product.name, quantity: quantity.toString(), unit: line.unitName,
          unitPrice: amount.div(quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
          amount: amount.toString(), position: line.lineNumber };
      });
      const data = { number: `1C-${kind}-${row.number}`,
        type: kind === "SALE" ? AccountingDocumentType.WAYBILL : AccountingDocumentType.PAYMENT_INVOICE,
        status, documentAt, issuedAt: status === AccountingDocumentStatus.ISSUED ? documentAt : null,
        counterparty: customer.name, counterpartyTaxId: customer.taxId || null,
        customerId: customerByExternalId.get(row.counterpartyId)!, subtotal: total.sub(vat).toString(),
        vatAmount: vat.toString(), totalAmount: total.toString(), currency: "KZT",
        details: { source: "1C", externalId: row.externalId, kind, posted: row.posted,
          oneCPayloadHash: rowHash, snapshotSha256 } };
      if (existing) {
        await tx.accountingDocument.update({ where: { id: existing.id }, data });
        await tx.accountingDocumentItem.deleteMany({ where: { documentId: existing.id } });
        if (items.length) await tx.accountingDocumentItem.createMany({ data: items.map((item) => ({ ...item, documentId: existing.id })) });
      } else {
        await tx.accountingDocument.create({ data: { ...data, workspaceId, createdById: importedBy.id,
          items: { create: items } } });
      }
      documentChanges += 1;
    }
  }
  const sourceDocs = await tx.accountingDocument.findMany({ where: { workspaceId,
    details: { path: ["source"], equals: "1C" } }, select: { id: true, details: true, status: true } });
  for (const document of sourceDocs) {
    const details = document.details as Record<string, unknown> | null;
    const key = `${details?.kind ?? (details?.source === "1C" && details.externalId ? "" : "")}:${details?.externalId ?? ""}`;
    // Legacy bootstrap rows have no kind; infer it from their document type below.
    if (presentDocuments.has(key)) continue;
    const actual = await tx.accountingDocument.findUniqueOrThrow({ where: { id: document.id }, select: { type: true } });
    const inferred = `${actual.type === AccountingDocumentType.WAYBILL ? "SALE" : "INVOICE"}:${details?.externalId ?? ""}`;
    if (!presentDocuments.has(inferred) && document.status !== AccountingDocumentStatus.CANCELLED) {
      await tx.accountingDocument.update({ where: { id: document.id }, data: {
        status: AccountingDocumentStatus.CANCELLED, cancellationReason: "Документ отсутствует в полном снимке 1С",
        cancelledAt: new Date(snapshot.generatedAt) } });
      documentChanges += 1;
    }
  }
  return { directoryChanges, inventoryChanges, documentChanges, financialReadModel: true };
}
