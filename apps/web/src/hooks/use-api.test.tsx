import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateFilterProvider } from "./use-date-filter.js";
import { useApi } from "./use-api.js";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({ apiFetch: apiFetchMock }));

function Harness({ path }: { path: string }) {
  const { data, error, loading, reload } = useApi<{ ok: boolean }>(path);
  return <><output>{loading ? "loading" : error ? "error" : data?.ok ? "ready" : "empty"}</output>
    <button type="button" onClick={() => void reload()}>Retry</button></>;
}

describe("useApi", () => {
  beforeEach(() => { apiFetchMock.mockReset(); });

  it("aborts an obsolete request when the screen changes", async () => {
    const signals: AbortSignal[] = [];
    apiFetchMock.mockImplementation((_path: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise(() => undefined);
    });

    const page = render(<DateFilterProvider><Harness path="/materials" /></DateFilterProvider>);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));

    page.rerender(<DateFilterProvider><Harness path="/recipes" /></DateFilterProvider>);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(screen.getByText("loading")).toBeInTheDocument();
  });

  it("does not expose the previous period's data while a new request is pending", async () => {
    let finishNext: ((value: { ok: boolean }) => void) | undefined;
    apiFetchMock.mockImplementation((path: string) => path.startsWith("/materials")
      ? Promise.resolve({ ok: true })
      : new Promise<{ ok: boolean }>((resolve) => { finishNext = resolve; }));

    const page = render(<DateFilterProvider><Harness path="/materials" /></DateFilterProvider>);
    expect(await screen.findByText("ready")).toBeInTheDocument();
    page.rerender(<DateFilterProvider><Harness path="/recipes" /></DateFilterProvider>);
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();

    await act(async () => finishNext?.({ ok: false }));
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("does not restore old data when retrying a failed new-period request", async () => {
    let finishRetry: ((value: { ok: boolean }) => void) | undefined;
    let recipeAttempts = 0;
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith("/materials")) return Promise.resolve({ ok: true });
      recipeAttempts += 1;
      if (recipeAttempts === 1) return Promise.reject(new Error("Network error"));
      return new Promise<{ ok: boolean }>((resolve) => { finishRetry = resolve; });
    });

    const page = render(<DateFilterProvider><Harness path="/materials" /></DateFilterProvider>);
    expect(await screen.findByText("ready")).toBeInTheDocument();
    page.rerender(<DateFilterProvider><Harness path="/recipes" /></DateFilterProvider>);
    expect(await screen.findByText("error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();

    await act(async () => finishRetry?.({ ok: true }));
    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});
