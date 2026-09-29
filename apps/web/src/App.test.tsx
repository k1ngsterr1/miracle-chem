import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const meta = {
  workspace: { id: "w", name: "Miracle Chem Plant", timezone: "Asia/Almaty", currency: "KZT" },
  actor: { id: "u", name: "Алишер Махмутов", role: "ADMIN" },
  users: [],
  productionLines: [{ id: "line-1", code: "LINE-01", name: "Линия №1", capacity: "0", capacityUnit: "M3" }],
  productionTanks: [{ id: "tank-1", code: "TANK-01", name: "Чан №1", capacity: null, capacityUnit: "M3", productionLineId: "line-1", productionLine: { id: "line-1", code: "LINE-01", name: "Линия №1" } }],
  customers: [],
  productLots: [],
};

const authSession = {
  user: { id: "u", name: "Алишер Махмутов", email: "admin@miracle-chem.local", role: "ADMIN" },
  workspace: meta.workspace,
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
    dailyRevenue: [{ amount: "1250000", currency: "KZT" }],
    accountsReceivable: [{ amount: "72000000", currency: "KZT" }],
  },
  receivables: [{
    counterparty: "ТОО Test Buyer",
    counterpartyTaxId: "123456789012",
    currency: "KZT",
    amount: "72000000",
    overdueAmount: "0",
    invoiceCount: 5,
    linkedShipmentCount: 0,
    lastDocumentAt: new Date().toISOString(),
    nearestDueAt: null,
  }],
  criticalMaterials: [],
  mainReagents: [
    {
      id: "kt1",
      code: "KT-1",
      name: "КТ-1",
      currentStock: "2400",
      reservedStock: "0",
      freeStock: "2400",
      minimumStock: "500",
      plannedDemand: "2000",
      projectedStock: "400",
      shortfall: "0",
      baseUnit: "KG",
      isCritical: true,
      warningLevel: "LOW_AFTER_PLAN",
      missing: false,
    },
  ],
  stockWarnings: [{
    id: "kt1",
    code: "KT-1",
    name: "КТ-1",
    baseUnit: "KG",
    currentStock: "2400",
    reservedStock: "0",
    freeStock: "2400",
    minimumStock: "500",
    plannedDemand: "2000",
    projectedStock: "400",
    shortfall: "0",
    level: "LOW_AFTER_PLAN",
    affectedBatches: [{ id: "b1", number: "ZM-TEST-1", scheduledAt: new Date().toISOString(), requiredQuantity: "2000", unit: "KG" }],
  }],
  deviations: [],
  productionTrend: [],
  analytics: { productionByLine: [], batchStatuses: [], expenseTrend: [] },
};

const expense = {
  id: "expense-1",
  number: "RSH-20260828-KASPI",
  category: "LOGISTICS",
  costCenter: "LOGISTICS",
  paymentMethod: "CORPORATE_CARD",
  status: "RECORDED",
  incurredAt: "2026-08-28T10:00:00.000Z",
  amount: "18500",
  currency: "KZT",
  description: "Доставка реагентов",
  counterparty: "Kaspi Магазин",
  documentNumber: null,
  note: null,
  createdBy: { id: "u", name: "Алишер Махмутов" },
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
  createdAt: "2026-08-28T10:01:00.000Z",
  attachments: [{
    id: "receipt-1",
    name: "kaspi-check.pdf",
    storageKey: "expense-receipts/test/kaspi-check.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    url: null,
    createdAt: "2026-08-28T10:02:00.000Z",
  }],
};

const warehouse = {
  items: [{
    id: "material-gluconate",
    code: "GLUCONATE",
    name: "Глюконат Натрия",
    type: "REAGENT",
    baseUnit: "KG",
    currentStock: "1",
    reservedStock: "0",
    minimumStock: "0",
    costPerBaseUnit: "10",
    currency: "KZT",
    densityKgPerM3: null,
  }],
  summary: {
    sodiumGluconate: {
      name: "Глюконат Натрия",
      totalMassKg: "3000",
      freeMassKg: "2900",
      lotCount: 2,
      priceVariants: 2,
    },
  },
};

