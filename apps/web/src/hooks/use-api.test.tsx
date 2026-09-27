import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateFilterProvider } from "./use-date-filter.js";
import { useApi } from "./use-api.js";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({ apiFetch: apiFetchMock }));

function Harness({ path }: { path: string }) {
  const { loading } = useApi<{ ok: boolean }>(path);
  return <output>{loading ? "loading" : "ready"}</output>;
}

describe("useApi", () => {
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
});
