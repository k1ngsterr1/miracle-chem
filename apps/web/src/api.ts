const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4100/api";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; details?: unknown } }
      | null;
    throw new ApiClientError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ?? `Запрос завершился с кодом ${response.status}`,
      payload?.error?.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiMutation<T>(
  path: string,
  body: unknown,
  options: { method?: "POST" | "PATCH"; idempotent?: boolean } = {},
): Promise<T> {
  return apiFetch<T>(path, {
    method: options.method ?? "POST",
    ...(options.idempotent
      ? { headers: { "Idempotency-Key": crypto.randomUUID() } }
      : {}),
    body: JSON.stringify(body),
  });
}

export function reportExportUrl(
  type: "production" | "materials" | "balance" | "recipe-efficiency" | "lrt",
  format: "csv" | "xlsx",
  from: string,
  to: string,
): string {
  const params = new URLSearchParams({ type, format, from, to });
  return `${API_URL}/reports/export?${params.toString()}`;
}
