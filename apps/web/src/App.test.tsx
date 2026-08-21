import { render, screen, waitFor } from "@testing-library/react";
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
};

describe("Miracle Chem app shell", () => {
  beforeEach(() => {
    window.location.hash = "dashboard";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith("/meta")
        ? meta
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
  });
});
