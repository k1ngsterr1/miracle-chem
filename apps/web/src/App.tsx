import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Beaker,
  Blocks,
  Boxes,
  ChevronDown,
  ClipboardList,
  Factory,
  FlaskConical,
  LayoutDashboard,
  Search,
  TrainFront,
  Truck,
  WalletCards,
} from "lucide-react";
import { useApi } from "./hooks/use-api.js";
import type { MetaData } from "./types.js";
import { PageSkeleton } from "./components/ui.js";

function cachePageLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => {
    if (promise === undefined) {
      promise = load().catch((error: unknown) => {
        promise = undefined;
        throw error;
      });
    }
    return promise;
  };
}

const loadDashboardPage = cachePageLoader(() => import("./pages/DashboardPage.js").then((module) => ({ default: module.DashboardPage })));
const loadBatchesPage = cachePageLoader(() => import("./pages/BatchesPage.js").then((module) => ({ default: module.BatchesPage })));
const loadMaterialsPage = cachePageLoader(() => import("./pages/MaterialsPage.js").then((module) => ({ default: module.MaterialsPage })));
const loadRecipesPage = cachePageLoader(() => import("./pages/RecipesPage.js").then((module) => ({ default: module.RecipesPage })));
const loadFormulaPage = cachePageLoader(() => import("./pages/FormulaPage.js").then((module) => ({ default: module.FormulaPage })));
const loadTransfersPage = cachePageLoader(() => import("./pages/TransfersPage.js").then((module) => ({ default: module.TransfersPage })));
const loadWagonsPage = cachePageLoader(() => import("./pages/WagonsPage.js").then((module) => ({ default: module.WagonsPage })));
const loadExpensesPage = cachePageLoader(() => import("./pages/ExpensesPage.js").then((module) => ({ default: module.ExpensesPage })));
const loadReportsPage = cachePageLoader(() => import("./pages/ReportsPage.js").then((module) => ({ default: module.ReportsPage })));

const PAGE_LOADERS = [
  loadDashboardPage,
  loadBatchesPage,
  loadMaterialsPage,
  loadRecipesPage,
  loadFormulaPage,
  loadTransfersPage,
  loadWagonsPage,
  loadExpensesPage,
  loadReportsPage,
];

const DashboardPage = lazy(loadDashboardPage);
const BatchesPage = lazy(loadBatchesPage);
const MaterialsPage = lazy(loadMaterialsPage);
const RecipesPage = lazy(loadRecipesPage);
const FormulaPage = lazy(loadFormulaPage);
const TransfersPage = lazy(loadTransfersPage);
const WagonsPage = lazy(loadWagonsPage);
const ExpensesPage = lazy(loadExpensesPage);
const ReportsPage = lazy(loadReportsPage);

type ViewId = "dashboard" | "batches" | "materials" | "recipes" | "formulas" | "transfers" | "wagons" | "expenses" | "reports";

const NAVIGATION = [
  { id: "dashboard" as const, label: "Обзор", icon: LayoutDashboard },
  { id: "batches" as const, label: "Производство", icon: Factory },
  { id: "materials" as const, label: "Склад", icon: Boxes },
  { id: "recipes" as const, label: "Рецептуры", icon: Beaker },
  { id: "formulas" as const, label: "Калькулятор", icon: FlaskConical },
  { id: "transfers" as const, label: "Отгрузки", icon: Truck },
  { id: "wagons" as const, label: "Дислокация", icon: TrainFront },
  { id: "expenses" as const, label: "Расходы", icon: WalletCards },
  { id: "reports" as const, label: "Отчёты", icon: BarChart3 },
];

export function App() {
  const [view, setView] = useState<ViewId>(() => readHash());
  const { data: meta } = useApi<MetaData>("/meta");

  useEffect(() => {
    const onHashChange = () => setView(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const preloadTimer = window.setTimeout(() => {
      void Promise.allSettled(PAGE_LOADERS.map((loadPage) => loadPage()));
    }, 200);
    return () => window.clearTimeout(preloadTimer);
  }, []);

  const page = useMemo(() => {
    switch (view) {
      case "batches":
        return <BatchesPage meta={meta} />;
      case "materials":
        return <MaterialsPage />;
      case "recipes":
        return <RecipesPage />;
      case "formulas":
        return <FormulaPage />;
      case "transfers":
        return <TransfersPage meta={meta} />;
      case "wagons":
        return <WagonsPage />;
      case "expenses":
        return <ExpensesPage />;
      case "reports":
        return <ReportsPage />;
      case "dashboard":
        return <DashboardPage onNavigate={navigate} />;
    }
  }, [view, meta]);

  function navigate(target: ViewId): void {
    window.location.hash = target;
    setView(target);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("dashboard")}>
          <span className="brand-mark"><Blocks size={22} /></span>
          <span><strong>MIRACLE CHEM</strong><small>production control</small></span>
        </button>

        <div className="plant-select">
          <span className="plant-icon"><Factory size={16} /></span>
          <span><small>Площадка</small><strong>{meta?.workspace.name ?? "Загрузка…"}</strong></span>
          <ChevronDown size={15} />
        </div>

        <nav>
          <span className="nav-label">Рабочее пространство</span>
          {NAVIGATION.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} strokeWidth={1.9} />
              <span>{item.label}</span>
              {item.id === "batches" ? <em>2</em> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="system-status"><span /><div><strong>Система в норме</strong><small>API и база доступны</small></div></div>
          <div className="profile-card">
            <span className="avatar">{initials(meta?.actor.name ?? "Admin")}</span>
            <span><strong>{meta?.actor.name ?? "Администратор"}</strong><small>{roleName(meta?.actor.role)}</small></span>
            <ChevronDown size={15} />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="search-box"><Search size={17} /><input placeholder="Найти замес, складскую позицию, вагон или расход…" /><kbd>⌘ K</kbd></div>
          <div className="topbar-meta">
            <span className="shift-pill"><ClipboardList size={15} /> Смена №2 · 08:00–20:00</span>
            <span className="live-pill"><i /> Онлайн</span>
          </div>
        </header>
        <div className="page-content">
          <Suspense fallback={<PageSkeleton />}>
            {page}
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function readHash(): ViewId {
  const hash = window.location.hash.replace("#", "") as ViewId;
  return NAVIGATION.some((item) => item.id === hash) ? hash : "dashboard";
}

function initials(name: string): string {
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function roleName(role?: string): string {
  const labels: Record<string, string> = {
    ADMIN: "Администратор",
    TECHNOLOGIST: "Технолог",
    OPERATOR: "Оператор",
    STOREKEEPER: "Кладовщик",
    QUALITY_MANAGER: "Контроль качества",
    LRT_RECEIVER: "Приёмщик ЛРТ",
  };
  return role === undefined ? "" : labels[role] ?? role;
}
