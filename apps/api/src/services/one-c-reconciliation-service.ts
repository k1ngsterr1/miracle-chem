import { Decimal } from "decimal.js";
import { AccountingDocumentStatus, AccountingDocumentType, OneCSyncEntityType, Prisma } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { prisma } from "../lib/prisma.js";
import { fullSnapshotHash, fullSnapshotSchema } from "./one-c-full-snapshot-service.js";
import { loadOneCFinance } from "./one-c-finance-service.js";
import { accountingBalanceIssue, comparableAccountingUnitCost } from "./one-c-accounting-balance.js";
import { mapOneCMaterialUnit } from "./one-c-material-unit.js";

type Difference = { area: string; sourceId: string; field: string };

function sameDecimal(actual: { toString(): string }, expected: Decimal | string): boolean {
  return new Decimal(actual.toString()).eq(expected);
}

function addDifference(differences: Difference[], area: string, sourceId: string, field: string): void {
  differences.push({ area, sourceId, field });
}

/** Read-only, point-in-time comparison of the latest accepted 1C snapshot with its CRM projection. */
export async function reconcileLatestOneCWorkspace(workspaceId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.oneCSyncRun.findFirst({ where: { workspaceId, source: "1C_FULL_SNAPSHOT",
      summary: { path: ["appliedToOperationalTables"], equals: true } },
    orderBy: [{ generatedAt: "desc" }, { completedAt: "desc" }], select: { generatedAt: true, summary: true } });
    const summary = run?.summary && typeof run.summary === "object" && !Array.isArray(run.summary)
      ? run.summary as Record<string, unknown> : null;
    const projection = summary?.projection && typeof summary.projection === "object" && !Array.isArray(summary.projection)
      ? summary.projection as Record<string, unknown> : null;
    const unitScaleUnverifiedMaterialIds = new Set(Array.isArray(projection?.unitScaleUnverifiedMaterialIds)
      ? projection.unitScaleUnverifiedMaterialIds.filter((id): id is string => typeof id === "string") : []);
    if (typeof summary?.snapshotId !== "string" || typeof summary.sha256 !== "string") {
      throw new ApiError(404, "ONE_C_RECONCILIATION_UNAVAILABLE", "Нет применённого полного снимка 1С для сверки");
    }
    const saved = await tx.oneCSourceSnapshot.findFirst({ where: { id: summary.snapshotId, workspaceId },
      select: { id: true, generatedAt: true, sourceInstanceId: true,
        organizationExternalId: true, sha256: true, payload: true } });
    if (!saved) throw new ApiError(409, "ONE_C_RECONCILIATION_SOURCE_MISSING", "Исходный снимок 1С не найден");
    const parsed = fullSnapshotSchema.shape.snapshot.safeParse(saved.payload);
    if (!parsed.success) throw new ApiError(409, "ONE_C_RECONCILIATION_SOURCE_INVALID", "Исходный снимок 1С не проходит проверку формата");
    const snapshot = parsed.data;
    const differences: Difference[] = [];
    if (fullSnapshotHash(snapshot) !== saved.sha256 || summary.sha256 !== saved.sha256) {
      addDifference(differences, "source", saved.id, "sha256");
    }
    if (new Date(snapshot.generatedAt).getTime() !== saved.generatedAt.getTime() ||
        run!.generatedAt.getTime() !== saved.generatedAt.getTime()) {
      addDifference(differences, "source", saved.id, "generatedAt");
    }
    const newest = await tx.oneCSourceSnapshot.findFirst({ where: { workspaceId, sourceInstanceId: saved.sourceInstanceId },
      orderBy: { generatedAt: "desc" }, select: { id: true } });
    if (newest?.id !== saved.id) addDifference(differences, "source", saved.id, "notLatestSnapshot");

    const refs = await tx.oneCExternalReference.findMany({ where: { workspaceId, source: "1C",
      externalId: { startsWith: `${saved.sourceInstanceId}:` },
      entityType: { in: [OneCSyncEntityType.MATERIAL, OneCSyncEntityType.CUSTOMER, OneCSyncEntityType.SUPPLIER] } },
    select: { entityType: true, externalId: true, internalId: true } });
    const scoped = (type: OneCSyncEntityType) => new Map(refs.filter((ref) => ref.entityType === type)
      .map((ref) => [ref.externalId.slice(saved.sourceInstanceId.length + 1), ref.internalId]));
    const materialIds = scoped(OneCSyncEntityType.MATERIAL);
    const customerIds = scoped(OneCSyncEntityType.CUSTOMER);
    const supplierIds = scoped(OneCSyncEntityType.SUPPLIER);
    const materialRows = new Map(snapshot.materials.map((row) => [row.externalId, row]));
    const partnerRows = new Map(snapshot.counterparties.map((row) => [row.externalId, row]));
    const [materials, customers, suppliers, documents] = await Promise.all([
      tx.material.findMany({ where: { workspaceId, id: { in: [...materialIds.values()] } },
        select: { id: true, code: true, name: true, active: true, currentStock: true, reservedStock: true,
          lots: { select: { lotNumber: true, availableQuantity: true, reservedQuantity: true, unitCost: true,
            currency: true, qualitySnapshot: true } } } }),
      tx.customer.findMany({ where: { workspaceId, id: { in: [...customerIds.values()] } },
        select: { id: true, name: true, taxId: true, active: true } }),
      tx.supplier.findMany({ where: { workspaceId, id: { in: [...supplierIds.values()] } },
        select: { id: true, name: true, taxId: true, active: true } }),
      tx.accountingDocument.findMany({ where: { workspaceId, details: { path: ["source"], equals: "1C" } },
        select: { id: true, number: true, type: true, status: true, documentAt: true, customerId: true,
          subtotal: true, vatAmount: true, totalAmount: true, details: true,
          items: { select: { position: true, description: true, quantity: true, unit: true,
            unitPrice: true, amount: true } } } }),
    ]);
    const materialById = new Map(materials.map((row) => [row.id, row]));
    const customerById = new Map(customers.map((row) => [row.id, row]));
    const supplierById = new Map(suppliers.map((row) => [row.id, row]));
    for (const [externalId, internalId] of materialIds) {
      const source = materialRows.get(externalId);
      const actual = materialById.get(internalId);
      if (!source || !actual) { addDifference(differences, "material", externalId, "missing"); continue; }
      if (actual.code !== source.code) addDifference(differences, "material", externalId, "code");
      if (actual.name !== source.name.trim()) addDifference(differences, "material", externalId, "name");
      if (actual.active === source.deleted) addDifference(differences, "material", externalId, "active");
    }
    for (const source of snapshot.materials) {
      if (!source.service && !source.deleted && !materialIds.has(source.externalId)) {
        addDifference(differences, "material", source.externalId, "unmapped");
      }
    }
    for (const [type, ids, actualById] of [
      ["customer", customerIds, customerById], ["supplier", supplierIds, supplierById],
    ] as const) {
      for (const [externalId, internalId] of ids) {
        const source = partnerRows.get(externalId);
        const actual = actualById.get(internalId);
        if (!source || !actual) { addDifference(differences, type, externalId, "missing"); continue; }
        if (actual.name !== source.name.trim()) addDifference(differences, type, externalId, "name");
        if ((actual.taxId ?? "") !== source.taxId) addDifference(differences, type, externalId, "taxId");
        if (actual.active === source.deleted) addDifference(differences, type, externalId, "active");
      }
    }

    const expectedStock = new Map<string, Decimal>();
    const expectedLotKeys = new Set<string>();
    let valuationUnavailableRows = 0;
    for (const row of snapshot.accountingInventory) {
      if (row.organizationId !== saved.organizationExternalId) continue;
      const materialId = materialIds.get(row.materialId);
      const actual = materialId ? materialById.get(materialId) : null;
      if (!actual) { addDifference(differences, "stock", row.materialId, "materialMapping"); continue; }
      const sourceMaterial = materialRows.get(row.materialId);
      const unit = sourceMaterial ? mapOneCMaterialUnit(sourceMaterial) : null;
      if (!unit) { addDifference(differences, "stock", row.materialId, "sourceUnit"); continue; }
      const sourceQuantity = new Decimal(row.quantityDebit).sub(row.quantityCredit);
      const quantity = sourceQuantity.mul(unit.quantityFactor);
      const value = new Decimal(row.amountDebit).sub(row.amountCredit);
      const issue = accountingBalanceIssue(quantity, value);
      if (issue) valuationUnavailableRows += 1;
      // These raw 1C rows are retained, but their tonne-to-KG conversion was
      // deliberately not projected without a trustworthy physical baseline.
      if (unitScaleUnverifiedMaterialIds.has(row.materialId)) continue;
      expectedStock.set(materialId!, (expectedStock.get(materialId!) ?? new Decimal(0)).add(quantity));
      const lotKey = `${materialId}:${row.warehouseId}`;
      if (expectedLotKeys.has(lotKey)) addDifference(differences, "stock", row.materialId, "duplicateWarehouse");
      expectedLotKeys.add(lotKey);
      const lot = actual.lots.find((item) => item.lotNumber === `1C-OPEN-${row.warehouseId}`);
      if (!lot && (!quantity.isZero() || !value.isZero())) {
        addDifference(differences, "stock", row.materialId, "missingLot"); continue;
      }
      if (!lot) continue;
      if (!sameDecimal(lot.availableQuantity, quantity)) addDifference(differences, "stock", row.materialId, "quantity");
      const expectedUnitCost = comparableAccountingUnitCost(quantity, value)
        ? value.div(quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP) : new Decimal(0);
      if (!sameDecimal(lot.unitCost, expectedUnitCost) || lot.currency !== "KZT") {
        addDifference(differences, "stock", row.materialId, "unitCostOrCurrency");
      }
      const metadata = lot.qualitySnapshot && typeof lot.qualitySnapshot === "object" && !Array.isArray(lot.qualitySnapshot)
        ? lot.qualitySnapshot as Record<string, unknown> : null;
      if (!metadata || metadata.sourceWarehouseId !== row.warehouseId || metadata.accountCode !== row.accountCode ||
          typeof metadata.bookValue !== "string" || !sameDecimal(metadata.bookValue, value)) {
        addDifference(differences, "stock", row.materialId, "bookValueOrWarehouse");
      }
      if (issue ? metadata?.valuationIssue !== issue || metadata?.valuationComparable !== false
        : metadata?.valuationIssue != null || metadata?.valuationComparable === false) {
        addDifference(differences, "stock", row.materialId, "valuationState");
      }
      if (unit.quantityFactor !== "1" && (metadata?.sourceUnitName !== sourceMaterial?.unitName ||
          metadata?.sourceQuantity !== sourceQuantity.toString() || metadata?.quantityFactor !== unit.quantityFactor)) {
        addDifference(differences, "stock", row.materialId, "sourceUnitConversion");
      }
    }
    for (const [externalId, materialId] of materialIds) {
      if (unitScaleUnverifiedMaterialIds.has(externalId)) continue;
      const actual = materialById.get(materialId);
      if (!actual) continue;
      if (!sameDecimal(actual.currentStock, expectedStock.get(materialId) ?? new Decimal(0))) {
        addDifference(differences, "stock", externalId, "currentStock");
      }
      if (!sameDecimal(actual.reservedStock, "0") || actual.lots.some((lot) => !sameDecimal(lot.reservedQuantity, "0"))) {
        addDifference(differences, "stock", externalId, "reservation");
      }
      for (const lot of actual.lots) {
        if (lot.lotNumber.startsWith("1C-OPEN-") && !expectedLotKeys.has(`${materialId}:${lot.lotNumber.slice(8)}`) &&
            !sameDecimal(lot.availableQuantity, "0")) addDifference(differences, "stock", externalId, "unexpectedSourceLot");
        if (!lot.lotNumber.startsWith("1C-OPEN-") && !sameDecimal(lot.availableQuantity, "0")) {
          addDifference(differences, "stock", externalId, "localLot");
        }
      }
    }

    const actualDocuments = new Map<string, typeof documents[number]>();
    for (const document of documents) {
      const details = document.details && typeof document.details === "object" && !Array.isArray(document.details)
        ? document.details as Record<string, unknown> : null;
      const kind = details?.kind === "SALE" || details?.kind === "INVOICE" ? details.kind
        : document.type === AccountingDocumentType.WAYBILL ? "SALE" : "INVOICE";
      const externalId = typeof details?.externalId === "string" ? details.externalId : "";
      const key = `${kind}:${externalId}`;
      if (actualDocuments.has(key)) addDifference(differences, "document", externalId, "duplicate");
      actualDocuments.set(key, document);
    }
    const expectedDocumentKeys = new Set<string>();
    for (const kind of ["SALE", "INVOICE"] as const) {
      const rows = kind === "SALE" ? snapshot.sales : snapshot.invoices;
      const lines = kind === "SALE" ? snapshot.saleLines : snapshot.invoiceLines;
      for (const row of rows.filter((item) => item.organizationId === saved.organizationExternalId)) {
        const key = `${kind}:${row.externalId}`;
        expectedDocumentKeys.add(key);
        const actual = actualDocuments.get(key);
        if (!actual) { addDifference(differences, "document", row.externalId, "missing"); continue; }
        const expectedStatus = row.deleted ? AccountingDocumentStatus.CANCELLED
          : kind === "INVOICE" || row.posted ? AccountingDocumentStatus.ISSUED : AccountingDocumentStatus.DRAFT;
        const expectedType = kind === "SALE" ? AccountingDocumentType.WAYBILL : AccountingDocumentType.PAYMENT_INVOICE;
        const itemRows = lines.filter((item) => item.documentId === row.externalId);
        const vat = itemRows.reduce((sum, item) => sum.add(item.vatAmount), new Decimal(0));
        if (actual.type !== expectedType) addDifference(differences, "document", row.externalId, "type");
        if (actual.status !== expectedStatus) addDifference(differences, "document", row.externalId, "status");
        if (actual.number !== `1C-${kind}-${row.number}`) addDifference(differences, "document", row.externalId, "number");
        if (actual.customerId !== (customerIds.get(row.counterpartyId) ?? null)) {
          addDifference(differences, "document", row.externalId, "customer");
        }
        if (actual.documentAt.getTime() !== new Date(`${row.documentAt}+05:00`).getTime()) {
          addDifference(differences, "document", row.externalId, "date");
        }
        if (!sameDecimal(actual.totalAmount, row.amount) || !sameDecimal(actual.vatAmount, vat) ||
            !sameDecimal(actual.subtotal, new Decimal(row.amount).sub(vat))) {
          addDifference(differences, "document", row.externalId, "amountOrVat");
        }
        const actualItems = new Map(actual.items.map((item) => [item.position, item]));
        if (actual.items.length !== itemRows.length) addDifference(differences, "document", row.externalId, "lineCount");
        for (const item of itemRows) {
          const projected = actualItems.get(item.lineNumber);
          const sourceMaterial = materialRows.get(item.materialId);
          const netAmount = new Decimal(item.amount).sub(item.vatAmount);
          const expectedUnitPrice = new Decimal(item.quantity).isZero() ? null
            : netAmount.div(item.quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
          if (!projected || !sourceMaterial || !expectedUnitPrice || projected.description !== sourceMaterial.name ||
              projected.unit !== item.unitName || !sameDecimal(projected.quantity, item.quantity) ||
              !sameDecimal(projected.amount, netAmount) || !sameDecimal(projected.unitPrice, expectedUnitPrice)) {
            addDifference(differences, "document", row.externalId, `line:${item.lineNumber}`);
          }
        }
      }
    }
    for (const [key, document] of actualDocuments) {
      if (!expectedDocumentKeys.has(key) && document.status !== AccountingDocumentStatus.CANCELLED) {
        addDifference(differences, "document", key, "unexpectedActive");
      }
    }
    const countsByArea = Object.fromEntries([...new Set(differences.map((item) => item.area))]
      .map((area) => [area, differences.filter((item) => item.area === area).length]));
    return {
      source: { snapshotId: saved.id, sha256: saved.sha256, generatedAt: saved.generatedAt.toISOString(),
        readStartedAt: snapshot.readStartedAt, consistency: snapshot.consistency },
      checks: { mappedMaterials: materialIds.size, mappedCustomers: customerIds.size, mappedSuppliers: supplierIds.size,
        accountingBalanceRows: snapshot.accountingInventory.length, projectedDocuments: expectedDocumentKeys.size,
        receivableRows: snapshot.receivables.length, incomingPaymentRows: snapshot.incomingPayments.length,
        outgoingPaymentRows: snapshot.outgoingPayments.length },
      notProjected: { receipts: snapshot.receipts.length, warehouses: snapshot.warehouses?.length ?? 0,
        contracts: snapshot.contracts?.length ?? 0, specifications: snapshot.specifications?.length ?? 0,
        specificationComponents: snapshot.specificationComponents?.length ?? 0,
        productionReports: snapshot.productionReports?.length ?? 0, productionProducts: snapshot.productionProducts?.length ?? 0,
        paymentsAreReadModelOnly: true, receivablesAreReadModelOnly: true,
        valuationUnavailableRows, unitScaleUnverifiedMaterials: unitScaleUnverifiedMaterialIds.size },
      differences, countsByArea, snapshot, customerIdByExternalId: customerIds,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 60_000 });

  const finance = await loadOneCFinance(workspaceId);
  const latestRun = await prisma.oneCSyncRun.findFirst({ where: { workspaceId, source: "1C_FULL_SNAPSHOT",
    summary: { path: ["appliedToOperationalTables"], equals: true } },
  orderBy: [{ generatedAt: "desc" }, { completedAt: "desc" }], select: { summary: true } });
  const latestSnapshotId = (latestRun?.summary as Record<string, unknown> | null)?.snapshotId;
  if (!finance || finance.snapshotAt !== result.source.generatedAt || latestSnapshotId !== result.source.snapshotId) {
    return { verdict: "UNSTABLE_RETRY" as const,
      reason: "A newer 1C snapshot was applied during reconciliation; retry against one stable snapshot",
      source: result.source, checks: result.checks, notProjected: result.notProjected,
      discrepancyCount: 0, countsByArea: {}, examples: [] };
  }
  const financeDifferences: Difference[] = [];
  {
    const balance = result.snapshot.receivables.reduce((sum, row) => {
      const net = new Decimal(row.amountDebit).sub(row.amountCredit);
      return net.isPositive() ? sum.add(net) : sum;
    }, new Decimal(0));
    const prepayment = result.snapshot.receivables.reduce((sum, row) => {
      const net = new Decimal(row.amountDebit).sub(row.amountCredit);
      return net.isNegative() ? sum.add(net.abs()) : sum;
    }, new Decimal(0));
    if (!sameDecimal(finance.totalReceivables, balance)) {
      addDifference(financeDifferences, "finance", result.source.snapshotId, "totalReceivables");
    }
    if (!sameDecimal(finance.totalPrepayments, prepayment)) {
      addDifference(financeDifferences, "finance", result.source.snapshotId, "totalPrepayments");
    }
    const expectedDebt = new Map<string, Decimal>();
    for (const row of result.snapshot.receivables) {
      const net = new Decimal(row.amountDebit).sub(row.amountCredit);
      if (net.isPositive()) expectedDebt.set(row.counterpartyId,
        (expectedDebt.get(row.counterpartyId) ?? new Decimal(0)).add(net));
    }
    const actualDebt = new Map(finance.receivables.map((row) => [row.counterpartyExternalId, row]));
    if (actualDebt.size !== expectedDebt.size || finance.receivables.length !== actualDebt.size) {
      addDifference(financeDifferences, "finance", result.source.snapshotId, "debtorCount");
    }
    for (const [externalId, amount] of expectedDebt) {
      const row = actualDebt.get(externalId);
      if (!row || !sameDecimal(row.amount, amount) ||
          row.customerId !== (result.customerIdByExternalId.get(externalId) ?? null)) {
        addDifference(financeDifferences, "finance", externalId, "debtorBalanceOrClient");
      }
    }
    if (finance.incomingPayments.length !== result.snapshot.incomingPayments.length ||
        finance.outgoingPayments.length !== result.snapshot.outgoingPayments.length) {
      addDifference(financeDifferences, "finance", result.source.snapshotId, "paymentCount");
    }
    for (const direction of ["INCOMING", "OUTGOING"] as const) {
      const sourceRows = direction === "INCOMING" ? result.snapshot.incomingPayments : result.snapshot.outgoingPayments;
      const actualRows = direction === "INCOMING" ? finance.incomingPayments : finance.outgoingPayments;
      const actualById = new Map(actualRows.map((row) => [row.externalId, row]));
      if (actualById.size !== actualRows.length) addDifference(financeDifferences, "finance", direction, "duplicatePayment");
      for (const source of sourceRows) {
        const actual = actualById.get(source.externalId);
        if (!actual || actual.number !== source.number || actual.currency !== source.currencyName ||
            actual.posted !== source.posted || actual.deleted !== source.deleted ||
            actual.purpose !== source.purpose || !sameDecimal(actual.amount, source.amount) ||
            actual.customerId !== (result.customerIdByExternalId.get(source.counterpartyId) ?? null) ||
            actual.documentAt !== new Date(`${source.documentAt}+05:00`).toISOString()) {
          addDifference(financeDifferences, "finance", source.externalId, `${direction.toLowerCase()}Payment`);
        }
      }
    }
    const expectedSales = result.snapshot.sales.filter((row) => row.posted && !row.deleted)
      .map((row) => `${new Date(`${row.documentAt}+05:00`).toISOString()}:${new Decimal(row.amount).toString()}`).sort();
    const actualSales = finance.sales.map((row) => `${row.documentAt}:${new Decimal(row.amount).toString()}`).sort();
    if (JSON.stringify(expectedSales) !== JSON.stringify(actualSales)) {
      addDifference(financeDifferences, "finance", result.source.snapshotId, "salesReadModel");
    }
  }
  const differences = [...result.differences, ...financeDifferences];
  const countsByArea = { ...result.countsByArea,
    ...(financeDifferences.length ? { finance: financeDifferences.length } : {}) };
  return { verdict: differences.length ? "DIVERGED" as const : "PARTIAL" as const,
    reason: differences.length ? "CRM projection differs from the latest 1C snapshot"
      : "Checked projections match, but full 1C physical restore and unprojected collections remain unverified",
    source: result.source, checks: result.checks, notProjected: result.notProjected,
    discrepancyCount: differences.length, countsByArea, examples: differences.slice(0, 100) };
}
