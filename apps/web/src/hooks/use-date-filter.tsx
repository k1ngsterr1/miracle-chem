import { createContext, useContext, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

const STORAGE_KEY = "miracle-chem:selected-date";

interface DateFilterValue {
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  resetToToday: () => void;
}

const fallbackDateFilter: DateFilterValue = {
  selectedDate: todayDate(),
  setSelectedDate: () => undefined,
  resetToToday: () => undefined,
};

const DateFilterContext = createContext<DateFilterValue>(fallbackDateFilter);

export function DateFilterProvider({ children }: PropsWithChildren) {
  const [selectedDate, setSelectedDate] = useState(readSelectedDate);
  const value = useMemo<DateFilterValue>(() => ({
    selectedDate,
    setSelectedDate: (nextDate) => {
      const valueToStore = isDateOnly(nextDate) ? nextDate : todayDate();
      setSelectedDate(valueToStore);
      persistSelectedDate(valueToStore);
    },
    resetToToday: () => {
      const today = todayDate();
      setSelectedDate(today);
      persistSelectedDate(today);
    },
  }), [selectedDate]);

  return <DateFilterContext.Provider value={value}>{children}</DateFilterContext.Provider>;
}

export function useDateFilter(): DateFilterValue {
  return useContext(DateFilterContext);
}

export function applySelectedDate(path: string | null, selectedDate: string): string | null {
  if (path === null || !usesOperationalDate(path)) return path;
  const url = new URL(path, "https://miracle-chem.local");
  if (!url.searchParams.has("from") && !url.searchParams.has("to")) url.searchParams.set("date", selectedDate);
  return `${url.pathname}${url.search}`;
}

export function todayDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function readSelectedDate(): string {
  if (typeof window === "undefined") return todayDate();
  try {
    const storage = window.localStorage;
    const stored = typeof storage?.getItem === "function" ? storage.getItem(STORAGE_KEY) : null;
    return stored !== null && isDateOnly(stored) ? stored : todayDate();
  } catch {
    return todayDate();
  }
}

function persistSelectedDate(value: string): void {
  try {
    const storage = window.localStorage;
    if (typeof storage?.setItem === "function") storage.setItem(STORAGE_KEY, value);
  } catch {
    // Private browsing or embedded previews may intentionally disable storage.
  }
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function usesOperationalDate(path: string): boolean {
  const pathname = path.split("?")[0] ?? path;
  return pathname === "/dashboard"
    || pathname === "/dashboard/analytics"
    || pathname === "/batches"
    || pathname === "/transfers"
    || pathname === "/wagons"
    || pathname === "/materials/purchase-batches"
    || pathname === "/recipes"
    || pathname === "/reports/production"
    || pathname === "/reports/expenses"
    || pathname === "/reports/material-consumption"
    || pathname === "/reports/product-balance"
    || pathname === "/reports/recipe-efficiency"
    || pathname === "/reports/lrt";
}
