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

export function formatMetric(metrics: QuantityMetric[]): string {
  if (metrics.length === 0) return "0";
  return metrics
    .map((metric) => `${formatNumber(metric.value)} ${unitLabel[metric.unit]}`)
    .join(" · ");
}

