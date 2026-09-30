import { Decimal } from "decimal.js";
import { AccountingDocumentStatus, LrtTransferStatus, Unit } from "../generated/prisma/index.js";
import { startOfAlmatyDay } from "../lib/date-filter.js";

interface SaleForMatching {
  customerId: string | null;
  documentAt: Date;
  status: AccountingDocumentStatus;
  items: { description: string; quantity: Decimal; unit: string }[];
}

interface TransferForMatching {
  customerId: string | null;
  transferAt: Date;
  status: LrtTransferStatus;
  items: { sentQuantity: Decimal; unit: Unit; productLot: { concreteGrade: string } }[];
}

const sentStatuses = new Set<LrtTransferStatus>([
  LrtTransferStatus.SENT,
  LrtTransferStatus.ACCEPTED,
  LrtTransferStatus.PARTIALLY_ACCEPTED,
  LrtTransferStatus.REJECTED,
]);

function normalizedName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ");
}

function normalizedUnit(value: string): Unit | null {
  const key = value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/[.\s³]/gu, "").replace(/\^3/gu, "3");
  const units: Record<string, Unit> = {
    г: Unit.G, гр: Unit.G, g: Unit.G,
    кг: Unit.KG, kg: Unit.KG,
    т: Unit.T, тонна: Unit.T, тонны: Unit.T, t: Unit.T,
    мл: Unit.ML, ml: Unit.ML,
    л: Unit.L, l: Unit.L,
    м3: Unit.M3, m3: Unit.M3,
    шт: Unit.PCS, штука: Unit.PCS, штуки: Unit.PCS, pcs: Unit.PCS,
    м: Unit.M, m: Unit.M, пар: Unit.PAIR, пара: Unit.PAIR, пары: Unit.PAIR, pair: Unit.PAIR,
  };
  return units[key] ?? null;
}

function positionsKey(rows: { name: string; quantity: Decimal; unit: Unit | null }[]): string | null {
  if (rows.length === 0 || rows.some((row) => !normalizedName(row.name) || row.unit === null || !row.quantity.gt(0))) return null;
  const totals = new Map<string, Decimal>();
  for (const row of rows) {
    const key = `${normalizedName(row.name)}\u0000${row.unit}`;
    totals.set(key, (totals.get(key) ?? new Decimal(0)).add(row.quantity));
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, quantity]) => `${key}\u0000${quantity.toFixed(6)}`).join("\u0001");
}

/** Read-only reconciliation: never creates a CRM shipment or changes stock. */
export function saleMatchesTransfer(sale: SaleForMatching, transfer: TransferForMatching): boolean {
  if (!sale.customerId || sale.customerId !== transfer.customerId) return false;
  if (sale.status !== AccountingDocumentStatus.ISSUED && sale.status !== AccountingDocumentStatus.PAID) return false;
  if (!sentStatuses.has(transfer.status)) return false;
  if (startOfAlmatyDay(sale.documentAt).getTime() !== startOfAlmatyDay(transfer.transferAt).getTime()) return false;
  const salePositions = positionsKey(sale.items.map((item) => ({ name: item.description, quantity: item.quantity, unit: normalizedUnit(item.unit) })));
  const transferPositions = positionsKey(transfer.items.map((item) => ({
    name: item.productLot.concreteGrade, quantity: item.sentQuantity, unit: item.unit,
  })));
  return salePositions !== null && salePositions === transferPositions;
}
