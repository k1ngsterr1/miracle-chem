import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStatus } from "./SyncStatus.js";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../api.js", () => ({ apiFetch: fetchMock }));

describe("SyncStatus", () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it("shows stale source data and explains that balances are not historical", async () => {
    fetchMock.mockResolvedValue({ configured: true, state: "STALE", snapshotAt: "2026-09-27T08:00:00Z", error: null });
    render(<SyncStatus />);
    fireEvent.click(await screen.findByRole("button", { name: "Данные устарели" }));
    expect(screen.getByText(/Календарь фильтрует документы/u)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Более 45 минут");
    expect(fetchMock).toHaveBeenCalledWith("/integrations/1c/status", expect.anything());
  });

  it("does not claim healthy exchange when the server cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("Соединение недоступно"));
    render(<SyncStatus />);
    fireEvent.click(await screen.findByRole("button", { name: "Обмен недоступен" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Соединение недоступно");
    expect(screen.queryByText("Данные обновлены")).not.toBeInTheDocument();
  });
});
