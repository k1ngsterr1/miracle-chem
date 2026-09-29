import { useMemo } from "react";
import { useApi } from "./use-api.js";
import { useDateFilter } from "./use-date-filter.js";

interface SourceResponse<T> {
  available: boolean;
  snapshotAt?: string;
  items?: T[];
}

export interface OneCReceipt {
  documentId: string;
  lineNumber: number;
  number: string;
  receivedAt: string;
  posted: boolean;
  deleted: boolean;
  supplier: string;
  warehouse: string;
  material: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  currencyName: string;
}

export interface OneCProductionReport {
  externalId: string;
  number: string;
  documentAt: string;
  posted: boolean;
  deleted: boolean;
  warehouse: string;
  products: Array<{
    lineNumber: number;
    material: string;
    quantity: string;
    specification: string;
  }>;
}

export function useOneCSource<T>(section: "receipts" | "production", dateField: keyof T, enabled: boolean) {
  const { selectedDate, allDates } = useDateFilter();
  const source = useApi<SourceResponse<T>>(enabled
    ? `/integrations/1c/source/${section}${allDates ? "" : `?date=${selectedDate}`}` : null);
  const items = useMemo(() => (source.data?.available ? source.data.items ?? [] : [])
    .filter((item) => allDates || String(item[dateField]).slice(0, 10) === selectedDate)
    .sort((left, right) => String(right[dateField]).localeCompare(String(left[dateField]))),
  [allDates, dateField, selectedDate, source.data]);
  return { ...source, items };
}

export function oneCDocumentStatus(posted: boolean, deleted: boolean): string {
  return deleted ? "Помечен на удаление" : posted ? "Проведён" : "Не проведён";
}

export function sourceDecimal(value: string): string {
  const [whole, fraction] = value.split(".");
  const significantFraction = fraction?.replace(/0+$/u, "");
  return significantFraction ? `${whole},${significantFraction}` : whole ?? value;
}

export function sumSourceDecimals(values: string[]): string {
  const parsed = values.map((value) => {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(value);
    if (!match) return null;
    return { negative: match[1] === "-", whole: match[2]!, fraction: match[3] ?? "" };
  });
  if (parsed.some((part) => part === null)) return "0";
  const precision = Math.max(0, ...parsed.map((part) => part!.fraction.length));
  const factor = 10n ** BigInt(precision);
  const sum = parsed.reduce((total, part) => {
    const scaled = BigInt(part!.whole) * factor + BigInt(part!.fraction.padEnd(precision, "0") || "0");
    return total + (part!.negative ? -scaled : scaled);
  }, 0n);
  const absolute = sum < 0n ? -sum : sum;
  const fraction = precision === 0 ? "" : (absolute % factor).toString().padStart(precision, "0").replace(/0+$/u, "");
  return `${sum < 0n ? "-" : ""}${absolute / factor}${fraction ? `.${fraction}` : ""}`;
}

export function sourceMoney(value: string, currency: string): string {
  const normalized = currency.trim().toLocaleLowerCase("ru");
  const code = normalized === "тенге" || normalized === "тг" || normalized === "₸" ? "KZT" : currency.toUpperCase();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(value);
  const amount = match ? `${match[1]}${new Intl.NumberFormat("ru-RU").format(BigInt(match[2]!))}${match[3]?.replace(/0+$/u, "") ? `,${match[3].replace(/0+$/u, "")}` : ""}`
    : sourceDecimal(value);
  return `${amount} ${code === "KZT" ? "₸" : /^[A-Z]{3}$/u.test(code) ? code : currency}`.trim();
}
