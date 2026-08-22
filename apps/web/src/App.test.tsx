import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const meta = {
  workspace: { id: "w", name: "Miracle Chem Plant", timezone: "Asia/Almaty", currency: "KZT" },
  actor: { id: "u", name: "Алишер Махмутов", role: "ADMIN" },
  users: [],
  productionLines: [],
  productLots: [],
};

const dashboard = {
  period: { from: new Date().toISOString(), to: new Date().toISOString(), timezone: "Asia/Almaty" },
  metrics: {
    consumedMaterials: [{ value: "100", unit: "KG" }],
    produced: [{ value: "5", unit: "M3" }],
    sentToLrt: [],
    availableProduct: [{ value: "4.9", unit: "M3" }],
    activeBatches: 2,
    lossPercent: "0.99",
    criticalStockCount: 0,
    deviationBatchCount: 0,
    productionCost: "100000",
    operatingExpenses: [{ amount: "42000", currency: "KZT" }],
  },
  criticalMaterials: [],
  deviations: [],
  productionTrend: [],
  analytics: { productionByLine: [], batchStatuses: [], expenseTrend: [] },
};

describe("Miracle Chem app shell", () => {
  beforeEach(() => {
    window.location.hash = "dashboard";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith("/meta")
        ? meta
        : url.includes("/reports/production?")
          ? { items: [{ batchNumber: "ZM-TEST-1", status: "COMPLETED", actualOutput: "5", outputUnit: "M3" }] }
        : url.endsWith("/dashboard")
          ? dashboard
          : { items: [] };
      return { ok: true, status: 200, json: async () => payload } as Response;
    }));
  });

  it("loads the dashboard and keeps production modules visible", async () => {
    render(<App />);
    expect(screen.getByText("MIRACLE CHEM")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Загрузка раздела" })).toBeInTheDocument();
    expect(screen.queryByText("Загрузка модуля…")).not.toBeInTheDocument();
    expect(screen.queryByText("Загружаем производственные данные…")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Произведено сегодня")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Производство/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Склад/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Отгрузки/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Дислокация/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Расходы/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Бухгалтерия/u })).toBeInTheDocument();
  });

  it("opens modules through the global search", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Произведено сегодня")).toBeInTheDocument());

    const search = screen.getByPlaceholderText("Найти раздел CRM…");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "вагон" } });

    const results = screen.getByRole("listbox", { name: "Разделы CRM" });
    const destination = within(results).getByRole("option", { name: /Дислокация/u });
    fireEvent.click(destination);

    await waitFor(() => expect(window.location.hash).toBe("#wagons"));
    expect(screen.queryByRole("listbox", { name: "Разделы CRM" })).not.toBeInTheDocument();
  });

  it("opens reports and rows as dedicated pages", async () => {
    window.location.hash = "reports";
    render(<App />);

    await waitFor(() => expect(screen.getByText("Производственные отчёты")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Выпуск продукции/u }));
    await waitFor(() => expect(window.location.hash).toBe("#reports/production"));
    await waitFor(() => expect(screen.getByText("ZM-TEST-1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("ZM-TEST-1"));
    await waitFor(() => expect(window.location.hash).toBe("#reports/production/0"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ZM-TEST-1", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Все поля выбранной строки показаны полностью на отдельной странице.")).toBeInTheDocument();
  });
});
