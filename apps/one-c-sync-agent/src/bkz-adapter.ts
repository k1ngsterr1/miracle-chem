import { createHash } from "node:crypto";
import type { OneCDelta } from "./types.js";

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const UNITS = ["G", "KG", "T", "ML", "L", "M3", "PCS", "M", "PAIR"];
const TYPES = ["CEMENT", "WATER", "SAND", "AGGREGATE", "CHEMICAL_ADDITIVE", "REAGENT", "OTHER"];

export interface BkzMapping {
  version: 1;
  workspaceId: string;
  organizationId: string;
  sourceInstanceId: string;
  approvedBy: string;
  approvedAt: string;
  sourceUtcOffset: string;
  currency: "KZT";
  materials: Array<{
    externalId: string;
    code: string;
    type: string;
    baseUnit: string;
    sourceBaseUnitId: string;
    receiptUnits: Array<{ externalId: string; coefficient: string }>;
  }>;
  counterparties: Array<{ externalId: string; roles: Array<"customer" | "supplier"> }>;
}

export interface BkzSnapshot {
  schemaVersion: 1;
  configuration: "БухгалтерияДляКазахстана";
  generatedAt: string;
  organizations: Row[];
  counterparties: Row[];
  materials: Row[];
  receipts: Row[];
  balances: Row[];
  accountingInventory: Row[];
  receivables: Row[];
  sales: Row[];
  saleLines: Row[];
  invoices: Row[];
  invoiceLines: Row[];
  incomingPayments: Row[];
  outgoingPayments: Row[];
}

interface DocumentState { hash: string; baseline: boolean; receipts: Row[] }
export interface BkzState {
  version: 1;
  mappingHash: string;
  baselineSnapshotHash: string;
  observedAt: string;
  masters: Record<string, string>;
  documents: Record<string, DocumentState>;
}
export interface BkzPlan { delta: OneCDelta; nextState: BkzState; reviews: Array<{ entity: string; externalId: string; reason: string }> }

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function row(value: unknown): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Ожидался JSON-объект");
  return value as Row;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 2000) throw new Error("Коллекция должна содержать не более 2000 записей");
  return value;
}
function text(value: unknown, max = 250): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error("Неверное текстовое поле");
  return value.trim();
}
function uuid(value: unknown): string {
  const id = text(value, 36).toLowerCase();
  if (!UUID.test(id) || id === "00000000-0000-0000-0000-000000000000") throw new Error("Нужен непустой GUID");
  return id;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Неверный логический признак 1С");
  return value;
}
function timestamp(value: unknown): string {
  const input = text(value, 50);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(input) || !Number.isFinite(Date.parse(input))) throw new Error("Ожидалась дата ISO с часовым поясом");
  return new Date(input).toISOString();
}
function unique(rows: Row[], key: string): void {
  const ids = rows.map((item) => uuid(item[key]));
  if (new Set(ids).size !== ids.length) throw new Error(`Повторяющиеся GUID: ${key}`);
}

