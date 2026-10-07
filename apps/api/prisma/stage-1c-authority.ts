import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Decimal } from "decimal.js";
import {
  AccountingDocumentStatus, AccountingDocumentType, AuditEntityType,
  MaterialMovementType, OneCSyncEntityType, Prisma, Unit, UserRole,
} from "../src/generated/prisma/index.js";
import { prisma } from "../src/lib/prisma.js";
import { parseBkzMapping, parseBkzSnapshot, initializeBkzState, prepareBkzPlan } from "../../one-c-sync-agent/src/bkz-adapter.js";
import { proposeBkzAuthorityMapping } from "../../one-c-sync-agent/src/bkz-authority.js";

type Row = Record<string, unknown>;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const path = (name: string): string => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error(`Укажите ${name}`);
  return resolve(args[index + 1]!);
};
const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Нет значения ${label}`);
  return value.trim();
};
const decimal = (value: unknown, label: string, places: number): Decimal => {
  const result = new Decimal(text(value, label));
  if (!result.isFinite() || result.isNegative() || result.decimalPlaces() > places) throw new Error(`Некорректное число ${label}`);
  return result;
};
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function main(): Promise<void> {
  const raw = await readFile(path("--snapshot"));
  const source = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  const snapshot = parseBkzSnapshot(source);
  if (snapshot.materials.some((material) => typeof material.unitName === "string" &&
      material.unitName.trim().toLocaleLowerCase("ru") === "т")) {
    throw new Error("Bootstrap 1С с номенклатурой в тоннах не поддерживается: бухгалтерский остаток не содержит единицу. Используйте согласованный контур полного обмена.");
  }
  const mapping = parseBkzMapping(JSON.parse(await readFile(path("--mapping"), "utf8")) as unknown);
  if (source.consistency !== "SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE" ||
      !Array.isArray(source.balances) || !Array.isArray(source.accountingInventory) ||
      !Array.isArray(source.receivables) || !Array.isArray(source.sales) ||
      !Array.isArray(source.invoices) || !Array.isArray(source.incomingPayments) ||
      !Array.isArray(source.outgoingPayments)) throw new Error("Нужна полная проверенная выгрузка 1С с финансами и остатками");
  const proposal = proposeBkzAuthorityMapping(snapshot, {
    workspaceId: mapping.workspaceId, organizationId: mapping.organizationId,
    sourceInstanceId: mapping.sourceInstanceId, approvedBy: mapping.approvedBy,
    approvedAt: mapping.approvedAt, sourceUtcOffset: mapping.sourceUtcOffset,
  });
  if (hash(proposal.mapping) !== hash(mapping)) throw new Error("Состав 1С изменился после согласования mapping; сформируйте новую схему");
  const historic = prepareBkzPlan(snapshot, mapping, initializeBkzState({ ...snapshot, receipts: [] }, mapping));
  if (historic.reviews.length) throw new Error(`Непригодные документы поступления: ${historic.reviews.length}`);
  const receipts = historic.delta.receipts ?? [];
  const materialRows = new Map(snapshot.materials.map((item) => [text(item.externalId, "material.externalId"), item]));
  const partnerRows = new Map(snapshot.counterparties.map((item) => [text(item.externalId, "counterparty.externalId"), item]));
  const materialIds = new Set(mapping.materials.map((item) => item.externalId));
  const customerIds = new Set(mapping.counterparties.filter((item) => item.roles.includes("customer")).map((item) => item.externalId));
  const accountForGroup = new Map([["Материалы", "1310"], ["Готовая продукция", "1320"], ["Товары", "1330"]]);
  const balances = snapshot.accountingInventory.filter((item) => item.organizationId === mapping.organizationId);
  const balanceKeys = new Set<string>();
  for (const balance of balances) {
    const materialId = text(balance.materialId, "accountingInventory.materialId");
    const warehouseId = text(balance.warehouseId, "accountingInventory.warehouseId");
    if (!materialIds.has(materialId)) throw new Error("Бухгалтерский остаток ссылается на номенклатуру вне складского mapping");
    const group = materialRows.get(materialId)?.groupName;
    const expectedAccount = group === null ? null : accountForGroup.get(text(group, "material.groupName"));
    if (!["1310", "1320", "1330"].includes(String(balance.accountCode)) ||
        (group !== null && balance.accountCode !== expectedAccount)) throw new Error(`Счёт 1С не соответствует группе материала ${materialId}`);
    const key = `${materialId}:${warehouseId}`;
    if (balanceKeys.has(key)) throw new Error(`Несколько бухгалтерских остатков для одного материала и склада ${key}`);
    balanceKeys.add(key);
    const quantity = decimal(balance.quantityDebit, "accountingInventory.quantityDebit", 6)
      .sub(decimal(balance.quantityCredit, "accountingInventory.quantityCredit", 6));
    const amount = decimal(balance.amountDebit, "accountingInventory.amountDebit", 2)
      .sub(decimal(balance.amountCredit, "accountingInventory.amountCredit", 2));
    if (quantity.isNegative() || amount.isNegative() || (quantity.isZero() !== amount.isZero())) {
      throw new Error(`Несогласованные количество и сумма бухгалтерского остатка ${key}`);
    }
  }
  for (const diagnostic of snapshot.balances.filter((item) => item.organizationId === mapping.organizationId)) {
    const key = `${text(diagnostic.materialId, "diagnostic.materialId")}:${text(diagnostic.warehouseId, "diagnostic.warehouseId")}`;
    const accounting = balances.find((item) => `${item.materialId}:${item.warehouseId}` === key);
    const quantity = accounting === undefined ? new Decimal(0) :
      decimal(accounting.quantityDebit, "accounting.quantityDebit", 6).sub(decimal(accounting.quantityCredit, "accounting.quantityCredit", 6));
    if (!quantity.eq(decimal(diagnostic.quantity, "diagnostic.quantity", 6))) {
      throw new Error(`Диагностический регистр и бухгалтерский остаток расходятся: ${key}`);
    }
  }
  const documents = [...snapshot.sales.map((item) => ({ kind: "SALE" as const, item })),
    ...snapshot.invoices.map((item) => ({ kind: "INVOICE" as const, item }))]
    .filter(({ item }) => item.organizationId === mapping.organizationId && item.deleted !== true);
  for (const { item } of documents) {
    if (!customerIds.has(text(item.counterpartyId, "document.counterpartyId"))) throw new Error("Документ покупателя не имеет роли клиента");
  }
  const target = await prisma.workspace.findUnique({ where: { id: mapping.workspaceId }, select: { id: true } });
  if (target) throw new Error("Целевой контур уже существует: повторный bootstrap запрещён");
  const stockByMaterial = new Map<string, Decimal>();
  const valueByMaterial = new Map<string, Decimal>();
  for (const balance of balances) {
    const id = text(balance.materialId, "balance.materialId");
    const quantity = decimal(balance.quantityDebit, "quantityDebit", 6).sub(decimal(balance.quantityCredit, "quantityCredit", 6));
    const amount = decimal(balance.amountDebit, "amountDebit", 2).sub(decimal(balance.amountCredit, "amountCredit", 2));
    stockByMaterial.set(id, (stockByMaterial.get(id) ?? new Decimal(0)).add(quantity));
    valueByMaterial.set(id, (valueByMaterial.get(id) ?? new Decimal(0)).add(amount));
  }
  const report = {
    status: apply ? "STAGING_APPLY" : "STAGING_PLAN_ONLY", generatedAt: snapshot.generatedAt,
    snapshotSha256: createHash("sha256").update(raw).digest("hex"), targetWorkspaceId: mapping.workspaceId,
    counts: { sourceCounterparties: snapshot.counterparties.length, customers: customerIds.size,
      suppliers: mapping.counterparties.filter((item) => item.roles.includes("supplier")).length,
      sourceNomenclature: snapshot.materials.length, stockableMaterials: mapping.materials.length,
      historicReceiptLines: receipts.length, openingBalanceRows: balances.length,
      receivableBalanceRows: snapshot.receivables.length,
      sales: snapshot.sales.length, invoices: snapshot.invoices.length,
      incomingPaymentsRawOnly: snapshot.incomingPayments.length,
      outgoingPaymentsRawOnly: snapshot.outgoingPayments.length },
    openingStock: [...stockByMaterial].map(([externalId, quantity]) => ({
      code: text(materialRows.get(externalId)?.code, "material.code"), quantity: quantity.toString(),
      bookValue: valueByMaterial.get(externalId)?.toString() ?? "0",
    })),
    inventoryValuation: "Количество и балансовая стоимость взяты со счетов 1310/1320/1330 1С. Удельная цена лота округлена до 4 знаков по точности CRM.",
  };
  if (!apply) { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); return; }

  const org = snapshot.organizations.find((item) => item.externalId === mapping.organizationId)!;
  const importedBy = randomUUID();
  const materialInternalIds = new Map(mapping.materials.map((item) => [item.externalId, randomUUID()]));
  const customerInternalIds = new Map([...customerIds].map((id) => [id, randomUUID()]));
  const supplierInternalIds = new Map(mapping.counterparties.filter((item) => item.roles.includes("supplier")).map((item) => [item.externalId, randomUUID()]));
  const historicByMaterial = new Map<string, typeof receipts>();
  for (const receipt of receipts) {
    const sourceId = String(receipt.materialExternalId).split(":").at(-1)!;
    historicByMaterial.set(sourceId, [...(historicByMaterial.get(sourceId) ?? []), receipt]);
  }
  await prisma.$transaction(async (tx) => {
    await tx.workspace.create({ data: { id: mapping.workspaceId,
      name: `${text(org.name, "organization.name")} · 1С (проверка)`, timezone: "Asia/Almaty", currency: "KZT" } });
    await tx.user.create({ data: { id: importedBy, workspaceId: mapping.workspaceId,
      name: "Импорт из 1С", email: `1c-import-${mapping.workspaceId}@miracle-chem.local`,
      role: UserRole.ADMIN, active: false } });
    const productionLine = await tx.productionLine.create({ data: { workspaceId: mapping.workspaceId,
      code: "LINE-01", name: "Линия №1", capacity: "0", capacityUnit: Unit.M3 } });
    await tx.productionTank.create({ data: { workspaceId: mapping.workspaceId,
      productionLineId: productionLine.id, code: "TANK-01", name: "Чан №1", capacityUnit: Unit.M3 } });
    await tx.oneCSourceSnapshot.create({ data: { workspaceId: mapping.workspaceId,
      sourceInstanceId: mapping.sourceInstanceId, organizationExternalId: mapping.organizationId,
      generatedAt: new Date(snapshot.generatedAt), sha256: report.snapshotSha256, payload: json(source) } });

    for (const item of mapping.counterparties) {
      const row = partnerRows.get(item.externalId)!;
      const name = text(row.name, "counterparty.name");
      const taxId = typeof row.taxId === "string" ? row.taxId.trim() || null : null;
      if (item.roles.includes("customer")) {
        const id = customerInternalIds.get(item.externalId)!;
        await tx.customer.create({ data: { id, workspaceId: mapping.workspaceId, name, taxId,
          active: row.deleted !== true } });
        await tx.oneCExternalReference.create({ data: { workspaceId: mapping.workspaceId, source: "1C",
          entityType: OneCSyncEntityType.CUSTOMER, externalId: `${mapping.sourceInstanceId}:${item.externalId}`,
          internalId: id, sourceUpdatedAt: new Date(snapshot.generatedAt), payloadHash: hash(row) } });
      }
      if (item.roles.includes("supplier")) {
        const id = supplierInternalIds.get(item.externalId)!;
        await tx.supplier.create({ data: { id, workspaceId: mapping.workspaceId, name, taxId,
          active: row.deleted !== true } });
        await tx.oneCExternalReference.create({ data: { workspaceId: mapping.workspaceId, source: "1C",
          entityType: OneCSyncEntityType.SUPPLIER, externalId: `${mapping.sourceInstanceId}:${item.externalId}`,
          internalId: id, sourceUpdatedAt: new Date(snapshot.generatedAt), payloadHash: hash(row) } });
      }
    }
    for (const item of mapping.materials) {
      const row = materialRows.get(item.externalId)!;
      const id = materialInternalIds.get(item.externalId)!;
      const previous = [...(historicByMaterial.get(item.externalId) ?? [])].sort((a, b) =>
        String(a.receivedAt).localeCompare(String(b.receivedAt))).at(-1);
      await tx.material.create({ data: { id, workspaceId: mapping.workspaceId,
        code: item.code, name: text(row.name, "material.name"), type: item.type as never,
        baseUnit: item.baseUnit as Unit, costPerBaseUnit: previous?.unitCost ?? "0",
        currentStock: "0", reservedStock: "0", minimumStock: "0", currency: "KZT", active: true } });
      await tx.oneCExternalReference.create({ data: { workspaceId: mapping.workspaceId, source: "1C",
        entityType: OneCSyncEntityType.MATERIAL, externalId: `${mapping.sourceInstanceId}:${item.externalId}`,
        internalId: id, sourceUpdatedAt: new Date(snapshot.generatedAt), payloadHash: hash(row) } });
    }
    for (const receipt of receipts) {
      const sourceId = String(receipt.materialExternalId).split(":").at(-1)!;
      await tx.materialPriceHistory.create({ data: { workspaceId: mapping.workspaceId,
        materialId: materialInternalIds.get(sourceId)!, pricePerBaseUnit: String(receipt.unitCost),
        currency: "KZT", effectiveAt: new Date(String(receipt.receivedAt)), source: "1C_PURCHASE",
        referenceId: String(receipt.externalId).split(":").at(-2),
        note: `Поступление 1С №${String(receipt.number)}` } });
    }
    for (const balance of balances) {
      const externalId = text(balance.materialId, "balance.materialId");
      const materialId = materialInternalIds.get(externalId)!;
      const material = mapping.materials.find((item) => item.externalId === externalId)!;
      const quantity = decimal(balance.quantityDebit, "quantityDebit", 6)
        .sub(decimal(balance.quantityCredit, "quantityCredit", 6));
      if (quantity.isZero()) continue;
      const amount = decimal(balance.amountDebit, "amountDebit", 2)
        .sub(decimal(balance.amountCredit, "amountCredit", 2));
      const cost = amount.div(quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
      const warehouseId = text(balance.warehouseId, "balance.warehouseId");
      const lot = await tx.materialLot.create({ data: { workspaceId: mapping.workspaceId, materialId,
        lotNumber: `1C-OPEN-${warehouseId}`, receivedAt: new Date(snapshot.generatedAt),
        initialQuantity: quantity.toString(), availableQuantity: quantity.toString(), reservedQuantity: "0",
        unit: material.baseUnit as Unit, unitCost: cost, currency: "KZT",
        qualitySnapshot: json({ source: "1C_OPENING_BALANCE", snapshotSha256: report.snapshotSha256,
          sourceWarehouseId: warehouseId, accountCode: balance.accountCode,
          bookValue: amount.toString(), valuation: "1C_ACCOUNTING_BALANCE" }) } });
      const before = (await tx.material.findUniqueOrThrow({ where: { id: materialId }, select: { currentStock: true } })).currentStock;
      const after = new Decimal(before.toString()).add(quantity);
      await tx.material.update({ where: { id: materialId }, data: { currentStock: after.toString() } });
      await tx.materialMovement.create({ data: { workspaceId: mapping.workspaceId, materialLotId: lot.id,
        type: MaterialMovementType.ADJUSTMENT, quantity: quantity.toString(), unit: material.baseUnit as Unit,
        baseQuantity: quantity.toString(), baseUnit: material.baseUnit as Unit,
        stockBefore: before, stockAfter: after.toString(), reservedBefore: "0", reservedAfter: "0",
        reason: "Начальный бухгалтерский остаток 1С", occurredAt: new Date(snapshot.generatedAt),
        metadata: json({ source: "1C", snapshotSha256: report.snapshotSha256, warehouseId,
          accountCode: balance.accountCode, bookValue: amount.toString() }) } });
    }
    for (const { kind, item } of documents) {
      const documentId = text(item.externalId, "document.externalId");
      const customer = partnerRows.get(text(item.counterpartyId, "document.counterpartyId"))!;
      const lines = (kind === "SALE" ? snapshot.saleLines : snapshot.invoiceLines)
        .filter((line) => line.documentId === documentId);
      const total = decimal(item.amount, "document.amount", 2);
      const vat = lines.reduce((sum, line) => sum.add(decimal(line.vatAmount, "line.vatAmount", 2)), new Decimal(0));
      if (vat.gt(total)) throw new Error(`НДС превышает сумму документа ${documentId}`);
      await tx.accountingDocument.create({ data: { workspaceId: mapping.workspaceId,
        number: `1C-${kind}-${text(item.number, "document.number")}`,
        type: kind === "SALE" ? AccountingDocumentType.WAYBILL : AccountingDocumentType.PAYMENT_INVOICE,
        status: kind === "SALE" && item.posted === true ? AccountingDocumentStatus.ISSUED : AccountingDocumentStatus.DRAFT,
        documentAt: new Date(`${text(item.documentAt, "document.documentAt")}${mapping.sourceUtcOffset}`),
        ...(kind === "SALE" && item.posted === true ? { issuedAt: new Date(`${text(item.documentAt, "document.documentAt")}${mapping.sourceUtcOffset}`) } : {}),
        counterparty: text(customer.name, "counterparty.name"),
        counterpartyTaxId: typeof customer.taxId === "string" ? customer.taxId.trim() || null : null,
        customerId: customerInternalIds.get(text(item.counterpartyId, "document.counterpartyId")),
        subtotal: total.sub(vat).toString(), vatAmount: vat.toString(), totalAmount: total.toString(),
        currency: "KZT", createdById: importedBy,
        details: json({ source: "1C", externalId: documentId, posted: item.posted === true }),
        items: { create: lines.map((line) => {
          const amount = decimal(line.amount, "line.amount", 2);
          const lineVat = decimal(line.vatAmount, "line.vatAmount", 2);
          const quantity = decimal(line.quantity, "line.quantity", 6);
          if (quantity.isZero() || lineVat.gt(amount)) throw new Error("Неверные значения строки счёта/реализации");
          const product = materialRows.get(text(line.materialId, "line.materialId"));
          if (!product) throw new Error("Строка счёта/реализации ссылается на неизвестную номенклатуру");
          const net = amount.sub(lineVat);
          return { description: text(product.name, "material.name"), quantity: quantity.toString(),
            unit: text(line.unitName, "line.unitName"), unitPrice: net.div(quantity).toDecimalPlaces(4).toString(),
            amount: net.toString(), position: Number(line.lineNumber) };
        }) },
      } });
    }
    await tx.auditLog.create({ data: { workspaceId: mapping.workspaceId, actorId: importedBy,
      action: "ONE_C_AUTHORITATIVE_STAGING", entityType: AuditEntityType.WORKSPACE,
      entityId: mapping.workspaceId, after: json(report) } });
  }, { maxWait: 10_000, timeout: 120_000 });
  process.stdout.write(`${JSON.stringify({ ...report, status: "STAGING_CREATED_NOT_ACTIVE" }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
