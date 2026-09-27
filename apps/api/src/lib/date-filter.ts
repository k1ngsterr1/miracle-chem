import { ApiError } from "./api-error.js";

export interface DayPeriod {
  from: Date;
  to: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Converts the CRM working date into the plant's calendar day. The project is
 * operated in Kazakhstan, where the production day is Asia/Almaty (+05:00).
 */
export function dayPeriodFromQuery(value: string | undefined): DayPeriod | undefined {
  if (value === undefined) return undefined;
  if (!DATE_ONLY.test(value)) throw new ApiError(400, "INVALID_DATE", "Дата должна быть передана в формате ГГГГ-ММ-ДД");
  const from = new Date(`${value}T00:00:00.000+05:00`);
  const to = new Date(`${value}T23:59:59.999+05:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ApiError(400, "INVALID_DATE", "Выбрана некорректная дата");
  }
  return { from, to };
}

/**
 * Warehouse expiry dates are entered without time. Treat the stated date as
 * valid through the full production day in Almaty instead of expiring a lot
 * at 00:00 UTC.
 */
export function startOfAlmatyDay(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000+05:00`);
}