const additiveFormulas = {
  items: [{
    id: "formula-additive",
    code: "MC-KT1",
    name: "КТ-1",
    description: "Тестовая формула добавки",
    versions: [{
      id: "formula-version-additive",
      version: 1,
      expression: "binderMass * dosagePercent / 100",
      variables: ["binderMass", "dosagePercent"],
      precision: 6,
      roundingMode: "HALF_UP",
      dosagePercent: "1.2",
      components: [{
        id: "formula-component-gluconate",
        materialId: "material-gluconate",
        percentage: "100",
        material: warehouse.items[0],
      }],
    }],
  }],
};

const customers = {
  summary: { activeCustomers: 1, concreteRecipes: 1, formulasInUse: 1 },
  items: [{
    id: "customer-1",
    name: "ТОО Алатау Бетон",
    taxId: "123456789012",
    contactPerson: "Ерлан Садыков",
    phone: "+7 700 000 00 00",
    email: "tech@alatau-beton.kz",
    address: "Алматы",
    notes: null,
    active: true,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
    concreteRecipes: [{
      id: "customer-recipe-1",
      name: "Мостовой состав",
      concreteGrade: "B35 П4 F300 W12",
      basisVolume: "1",
      basisUnit: "M3",
      binderMassKg: "400",
      additiveDosagePercent: "1.2",
      additiveQuantityKg: "4.8",
      additiveQuantityPerM3Kg: "4.8",
      recommendedDosagePercent: "1.1",
      notes: null,
      createdAt: "2026-08-28T10:00:00.000Z",
      additiveFormulaVersion: {
        id: "formula-version-additive",
        version: 1,
        dosagePercent: "1.1",
        formula: { id: "formula-additive", code: "MC-KT1", name: "КТ-1" },
      },
      components: [
        { id: "cc-1", name: "Цемент М500", quantity: "400", unit: "KG", position: 0, note: null },
        { id: "cc-2", name: "Вода", quantity: "165", unit: "KG", position: 1, note: null },
      ],
    }],
  }],
};

const customerDetail = {
  ...customers.items[0],
  timeline: [
    {
      id: "timeline-debt",
      kind: "DEBT",
      occurredAt: "2026-08-29T11:00:00.000Z",
      title: "Текущая дебиторская задолженность",
      description: "1 счёт",
      status: "OPEN",
      amount: "280000",
      currency: "KZT",
      relatedId: null,
    },
    {
      id: "timeline-transfer",
      kind: "TRANSFER",
      occurredAt: "2026-08-28T12:00:00.000Z",
      title: "Отгрузка №OTG-001",
      description: "5 м³ · Самовывоз",
      status: "ACCEPTED",
      amount: null,
      currency: null,
      relatedId: "transfer-1",
    },
  ],
};

