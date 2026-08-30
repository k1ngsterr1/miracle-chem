import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api.js";
import { applySelectedDate, useDateFilter } from "./use-date-filter.js";

export function useApi<T>(path: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const { selectedDate } = useDateFilter();
  const datedPath = useMemo(() => applySelectedDate(path, selectedDate), [path, selectedDate]);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (datedPath === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<T>(datedPath));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [datedPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
