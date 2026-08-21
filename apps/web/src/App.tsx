import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Beaker,
  Blocks,
  Boxes,
  ChevronRight,
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
  { id: "dashboard" as const, label: "Обзор", icon: LayoutDashboard, keywords: "главная сводка показатели" },
  { id: "batches" as const, label: "Производство", icon: Factory, keywords: "замес выпуск бетон" },
  { id: "materials" as const, label: "Склад", icon: Boxes, keywords: "материал позиция остаток приход расход" },
  { id: "recipes" as const, label: "Рецептуры", icon: Beaker, keywords: "рецепт состав технология" },
  { id: "formulas" as const, label: "Калькулятор", icon: FlaskConical, keywords: "формула расчёт себестоимость" },
  { id: "transfers" as const, label: "Отгрузки", icon: Truck, keywords: "отправка лрт документ" },
  { id: "wagons" as const, label: "Дислокация", icon: TrainFront, keywords: "вагон железная дорога местоположение" },
  { id: "expenses" as const, label: "Расходы", icon: WalletCards, keywords: "затраты деньги финансы" },
  { id: "reports" as const, label: "Отчёты", icon: BarChart3, keywords: "аналитика экспорт csv xlsx" },
];

export function App() {
  const [view, setView] = useState<ViewId>(() => readHash());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeNavRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase("ru") === "k") {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  useEffect(() => {
    if (window.innerWidth <= 680) {
      activeNavRef.current?.scrollIntoView?.({ behavior: "auto", block: "nearest", inline: "center" });
    }
  }, [view]);

  const searchResults = useMemo(() => {
    const normalized = searchQuery.trim().toLocaleLowerCase("ru");
    if (normalized === "") return NAVIGATION;
    return NAVIGATION.filter((item) => `${item.label} ${item.keywords}`.toLocaleLowerCase("ru").includes(normalized));
  }, [searchQuery]);

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
    setSearchOpen(false);
    setSearchQuery("");
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
        </div>

        <nav>
          <span className="nav-label">Рабочее пространство</span>
          {NAVIGATION.map((item) => (
            <button
              key={item.id}
              ref={view === item.id ? activeNavRef : undefined}
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
          <div className="profile-card">
            <span className="avatar">{initials(meta?.actor.name ?? "Admin")}</span>
            <span><strong>{meta?.actor.name ?? "Администратор"}</strong><small>{roleName(meta?.actor.role)}</small></span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div
            className={`search-box ${searchOpen ? "open" : ""}`}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
            }}
          >
            <Search size={17} />
            <input
              ref={searchInputRef}
              value={searchQuery}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchOpen}
              aria-controls="global-search-results"
              placeholder="Найти раздел CRM…"
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => { setSearchQuery(event.target.value); setSearchOpen(true); }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchOpen(false);
                  event.currentTarget.blur();
                }
                if (event.key === "Enter" && searchResults[0] !== undefined) navigate(searchResults[0].id);
              }}
            />
            <button type="button" className="search-shortcut" aria-label="Открыть поиск" onClick={() => { setSearchOpen(true); searchInputRef.current?.focus(); }}>⌘ K</button>
            {searchOpen ? (
              <div className="global-search-results" id="global-search-results" role="listbox" aria-label="Разделы CRM">
                {searchResults.length === 0 ? <span>Совпадений нет</span> : searchResults.map((item) => (
                  <button type="button" role="option" aria-selected={view === item.id} key={item.id} onClick={() => navigate(item.id)}>
                    <item.icon size={17} />
                    <span><strong>{item.label}</strong><small>{item.keywords.split(" ").slice(0, 3).join(" · ")}</small></span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
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
