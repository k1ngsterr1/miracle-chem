import { parseBkzMapping, type BkzMapping, type BkzSnapshot } from "./bkz-adapter.js";

type SourceRow = Record<string, unknown>;

export interface BkzAuthorityProposal {
  mapping: BkzMapping;
  excludedServices: string[];
  excludedDeletedMaterials: string[];
  unclassifiedCounterparties: string[];
}

function string(row: SourceRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`1С: отсутствует ${field}`);
  return value.trim();
}

function category(row: SourceRow): string {
  return string(row, "groupName");
}

/**
 * A proposal based on actual 1C directory groups and document participation.
 * The target must be an empty workspace: 1C codes are not reconciled to legacy CRM codes.
 */
export function proposeBkzAuthorityMapping(
  snapshot: BkzSnapshot,
  options: {
    workspaceId: string;
    organizationId: string;
    sourceInstanceId: string;
    approvedBy: string;
    approvedAt: string;
    sourceUtcOffset: string;
  },
): BkzAuthorityProposal {
  if (!snapshot.organizations.some((item) => item.externalId === options.organizationId)) {
    throw new Error("Организация не найдена в снимке 1С");
  }
  const excludedServices: string[] = [];
  const excludedDeletedMaterials: string[] = [];
  const materials = snapshot.materials.flatMap((item) => {
    const externalId = string(item, "externalId");
    const group = category(item);
    if (typeof item.service !== "boolean" || typeof item.deleted !== "boolean") throw new Error(`Неизвестный статус номенклатуры ${externalId}`);
    if (item.deleted) { excludedDeletedMaterials.push(externalId); return []; }
    if (item.service) { excludedServices.push(externalId); return []; }
    const sourceBaseUnitId = string(item, "unitId");
    const sourceUnit = string(item, "unitName").toLocaleLowerCase("ru");
    const baseUnit = sourceUnit === "кг" ? "KG" : sourceUnit === "шт" ? "PCS" : null;
    if (!baseUnit) throw new Error(`Для номенклатуры ${externalId} не поддержана единица ${sourceUnit}`);
    const type = group === "Материалы" ? "REAGENT"
      : group === "Готовая продукция" ? "CHEMICAL_ADDITIVE"
      : group === "Товары" ? "OTHER"
      : null;
    if (!type) throw new Error(`Новая группа номенклатуры 1С «${group}» требует проверки`);
    const receiptUnits = new Map<string, string>([[sourceBaseUnitId, "1"]]);
    for (const receipt of snapshot.receipts.filter((line) => line.materialId === externalId)) {
      const unitId = string(receipt, "unitId");
      const coefficient = string(receipt, "coefficient");
      if (receiptUnits.has(unitId) && receiptUnits.get(unitId) !== coefficient) {
        throw new Error(`Разные коэффициенты единицы ${unitId} у номенклатуры ${externalId}`);
      }
      receiptUnits.set(unitId, coefficient);
    }
    return [{ externalId, code: string(item, "code"), type, baseUnit, sourceBaseUnitId,
      receiptUnits: [...receiptUnits].map(([unitId, coefficient]) => ({ externalId: unitId, coefficient })) }];
  });

  const customerIds = new Set<string>();
  const supplierIds = new Set<string>();
  for (const item of snapshot.counterparties) {
    const group = typeof item.groupName === "string" ? item.groupName.trim() : "";
    if (group.startsWith("Продажа")) customerIds.add(string(item, "externalId"));
    if (group.startsWith("Поставщики")) supplierIds.add(string(item, "externalId"));
  }
  for (const item of [...snapshot.sales, ...snapshot.invoices, ...snapshot.incomingPayments]) {
    if (item.organizationId === options.organizationId) customerIds.add(string(item, "counterpartyId"));
  }
  for (const item of snapshot.receipts) {
    if (item.organizationId === options.organizationId) supplierIds.add(string(item, "supplierId"));
  }
  for (const item of snapshot.outgoingPayments) {
    if (item.organizationId === options.organizationId) supplierIds.add(string(item, "counterpartyId"));
  }
  const known = new Set(snapshot.counterparties.map((item) => string(item, "externalId")));
  for (const externalId of [...customerIds, ...supplierIds]) {
    if (!known.has(externalId)) throw new Error(`Документ ссылается на отсутствующего контрагента ${externalId}`);
  }
  const unclassifiedCounterparties: string[] = [];
  const counterparties = snapshot.counterparties.flatMap((item) => {
    const externalId = string(item, "externalId");
    const roles: Array<"customer" | "supplier"> = [];
    if (customerIds.has(externalId)) roles.push("customer");
    if (supplierIds.has(externalId)) roles.push("supplier");
    if (!roles.length) { unclassifiedCounterparties.push(externalId); return []; }
    return [{ externalId, roles }];
  });
  const mapping = parseBkzMapping({ version: 1, workspaceId: options.workspaceId,
    organizationId: options.organizationId, sourceInstanceId: options.sourceInstanceId,
    approvedBy: options.approvedBy, approvedAt: options.approvedAt,
    sourceUtcOffset: options.sourceUtcOffset, currency: "KZT", materials, counterparties });
  return { mapping, excludedServices, excludedDeletedMaterials, unclassifiedCounterparties };
}
