import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api.js";
import { applySelectedDate, useDateFilter } from "./use-date-filter.js";

export function useApi<T>(path: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const { selectedDate, allDates } = useDateFilter();
  const datedPath = useMemo(() => applySelectedDate(path, selectedDate, allDates), [path, selectedDate, allDates]);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedPath, setResolvedPath] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    activeRequest.current?.abort();
    if (datedPath === null) {
      activeRequest.current = null;
      setData(null);
      setError(null);
      setResolvedPath(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await apiFetch<T>(datedPath, { signal: controller.signal });
      if (activeRequest.current === controller) setData(next);
    } catch (cause) {
      if (!controller.signal.aborted && activeRequest.current === controller) {
        setData(null);
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные");
      }
    } finally {
      if (activeRequest.current === controller) {
        setResolvedPath(datedPath);
        setLoading(false);
      }
    }
  }, [datedPath]);

  useEffect(() => {
    void reload();
    return () => activeRequest.current?.abort();
  }, [reload]);

  const pathChanged = resolvedPath !== datedPath;
  return { data: pathChanged ? null : data, loading: loading || pathChanged, error: pathChanged ? null : error, reload };
}
