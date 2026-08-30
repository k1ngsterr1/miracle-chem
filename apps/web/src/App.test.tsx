import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const meta = {
  workspace: { id: "w", name: "Miracle Chem Plant", timezone: "Asia/Almaty", currency: "KZT" },
  actor: { id: "u", name: "Алишер Махмутов", role: "ADMIN" },
  users: [],
  productionLines: [{ id: "line-1", code: "LINE-01", name: "Линия №1", capacity: "0", capacityUnit: "M3" }],
  productionTanks: [{ id: "tank-1", code: "TANK-01", name: "Чан №1", capacity: null, capacityUnit: "M3", productionLineId: "line-1", productionLine: { id: "line-1", code: "LINE-01", name: "Линия №1" } }],
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
