import type { QuantityMetric, Unit } from "../types.js";

const numberFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const compactFormatter = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const unitLabel: Record<Unit, string> = {
  G: "г",
  KG: "кг",
  T: "т",
  ML: "мл",
  L: "л",
  M3: "м³",
  PCS: "шт",
  M: "м",
  PAIR: "пар",
};

export function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return numberFormatter.format(Number(value));
}

export function formatCompact(value: string | number): string {
  return compactFormatter.format(Number(value));
}

export function formatMoney(value: string | number, currency = "KZT"): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function formatDate(value: string, withTime = false): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

/** Formats a Kazakhstan mobile number without letting punctuation leak into the API payload. */
export function formatKzPhone(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const digits = kzPhoneLocalDigits(value);
  if (digits === "") return "";

  let result = `+7 (${digits.slice(0, 3)}`;
  if (digits.length < 3) return result;
  result += `) ${digits.slice(3, 6)}`;
  if (digits.length < 6) return result;
  result += `-${digits.slice(6, 8)}`;
  if (digits.length < 8) return result;
  return `${result}-${digits.slice(8, 10)}`;
}

export function normalizeKzPhone(value: string): string {
  const digits = kzPhoneLocalDigits(value);
  return digits === "" ? "" : `+7${digits}`;
}

function kzPhoneLocalDigits(value: string): string {
  const digits = value.replace(/\D/gu, "");
  if (digits === "") return "";
  const hasExplicitCountryCode = value.trim().startsWith("+7")
    || (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")));
  return (hasExplicitCountryCode ? digits.slice(1) : digits).slice(0, 10);
}

export function formatMetric(metrics: QuantityMetric[]): string {
  if (metrics.length === 0) return "0";
  return metrics
    .map((metric) => `${formatNumber(metric.value)} ${unitLabel[metric.unit]}`)
    .join(" · ");
}