describe("Miracle Chem app shell", () => {
  beforeEach(() => {
    if (typeof window.localStorage?.removeItem === "function") window.localStorage.removeItem("miracle-chem:all-dates");
    window.location.hash = "dashboard";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith("/auth/session")
        ? authSession
        : url.endsWith("/meta")
        ? meta
        : url.endsWith("/materials")
          ? warehouse
        : url.endsWith("/formulas")
          ? additiveFormulas
        : url.endsWith("/customers/customer-1")
          ? customerDetail
        : url.endsWith("/customers")
          ? customers
        : url.includes("/expenses?")
          ? { items: [expense], summary: { totals: [{ currency: "KZT", amount: "18500" }], byCategory: [{ category: "LOGISTICS", currency: "KZT", amount: "18500", count: 1 }], recordedCount: 1, cancelledCount: 0 } }
        : url.endsWith("/expenses/expense-1")
          ? expense
        : url.includes("/accounting?")
          ? { items: [], summary: { totals: [], byStatus: [], byType: [] } }
        : url.includes("/reports/production?")
          ? { items: [{ batchNumber: "ZM-TEST-1", status: "COMPLETED", actualOutput: "5", outputUnit: "M3" }] }
        : url.endsWith("/integrations/1c/reconciliation")
          ? { verdict: "PARTIAL", source: { generatedAt: "2026-09-28T08:00:00Z" },
            discrepancyCount: 0, countsByArea: {}, notProjected: { receipts: 2 } }
        : url.includes("/integrations/1c/archive/archive-1/collections/")
          ? { collectionKey: "Справочник.Номенклатура", chunkIndex: 0, records: [{ Наименование: "Тестовый реагент", Код: "R-01" }] }
        : url.includes("/integrations/1c/archive")
          ? { items: [{ id: "archive-1", archiveId: "hash", generatedAt: "2026-09-28T08:00:00Z",
            readStartedAt: "2026-09-28T07:30:00Z", configurationVersion: "3.0.74.2",
            manifest: { collections: [{ key: "Справочник.Номенклатура", kind: "Catalogs", name: "Номенклатура",
              sensitivity: "BUSINESS", rowCount: 1, chunkHashes: ["hash"] }] } }] }
        : url.includes("/integrations/1c/source/warehouses")
          ? { available: true, section: "warehouses", snapshotAt: "2026-09-28T08:00:00Z",
            items: [{ externalId: "warehouse-1", code: "W1", name: "Склад 1С", deleted: false }] }
        : url.includes("/integrations/1c/source/contracts")
          ? { available: true, section: "contracts", snapshotAt: "2026-09-28T08:00:00Z",
            items: [{ externalId: "contract-1", contractNumber: "17", contractAt: "2026-09-27T08:00:00",
              counterparty: "ТОО Покупатель", name: "Договор 1С", deleted: false }] }
        : url.includes("/integrations/1c/source/receipts")
          ? { available: true, section: "receipts", snapshotAt: "2026-09-28T08:00:00Z",
            items: [1, 2].map((lineNumber) => ({ documentId: "receipt-1", lineNumber, number: "REC-1",
              receivedAt: "2026-09-27T08:00:00", posted: true, deleted: false,
              supplier: "ТОО Поставщик 1С", warehouse: "Склад 1С", material: `Реагент ${lineNumber}`,
              unitName: "кг", quantity: lineNumber === 1 ? "1.234567" : "2", unitPrice: "40",
              amount: String(lineNumber * 40), currencyName: "тенге" })) }
        : url.includes("/integrations/1c/source/production")
          ? { available: true, section: "production", snapshotAt: "2026-09-28T08:00:00Z",
            items: [{ externalId: "production-1", number: "PROD-1", documentAt: "2026-09-27T08:00:00",
              posted: true, deleted: false, warehouse: "Склад 1С",
              products: [{ lineNumber: 1, material: "Добавка КТ-1", quantity: "250", specification: "Спецификация КТ-1" }] }] }
        : (url.endsWith("/dashboard") || url.includes("/dashboard?"))
          ? dashboard
          : { items: [] };
      return { ok: true, status: 200, json: async () => payload } as Response;
    }));
  });

  it("shows a separate login page and opens the CRM after authentication", async () => {
    let authenticated = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/session") && !authenticated) {
        return { ok: false, status: 401, json: async () => ({ error: { code: "AUTH_REQUIRED", message: "Войдите в систему" } }) } as Response;
      }
      if (url.endsWith("/auth/login")) {
        authenticated = true;
        return { ok: true, status: 200, json: async () => authSession } as Response;
      }
      const payload = url.endsWith("/meta") ? meta : (url.endsWith("/dashboard") || url.includes("/dashboard?")) ? dashboard : { items: [] };
      return { ok: true, status: 200, json: async () => payload } as Response;
    }));

    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Вход в систему" })).toBeInTheDocument());
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("Производство, склад и финансы — в одной системе.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Электронная почта"), { target: { value: "admin@miracle-chem.local" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "MiracleChem#2026" } });
    fireEvent.click(screen.getByRole("button", { name: /^Войти$/u }));
    await waitFor(() => expect(screen.getByText("Произведено сегодня")).toBeInTheDocument());
  });

  it("loads the dashboard and keeps production modules visible", async () => {
    render(<App />);
    expect(screen.getByText("MIRACLE CHEM")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Проверка доступа" })).toBeInTheDocument();
    expect(screen.queryByText("Загрузка модуля…")).not.toBeInTheDocument();
    expect(screen.queryByText("Загружаем производственные данные…")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Произведено сегодня")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Выберите дату для данных CRM" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Дашборд" })).toBeInTheDocument();
    expect(screen.queryByText("Добрый день, производство")).not.toBeInTheDocument();
    expect(screen.getByText("Доход за день")).toBeInTheDocument();
    expect(screen.getAllByText("Дебиторская задолженность").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("ТОО Test Buyer")).toBeInTheDocument();
    expect(screen.getByText("Основные реагенты на складе")).toBeInTheDocument();
    expect(screen.getByText("Требуют внимания: 1 складская позиция")).toBeInTheDocument();
    expect(screen.getAllByText("После планов останется 400 кг").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("КТ-1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /Производство/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Склад/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Отгрузки/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Дислокация/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Расходы/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Бухгалтерия/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Клиенты/u })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).queryByRole("button", { name: "Данные 1С" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).queryByRole("button", { name: "Архив 1С" })).not.toBeInTheDocument();
  });

  it("applies the header's all-dates mode across the dashboard, transfers, finances and reports", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Дашборд" })).toBeInTheDocument());
    const allDates = screen.getByRole("button", { name: "Все даты" });
    fireEvent.click(allDates);
    expect(allDates).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByText("Произведено за всё время")).toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/dashboard?analytics=false&allDates=true"))).toBe(true);

    const navigation = within(screen.getByRole("navigation"));
    fireEvent.click(navigation.getByRole("button", { name: "Отгрузки" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Отгрузки" })).toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/transfers"))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/transfers/one-c-sales"))).toBe(true);

    fireEvent.click(navigation.getByRole("button", { name: "Расходы" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Расходы" })).toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/expenses?"))).toBe(true);

    fireEvent.click(navigation.getByRole("button", { name: "Бухгалтерия" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Бухгалтерия" })).toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/accounting?"))).toBe(true);

    fireEvent.click(navigation.getByRole("button", { name: "Отчёты" }));
    fireEvent.click(await screen.findByRole("button", { name: /Выпуск продукции/u }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/reports/production?from=1970-01-01"))).toBe(true));

    fireEvent.click(allDates);
    expect(allDates).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/reports/production?from=2026-") && !String(url).includes("from=1970"))).toBe(true));
  });

  it("opens read-only 1C source views and switches between permitted collections", async () => {
    window.location.hash = "one-c-source";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Данные 1С" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Склад 1С")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Договоры" }));
    expect(await screen.findByText("За выбранную дату записей нет. Выберите «Все даты» вверху страницы.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Все даты" }));
    await waitFor(() => expect(screen.getByText("Договор 1С")).toBeInTheDocument());
    expect(screen.queryByText("Склад 1С")).not.toBeInTheDocument();
    expect(screen.getByText(/Снимок:/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Редактировать/u })).not.toBeInTheDocument();
  });

  it("shows imported receipts in the common purchase journal without creating CRM purchase batches", async () => {
    window.location.hash = "materials";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Склад" })).toBeInTheDocument());
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/source/receipts"))).toBe(true));
    expect(screen.queryByRole("heading", { name: "Поступления из 1С" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Все даты" }));
    const journal = await screen.findByRole("heading", { name: "Поступления и закупки" });
    expect(journal).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск по поступлениям" }), { target: { value: "REC-1" } });
    expect(screen.getByText("№REC-1")).toBeInTheDocument();
    expect(screen.queryByText("Поступление · 1С")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("№REC-1"));
    expect(screen.getByText("1,234567 кг")).toBeInTheDocument();
    expect(screen.getAllByText("ТОО Поставщик 1С").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/тенге/u).length).toBeGreaterThan(0);
    expect(screen.getByText("Запись доступна только для просмотра.")).toBeInTheDocument();
    expect(screen.queryByText("Закупочных партий пока нет")).not.toBeInTheDocument();
  });

  it("shows 1C sales in transfers as accounting records, not as CRM dispatches", async () => {
    const originalFetch = vi.mocked(fetch);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/transfers/one-c-sales")) {
        return { ok: true, status: 200, json: async () => ({ items: url.includes("?date=") ? [] : [{
          id: "sale-1", number: "1C-SALE-001", status: "ISSUED", documentAt: "2026-09-15T07:00:00.000Z",
          counterparty: "ТОО Покупатель 1С", totalAmount: "3575000", currency: "KZT",
          items: [{ id: "line-1", description: "Добавка КТ-1", quantity: "500", unit: "кг" }],
          reconciliation: { state: "UNMATCHED", transfer: null },
        }], hasMore: false }) } as Response;
      }
      return originalFetch(input, init);
    }));
    window.location.hash = "transfers";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Журнал отгрузок" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Реализации из 1С" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Все даты" }));
    expect(await screen.findByText("1C-SALE-001")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск по отгрузкам" }), { target: { value: "Покупатель" } });
    expect(screen.getByText("1C-SALE-001")).toBeInTheDocument();
    expect(screen.queryByText("Реализация · 1С")).not.toBeInTheDocument();
    expect(screen.getByText("ТОО Покупатель 1С")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть документ" }));
    expect(window.location.hash).toBe("#accounting/sale-1");
  });

  it("shows imported shift reports in the common batches table with read-only details", async () => {
    window.location.hash = "batches";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Замесы" })).toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: "Все даты" }));
    expect(await screen.findByText("PROD-1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Выпуск по 1С" })).not.toBeInTheDocument();
    expect(screen.queryByText("Отчёт за смену · 1С")).not.toBeInTheDocument();
    expect(screen.getByText("Показано 1 из 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть отчёт PROD-1" }));
    const reportDialog = screen.getByRole("dialog", { name: "Отчёт за смену PROD-1" });
    expect(within(reportDialog).getByRole("heading", { name: "Продукция" })).toBeInTheDocument();
    expect(within(reportDialog).getByText("Добавка КТ-1")).toBeInTheDocument();
    expect(within(reportDialog).getByText("Количество")).toBeInTheDocument();
    expect(within(reportDialog).getByText("Запись доступна только для просмотра.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Начать замес/u })).not.toBeInTheDocument();
  });

  it("lists imported payments with accounting documents and keeps their details read-only", async () => {
    const originalFetch = vi.mocked(fetch);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/integrations/1c/finance")) return { ok: true, status: 200,
        json: async () => ({ available: true, snapshotAt: "2026-09-28T08:00:00Z", totalReceivables: "1200", totalPrepayments: "50",
          receivables: [{ counterparty: "Клиент", amount: "1200", currency: "KZT" }],
          incomingPayments: [{ externalId: "pay-1", number: "PAY-1", documentAt: "2026-09-27T06:00:00.000Z",
            counterparty: "Клиент", purpose: "За добавку", amount: "1000.25", currency: "тенге", posted: true, deleted: false }],
          outgoingPayments: [] }) } as Response;
      return originalFetch(input, init);
    }));
    window.location.hash = "accounting";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Бухгалтерия" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Данные из 1С" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Все даты" }));
    expect(await screen.findByText("PAY-1")).toBeInTheDocument();
    expect(screen.getByText("Журнал документов и платежей")).toBeInTheDocument();
    expect(screen.queryByText("Поступление · 1С")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть платёж PAY-1" }));
    const paymentDialog = screen.getByRole("dialog", { name: "Поступление №PAY-1" });
    expect(within(paymentDialog).getByText("За добавку")).toBeInTheDocument();
    expect(within(paymentDialog).getByText("Запись доступна только для просмотра.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Отметить оплату/u })).not.toBeInTheDocument();
  });

  it("does not request 1C financial receipts for a storekeeper", async () => {
    const originalFetch = vi.mocked(fetch);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/meta")) return { ok: true, status: 200,
        json: async () => ({ ...meta, actor: { ...meta.actor, role: "STOREKEEPER" } }) } as Response;
      return originalFetch(input, init);
    }));
    window.location.hash = "materials";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Склад" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Показать поступления из 1с" })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/source/receipts"))).toBe(false);
  });

  it("does not request 1C production reports for an operator", async () => {
    const originalFetch = vi.mocked(fetch);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/meta")) return { ok: true, status: 200,
        json: async () => ({ ...meta, actor: { ...meta.actor, role: "OPERATOR" } }) } as Response;
      return originalFetch(input, init);
    }));
    window.location.hash = "batches";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Замесы" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Показать выпуск по 1с" })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/source/production"))).toBe(false);
  });

  it("does not expose global 1C sales or finance to a manager", async () => {
    const originalFetch = vi.mocked(fetch);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/meta")) return { ok: true, status: 200,
        json: async () => ({ ...meta, actor: { ...meta.actor, role: "MANAGER" } }) } as Response;
      return originalFetch(input, init);
    }));
    window.location.hash = "transfers";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Отгрузки" })).toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/transfers/one-c-sales"))).toBe(false);
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Бухгалтерия" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Бухгалтерия" })).toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/integrations/1c/finance"))).toBe(false);
  });

  it("keeps the common journal usable when no confirmed source snapshot exists", async () => {
    const originalFetch = vi.mocked(fetch);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/source/receipts")) return { ok: true, status: 200,
        json: async () => ({ available: false }) } as Response;
      return originalFetch(input, init);
    }));
    window.location.hash = "materials";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Склад" })).toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: "Поступления и закупки" })).toBeInTheDocument();
    expect(screen.queryByText("Снимок 1С не получен")).not.toBeInTheDocument();
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

  it("shows the single production line and tank without redundant selectors", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Произведено сегодня")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Производство/u }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Замесы" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Запланировать замес" }));
    const dialog = await screen.findByRole("dialog", { name: "Новый производственный замес" });
    expect(within(dialog).getByText("Линия №1")).toBeInTheDocument();
    expect(within(dialog).getByText("Чан №1")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Производственная линия")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Производственный чан")).not.toBeInTheDocument();
  });

  it("shows the total sodium gluconate mass across differently priced lots", async () => {
    window.location.hash = "materials";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Склад" })).toBeInTheDocument());
    expect(screen.getByText("Общая масса глюконата")).toBeInTheDocument();
    expect(screen.getByText("3 000 кг")).toBeInTheDocument();
    expect(screen.getByText("2 партии · 2 цены")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Синхронизация 1С" })).not.toBeInTheDocument();
    expect(screen.queryByText("Нет записей на проверке")).not.toBeInTheDocument();
    expect(screen.queryByText(/Последний обмен:/u)).not.toBeInTheDocument();
  });

  it("shows 1C review actions only when there are pending records", async () => {
    const fallbackFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/integrations/1c/reviews")) {
        return { ok: true, status: 200, json: async () => ({ items: [{
          id: "review-1", entityType: "MATERIAL", externalId: "1c-material-1",
          payload: { name: "Реагент на проверке", code: "R-1" }, reason: "Нет соответствия",
          status: "PENDING", createdAt: "2026-09-28T08:00:00Z", resolutionNote: null,
        }] }) } as Response;
      }
      return fallbackFetch(input, init);
    }));
    window.location.hash = "materials";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Записи на проверке" })).toBeInTheDocument());
    expect(screen.getByText("Реагент на проверке")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Подтвердить" })).toBeInTheDocument();
  });

  it("shows a retry when the 1C review queue cannot be checked", async () => {
    const fallbackFetch = globalThis.fetch;
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/integrations/1c/reviews")) {
        attempts += 1;
        return attempts === 1
          ? { ok: false, status: 503, json: async () => ({ error: { message: "Сервис 1С недоступен" } }) } as Response
          : { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
      }
      return fallbackFetch(input, init);
    }));
    window.location.hash = "materials";
    render(<App />);
    await waitFor(() => expect(screen.getByText("Не удалось проверить записи: Сервис 1С недоступен")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.queryByText("Не удалось проверить записи: Сервис 1С недоступен")).not.toBeInTheDocument());
    expect(attempts).toBe(2);
  });

  it("shows additive formula percentages and opens an empty recipe form", async () => {
    window.location.hash = "formulas";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Калькулятор производства" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Расчёт добавки по проценту" })).toBeInTheDocument();
    expect(screen.getByText("1,2% от массы вяжущего")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Новая формула добавки" }));
    const dialog = await screen.findByRole("dialog", { name: "Новая формула добавки" });
    expect(within(dialog).getByText("Рецептура формулы")).toBeInTheDocument();
    expect(within(dialog).getByText("Сумма состава")).toBeInTheDocument();
    expect(within(dialog).getByText("0%")).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("Название готовой добавки")).toHaveValue("");
  });

  it("opens a customer and shows their concrete composition with the additive percentage", async () => {
    window.location.hash = "clients";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Клиенты" })).toBeInTheDocument());
    expect(screen.getByText("ТОО Алатау Бетон")).toBeInTheDocument();
    fireEvent.click(screen.getByText("ТОО Алатау Бетон"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "ТОО Алатау Бетон" })).toBeInTheDocument());
    expect(screen.getByText("Мостовой состав")).toBeInTheDocument();
    expect(screen.getByText("B35 П4 F300 W12")).toBeInTheDocument();
    expect(screen.getByText("4,8 кг")).toBeInTheDocument();
    expect(screen.getByText("Цемент М500")).toBeInTheDocument();
    expect(screen.getByText("Фактическая дозировка")).toBeInTheDocument();
    expect(screen.getAllByText("1,2%").length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Лента клиента" })).toBeInTheDocument());
    expect(screen.getByText("Отгрузка №OTG-001")).toBeInTheDocument();
    expect(screen.getByText("Текущая дебиторская задолженность")).toBeInTheDocument();
  });

  it("opens the dedicated goods receipt power of attorney form", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Произведено сегодня")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Бухгалтерия/u }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Бухгалтерия" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Доверенность" }));
    const dialog = await screen.findByRole("dialog", { name: "Новая доверенность на получение товара" });
    expect(within(dialog).getByText("Доверенное лицо")).toBeInTheDocument();
    expect(within(dialog).getByText("Товары к получению")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Срок действия доверенности")).toBeInTheDocument();
    expect(within(dialog).queryByText("НДС, %")).not.toBeInTheDocument();
  });

  it("shows Kaspi receipts as expense confirmations and opens them from the expense card", async () => {
    window.location.hash = "expenses";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Расходы" })).toBeInTheDocument());
    expect(screen.getByText("1 чек")).toBeInTheDocument();
    fireEvent.click(screen.getByText("RSH-20260828-KASPI"));
    const dialog = await screen.findByRole("dialog", { name: "RSH-20260828-KASPI" });
    expect(within(dialog).getByText("Чеки Kaspi")).toBeInTheDocument();
    const receiptLink = within(dialog).getByRole("link", { name: /kaspi-check\.pdf/u });
    expect(receiptLink).toHaveAttribute("href", expect.stringContaining("/expenses/expense-1/receipts/receipt-1/file"));
    expect(within(dialog).getByText(/Добавить чек/u)).toBeInTheDocument();
  });

  it("creates a new expense from an existing entry without copying its date or Kaspi receipts", async () => {
    window.location.hash = "expenses";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Расходы" })).toBeInTheDocument());
    fireEvent.click(screen.getByText("RSH-20260828-KASPI"));
    const detail = await screen.findByRole("dialog", { name: "RSH-20260828-KASPI" });
    fireEvent.click(within(detail).getByRole("button", { name: "Создать на основе" }));
    const duplicate = await screen.findByRole("dialog", { name: "Создать расход на основе RSH-20260828-KASPI" });
    expect(within(duplicate).getByLabelText("Назначение расхода")).toHaveValue("Доставка реагентов");
    expect(within(duplicate).getByLabelText("Номер счёта / акта")).toHaveValue("");
    expect(within(duplicate).queryByText("kaspi-check.pdf")).not.toBeInTheDocument();
  });

  it("opens reports and rows as dedicated pages", async () => {
    window.location.hash = "reports";
    render(<App />);

    await waitFor(() => expect(screen.getByText("Производственные отчёты")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Точность данных" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Выпуск продукции/u }));
    await waitFor(() => expect(window.location.hash).toBe("#reports/production"));
    await waitFor(() => expect(screen.getByText("ZM-TEST-1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("ZM-TEST-1"));
    await waitFor(() => expect(window.location.hash).toBe("#reports/production/0"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ZM-TEST-1", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Замес")).toBeInTheDocument();
    expect(screen.queryByText("Все поля выбранной строки показаны полностью на отдельной странице.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Все даты" }));
    await waitFor(() => expect(window.location.hash).toBe("#reports/production"));
    expect(await screen.findByText("ZM-TEST-1")).toBeInTheDocument();
  });

  it("opens the administrator-only 1C archive and its source records", async () => {
    window.location.hash = "one-c-archive";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Архив 1С" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Рабочие данные сверены")).toBeInTheDocument());
    expect(screen.getByText("наборов данных")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Номенклатура/u }));
    await waitFor(() => expect(screen.getByText("Тестовый реагент")).toBeInTheDocument());
  });
});