export function parseBkzMapping(value: unknown): BkzMapping {
  const data = row(value);
  if (data.version !== 1 || data.currency !== "KZT") throw new Error("Поддерживаются mapping v1 и валюта KZT");
  const offset = text(data.sourceUtcOffset, 6);
  if (!/^[+-](?:0\d|1[0-3]):[0-5]\d$/u.test(offset)) throw new Error("Укажите утверждённое смещение времени 1С, например +05:00");
  const materials = list(data.materials).map((item) => {
    const source = row(item);
    const type = text(source.type); const baseUnit = text(source.baseUnit);
    if (!TYPES.includes(type) || !UNITS.includes(baseUnit)) throw new Error("Неизвестный тип или единица реагента");
    const receiptUnits = list(source.receiptUnits).map((unit) => {
      const entry = row(unit); const coefficient = text(entry.coefficient);
      if (scaled(coefficient) <= 0n) throw new Error("Коэффициент единицы должен быть положительным");
      return { externalId: uuid(entry.externalId), coefficient };
    });
    unique(receiptUnits, "externalId");
    if (receiptUnits.length === 0) throw new Error("Нужны явные единицы поступлений");
    return { externalId: uuid(source.externalId), code: text(source.code, 40), type, baseUnit, sourceBaseUnitId: uuid(source.sourceBaseUnitId), receiptUnits };
  });
  const counterparties = list(data.counterparties).map((item) => {
    const source = row(item);
    const roles = list(source.roles);
    if (roles.length === 0 || roles.some((role) => role !== "customer" && role !== "supplier") || new Set(roles).size !== roles.length) throw new Error("Укажите роли customer/supplier без повторов");
    return { externalId: uuid(source.externalId), roles: roles as Array<"customer" | "supplier"> };
  });
  unique(materials, "externalId"); unique(counterparties, "externalId");
  if (new Set(materials.map((item) => item.code)).size !== materials.length) throw new Error("Повторяющиеся коды CRM в mapping");
  return { version: 1, workspaceId: uuid(data.workspaceId), organizationId: uuid(data.organizationId), sourceInstanceId: uuid(data.sourceInstanceId), approvedBy: text(data.approvedBy), approvedAt: timestamp(data.approvedAt), sourceUtcOffset: offset, currency: "KZT", materials, counterparties };
}

export function parseBkzSnapshot(value: unknown): BkzSnapshot {
  const data = row(value);
  if (data.schemaVersion !== 1 || data.configuration !== "БухгалтерияДляКазахстана") throw new Error("Неверный формат или конфигурация снимка 1С");
  const optionalRows = (name: string): Row[] => data[name] === undefined ? [] : list(data[name]).map(row);
  const result: BkzSnapshot = {
    schemaVersion: 1,
    configuration: data.configuration,
    generatedAt: timestamp(data.generatedAt),
    organizations: list(data.organizations).map(row),
    counterparties: list(data.counterparties).map(row),
    materials: list(data.materials).map(row),
    receipts: list(data.receipts).map(row),
    balances: optionalRows("balances"),
    accountingInventory: optionalRows("accountingInventory"),
    receivables: optionalRows("receivables"),
    sales: optionalRows("sales"),
    saleLines: optionalRows("saleLines"),
    invoices: optionalRows("invoices"),
    invoiceLines: optionalRows("invoiceLines"),
    incomingPayments: optionalRows("incomingPayments"),
    outgoingPayments: optionalRows("outgoingPayments"),
  };
  for (const rows of [result.organizations, result.counterparties, result.materials]) unique(rows, "externalId");
  return result;
}

function documents(snapshot: BkzSnapshot, mapping: BkzMapping): Map<string, Row[]> {
  if (!snapshot.organizations.some((item) => uuid(item.externalId) === mapping.organizationId)) throw new Error("В снимке нет утверждённой организации");
  const grouped = new Map<string, Row[]>();
  for (const receipt of snapshot.receipts) {
    if (uuid(receipt.organizationId) !== mapping.organizationId) continue;
    const id = uuid(receipt.documentId);
    if (!Number.isSafeInteger(receipt.lineNumber) || Number(receipt.lineNumber) < 1) throw new Error("Неверный номер строки 1С");
    boolean(receipt.posted); boolean(receipt.deleted);
    grouped.set(id, [...(grouped.get(id) ?? []), receipt]);
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => Number(a.lineNumber) - Number(b.lineNumber));
    if (new Set(rows.map((item) => item.lineNumber)).size !== rows.length) throw new Error("Повтор номера строки документа");
    if (rows.some((item) => item.posted !== rows[0]!.posted || item.deleted !== rows[0]!.deleted)) throw new Error("Несогласованный статус документа: повторите снимок");
  }
  return grouped;
}

/** Explicit bootstrap: historical posted documents are recorded, never re-received. */
export function initializeBkzState(snapshot: BkzSnapshot, mapping: BkzMapping): BkzState {
  const state: BkzState = { version: 1, mappingHash: fingerprint(mapping), baselineSnapshotHash: fingerprint(snapshot), observedAt: snapshot.generatedAt, masters: {}, documents: {} };
  for (const [id, rows] of documents(snapshot, mapping)) {
    if (rows[0]!.posted && !rows[0]!.deleted) state.documents[id] = { hash: fingerprint(rows), baseline: true, receipts: [] };
  }
  return state;
}

export function prepareBkzPlan(snapshot: BkzSnapshot, mapping: BkzMapping, previous: BkzState): BkzPlan {
  if (previous.version !== 1 || previous.mappingHash !== fingerprint(mapping) || !/^[0-9a-f]{64}$/u.test(previous.baselineSnapshotHash)) throw new Error("Mapping изменён или checkpoint не подтверждён. Нужна сверка; не удаляйте состояние.");
  if (Date.parse(snapshot.generatedAt) < Date.parse(timestamp(previous.observedAt))) throw new Error("Снимок старее checkpoint");
  const observedAt = new Date(Math.max(Date.parse(snapshot.generatedAt), Date.parse(previous.observedAt) + 1)).toISOString();
  const state = structuredClone(previous); state.observedAt = observedAt;
  const customers: Row[] = []; const suppliers: Row[] = []; const materials: Row[] = []; const receipts: Row[] = [];
  const reviews: BkzPlan["reviews"] = [];
  const saveMaster = (kind: string, value: Row, target: Row[]) => {
    const key = `${kind}:${String(value.externalId)}`; const hash = fingerprint(value);
    if (previous.masters[key] !== hash) { target.push({ ...value, updatedAt: observedAt }); state.masters[key] = hash; }
  };
  for (const binding of mapping.counterparties) {
    const source = snapshot.counterparties.find((item) => uuid(item.externalId) === binding.externalId);
    if (!source) throw new Error(`Контрагент ${binding.externalId} исчез из снимка`);
    const taxId = typeof source.taxId === "string" ? source.taxId.trim() : "";
    if (taxId.length > 50) throw new Error(`ИИН/БИН контрагента ${binding.externalId} превышает лимит CRM`);
    const data = { externalId: sourceId(mapping, binding.externalId), name: text(source.name), ...(taxId ? { taxId } : {}), active: !boolean(source.deleted) };
    if (binding.roles.includes("customer")) saveMaster("customer", data, customers);
    if (binding.roles.includes("supplier")) saveMaster("supplier", data, suppliers);
  }
  for (const binding of mapping.materials) {
    const source = snapshot.materials.find((item) => uuid(item.externalId) === binding.externalId);
    if (!source || boolean(source.deleted) || boolean(source.service) || uuid(source.unitId) !== binding.sourceBaseUnitId) throw new Error(`Изменён, удалён или не является сырьём материал ${binding.externalId}`);
    saveMaster("material", { externalId: sourceId(mapping, binding.externalId), code: binding.code, name: text(source.name), type: binding.type, baseUnit: binding.baseUnit, currency: mapping.currency, productionEligible: true }, materials);
  }
  const current = documents(snapshot, mapping);
  for (const [id, known] of Object.entries(previous.documents)) {
    const lines = current.get(id);
    if (!lines || known.hash !== fingerprint(lines)) {
      reviews.push({ entity: "document", externalId: id, reason: lines ? "Изменён ранее учтённый документ; нужна корректировка" : "Документ исчез из снимка; требуется сверка" });
      // No additional lines are ever appended to an already accounted document.
      for (const receipt of known.receipts) receipts.push({ ...receipt, updatedAt: observedAt, posted: false });
    }
  }
  for (const [id, lines] of current) {
    if (previous.documents[id] || !lines[0]!.posted || lines[0]!.deleted) continue;
    try {
      const converted = lines.map((line) => convertReceipt(line, mapping, observedAt));
      receipts.push(...converted);
      state.documents[id] = { hash: fingerprint(lines), baseline: false, receipts: converted };
    } catch (error) {
      reviews.push({ entity: "document", externalId: id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const content = { workspaceId: mapping.workspaceId, generatedAt: observedAt, source: "1C" as const, customers, suppliers, materials, receipts };
  const delta: OneCDelta = { ...content, batchId: `bkz-${fingerprint({ previous, content })}` };
  if (Buffer.byteLength(JSON.stringify(delta), "utf8") > 8 * 1024 * 1024) throw new Error("Дельта превышает 8 МБ; требуется постраничный сборщик");
  return { delta, nextState: state, reviews };
}

function convertReceipt(line: Row, mapping: BkzMapping, observedAt: string): Row {
  const materialId = uuid(line.materialId); const supplierId = uuid(line.supplierId);
  const material = mapping.materials.find((item) => item.externalId === materialId);
  if (!material) throw new Error(`Не утверждён материал ${materialId}; документ удержан целиком`);
  if (!mapping.counterparties.some((item) => item.externalId === supplierId && item.roles.includes("supplier"))) throw new Error(`Не утверждён поставщик ${supplierId}`);
  const unit = material.receiptUnits.find((item) => item.externalId === uuid(line.unitId));
  if (!unit || scaled(unit.coefficient) !== scaled(line.coefficient)) throw new Error("Не утверждены единица/коэффициент строки 1С");
  if (text(line.currencyName) !== mapping.currency || scaled(line.exchangeRate) !== scaled("1") || scaled(line.exchangeMultiplicity) !== scaled("1")) throw new Error("Валютное поступление требует отдельной сверки курса");
  const rawQuantity = scaled(line.quantity); const coefficient = scaled(line.coefficient);
  const product = rawQuantity * coefficient;
  if (product % 1_000_000n !== 0n) throw new Error("Количество не помещается в точность CRM (6 знаков)");
  const quantity = product / 1_000_000n;
  if (quantity <= 0n || quantity > 99_999_999_999_999_999_999n) throw new Error("Неверное количество поступления");
  let cost = scaled(line.amount); const vat = scaled(line.vatAmount);
  const includesVat = boolean(line.amountIncludesVat); const vatInCost = boolean(line.vatInCost);
  if (includesVat && !vatInCost) cost -= vat;
  if (!includesVat && vatInCost) cost += vat;
  if (cost < 0n) throw new Error("Сумма НДС больше стоимости строки");
  // Half-up rounding once, at the CRM's Decimal(20,4) boundary. No IEEE floats.
  const unitCost = (cost * 10_000n * 2n + quantity) / (quantity * 2n);
  if (unitCost > 99_999_999_999_999_999_999n) throw new Error("Стоимость превышает точность CRM");
  const wallTime = text(line.receivedAt, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(wallTime)) throw new Error("Неверная локальная дата документа");
  const calendarCheck = new Date(`${wallTime}Z`);
  if (!Number.isFinite(calendarCheck.getTime()) || calendarCheck.toISOString().slice(0, 19) !== wallTime) throw new Error("Несуществующая календарная дата документа");
  const externalId = `${sourceId(mapping, uuid(line.documentId))}:${Number(line.lineNumber)}`;
  return { externalId, updatedAt: observedAt, posted: true, number: text(line.number, 100), receivedAt: timestamp(`${wallTime}${mapping.sourceUtcOffset}`), materialExternalId: sourceId(mapping, materialId), supplierExternalId: sourceId(mapping, supplierId), lotNumber: `1C:${externalId}`, quantity: decimalString(quantity, 6), unit: material.baseUnit, unitCost: decimalString(unitCost, 4), currency: mapping.currency };
}

function sourceId(mapping: BkzMapping, externalId: string): string { return `${mapping.sourceInstanceId}:${externalId}`; }

function scaled(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,20}(?:\.\d{1,12})?$/u.test(value)) throw new Error("Ожидалось неотрицательное десятичное число строкой");
  const [integer = "0", fraction = ""] = value.split(".");
  if (/[^0]/u.test(fraction.slice(6))) throw new Error("Точность исходного числа превышает 6 знаков");
  return BigInt(integer) * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, "0"));
}
function decimalString(value: bigint, places: number): string {
  const digits = value.toString().padStart(places + 1, "0");
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/u, "");
}
