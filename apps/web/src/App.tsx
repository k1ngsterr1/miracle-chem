import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Beaker,
  Blocks,
  Boxes,
  ChevronRight,
  Database,
  Factory,
  FlaskConical,
  LayoutDashboard,
  Landmark,
  LogOut,
  Menu,
  Search,
  Settings2,
  TrainFront,
  Truck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { useApi } from "./hooks/use-api.js";
import { apiFetch, apiMutation } from "./api.js";
import type { AuthSession, MetaData } from "./types.js";
import { Modal, PageSkeleton } from "./components/ui.js";
import { DateTimePicker } from "./components/DateTimePicker.js";
import { DateFilterProvider, todayDate, useDateFilter } from "./hooks/use-date-filter.js";
import { LoginPage } from "./pages/LoginPage.js";

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
const loadAccountingPage = cachePageLoader(() => import("./pages/AccountingPage.js").then((module) => ({ default: module.AccountingPage })));
const loadClientsPage = cachePageLoader(() => import("./pages/ClientsPage.js").then((module) => ({ default: module.ClientsPage })));
const loadReportsPage = cachePageLoader(() => import("./pages/ReportsPage.js").then((module) => ({ default: module.ReportsPage })));
const loadSettingsPage = cachePageLoader(() => import("./pages/SettingsPage.js").then((module) => ({ default: module.SettingsPage })));
const loadOneCArchivePage = cachePageLoader(() => import("./pages/OneCArchivePage.js").then((module) => ({ default: module.OneCArchivePage })));
const loadOneCSourcePage = cachePageLoader(() => import("./pages/OneCSourcePage.js").then((module) => ({ default: module.OneCSourcePage })));

const DashboardPage = lazy(loadDashboardPage);
const BatchesPage = lazy(loadBatchesPage);
const MaterialsPage = lazy(loadMaterialsPage);
const RecipesPage = lazy(loadRecipesPage);
const FormulaPage = lazy(loadFormulaPage);
const TransfersPage = lazy(loadTransfersPage);
const WagonsPage = lazy(loadWagonsPage);
const ExpensesPage = lazy(loadExpensesPage);
const AccountingPage = lazy(loadAccountingPage);
const ClientsPage = lazy(loadClientsPage);
const ReportsPage = lazy(loadReportsPage);
const SettingsPage = lazy(loadSettingsPage);
const OneCArchivePage = lazy(loadOneCArchivePage);
const OneCSourcePage = lazy(loadOneCSourcePage);

type ViewId = "dashboard" | "batches" | "materials" | "recipes" | "formulas" | "transfers" | "wagons" | "expenses" | "accounting" | "clients" | "reports" | "settings" | "one-c-source" | "one-c-archive";

interface NavigationItem {
  id: ViewId;
  label: string;
  icon: typeof LayoutDashboard;
  keywords: string;
  roles?: string[];
}

const NAVIGATION: NavigationItem[] = [
  { id: "dashboard" as const, label: "Обзор", icon: LayoutDashboard, keywords: "главная сводка показатели" },
  { id: "batches" as const, label: "Производство", icon: Factory, keywords: "замес выпуск бетон", roles: ["ADMIN", "DIRECTOR", "TECHNOLOGIST", "OPERATOR", "QUALITY_MANAGER"] },
  { id: "materials" as const, label: "Склад", icon: Boxes, keywords: "материал позиция остаток приход расход", roles: ["ADMIN", "DIRECTOR", "TECHNOLOGIST", "OPERATOR", "STOREKEEPER"] },
  { id: "recipes" as const, label: "Рецептуры", icon: Beaker, keywords: "рецепт состав технология", roles: ["ADMIN", "DIRECTOR", "TECHNOLOGIST"] },
  { id: "formulas" as const, label: "Калькулятор", icon: FlaskConical, keywords: "формула расчёт себестоимость", roles: ["ADMIN", "DIRECTOR", "TECHNOLOGIST"] },
  { id: "transfers" as const, label: "Отгрузки", icon: Truck, keywords: "отправка клиент документ", roles: ["ADMIN", "DIRECTOR", "MANAGER", "STOREKEEPER", "LRT_RECEIVER"] },
  { id: "wagons" as const, label: "Дислокация", icon: TrainFront, keywords: "вагон железная дорога местоположение", roles: ["ADMIN", "DIRECTOR", "STOREKEEPER", "LRT_RECEIVER"] },
  { id: "expenses" as const, label: "Расходы", icon: WalletCards, keywords: "затраты деньги финансы", roles: ["ADMIN", "DIRECTOR", "ACCOUNTANT"] },
  { id: "accounting" as const, label: "Бухгалтерия", icon: Landmark, keywords: "накладная счет оплата акт документы", roles: ["ADMIN", "DIRECTOR", "ACCOUNTANT", "MANAGER"] },
  { id: "clients" as const, label: "Клиенты", icon: UsersRound, keywords: "заказчик покупатель бетон состав дозировка добавка", roles: ["ADMIN", "DIRECTOR", "ACCOUNTANT", "MANAGER", "TECHNOLOGIST", "VIEWER"] },
  { id: "reports" as const, label: "Отчёты", icon: BarChart3, keywords: "аналитика экспорт csv xlsx", roles: ["ADMIN", "DIRECTOR", "ACCOUNTANT", "TECHNOLOGIST", "QUALITY_MANAGER", "VIEWER"] },
  { id: "settings" as const, label: "Команда и реквизиты", icon: Settings2, keywords: "сотрудники роли доступ реквизиты компания банк", roles: ["ADMIN", "DIRECTOR"] },
  { id: "one-c-source" as const, label: "Данные 1С", icon: Database, keywords: "1с склады поступления договоры спецификации выпуск", roles: ["ADMIN", "DIRECTOR", "ACCOUNTANT", "TECHNOLOGIST", "OPERATOR", "STOREKEEPER"] },
  { id: "one-c-archive" as const, label: "Архив 1С", icon: Database, keywords: "1с исходные данные база справочники документы регистры", roles: ["ADMIN"] },
];

export function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    void apiFetch<AuthSession>("/auth/session")
      .then((current) => { if (active) setSession(current); })
      .catch(() => { if (active) setSession(null); })
      .finally(() => { if (active) setCheckingSession(false); });
    const unauthorized = () => setSession(null);
    window.addEventListener("miracle-chem:unauthorized", unauthorized);
    return () => {
      active = false;
      window.removeEventListener("miracle-chem:unauthorized", unauthorized);
    };
  }, []);

  if (checkingSession) return <div className="auth-loading" role="status" aria-label="Проверка доступа"><span className="brand-mark"><Blocks size={22} /></span><strong>MIRACLE CHEM</strong></div>;
  if (session === null) return <LoginPage onAuthenticated={setSession} />;

  return <DateFilterProvider><AuthenticatedApp onLogout={() => setSession(null)} /></DateFilterProvider>;
}

function AuthenticatedApp({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<ViewId>(() => readHash());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeNavRef = useRef<HTMLButtonElement>(null);
  const { data: meta } = useApi<MetaData>("/meta");
  const { selectedDate, allDates, setSelectedDate, setAllDates, resetToToday } = useDateFilter();
  const selectedDateIsToday = selectedDate === todayDate();
  const actorRole = meta?.actor.role;
  const visibleNavigation = useMemo(
    () => NAVIGATION.filter((item) => item.roles === undefined || (actorRole !== undefined && item.roles.includes(actorRole))),
    [actorRole],
  );
  const currentView = visibleNavigation.some((item) => item.id === view) ? view : "dashboard";

  useEffect(() => {
    const onHashChange = () => setView(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
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
    } else if (window.innerWidth > 980) {
      activeNavRef.current?.scrollIntoView?.({ behavior: "auto", block: "nearest", inline: "nearest" });
    }
  }, [currentView]);

  const searchResults = useMemo(() => {
    const normalized = searchQuery.trim().toLocaleLowerCase("ru");
    if (normalized === "") return visibleNavigation;
    return visibleNavigation.filter((item) => `${item.label} ${item.keywords}`.toLocaleLowerCase("ru").includes(normalized));
  }, [searchQuery, visibleNavigation]);

  const page = useMemo(() => {
    switch (currentView) {
      case "batches":
        return <BatchesPage meta={meta} actorRole={actorRole} />;
      case "materials":
        return <MaterialsPage actorRole={actorRole} />;
      case "recipes":
        return <RecipesPage />;
      case "formulas":
        return <FormulaPage />;
      case "transfers":
        return <TransfersPage meta={meta} actorRole={actorRole} />;
      case "wagons":
        return <WagonsPage />;
      case "expenses":
        return <ExpensesPage />;
      case "accounting":
        return <AccountingPage actorRole={actorRole} />;
      case "clients":
        return <ClientsPage actorRole={actorRole} />;
      case "reports":
        return <ReportsPage />;
      case "settings":
        return <SettingsPage actorRole={actorRole} />;
      case "one-c-archive":
        return <OneCArchivePage />;
      case "one-c-source":
        return <OneCSourcePage actorRole={actorRole} />;
      case "dashboard":
        return <DashboardPage onNavigate={navigate} />;
    }
  }, [currentView, meta, actorRole]);

  function navigate(target: ViewId): void {
    window.location.hash = target;
    setView(target);
    setSearchOpen(false);
    setSearchQuery("");
  }

  async function logout(): Promise<void> {
    try {
      await apiMutation<void>("/auth/logout", {});
    } finally {
      onLogout();
    }
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
          {visibleNavigation.map((item) => (
            <button
              key={item.id}
              ref={currentView === item.id ? activeNavRef : undefined}
              className={currentView === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} strokeWidth={1.9} />
              <span>{item.label}</span>
              {item.id === "batches" ? <em>2</em> : null}
            </button>
          ))}
          <button type="button" className="mobile-navigation-more" aria-label="Открыть все разделы" onClick={() => setMobileNavigationOpen(true)}>
            <Menu size={18} strokeWidth={1.9} />
            <span>Ещё</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="profile-card">
            <span className="avatar">{initials(meta?.actor.name ?? "Admin")}</span>
            <span><strong>{meta?.actor.name ?? "Администратор"}</strong><small>{roleName(meta?.actor.role)}</small></span>
            <button type="button" className="profile-logout" aria-label="Выйти из системы" title="Выйти" onClick={() => void logout()}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-inner">
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
            <div className={`global-date-filter${allDates ? " all-dates" : ""}`}>
              <div className="global-date-copy"><small>Период</small></div>
              <button type="button" className="global-date-all" aria-pressed={allDates} onClick={() => setAllDates(!allDates)}>Все даты</button>
              <DateTimePicker compact mode="date" ariaLabel="Выберите дату для данных CRM" value={selectedDate} onChange={setSelectedDate} align="right" />
              {selectedDateIsToday && !allDates ? null : <button type="button" className="global-date-reset" onClick={resetToToday}>Сегодня</button>}
            </div>
          </div>
        </header>
        <div className="page-content">
          <Suspense fallback={<PageSkeleton />}>
            {page}
          </Suspense>
        </div>
      </main>
      {mobileNavigationOpen ? (
        <Modal title="Разделы CRM" onClose={() => setMobileNavigationOpen(false)}>
          <div className="mobile-navigation-menu">
            {visibleNavigation.map((item) => (
              <button type="button" className={currentView === item.id ? "active" : ""} key={item.id} onClick={() => { navigate(item.id); setMobileNavigationOpen(false); }}>
                <item.icon size={18} />
                <span>{item.label}</span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function readHash(): ViewId {
  const hash = window.location.hash.replace(/^#/u, "").split("/")[0] as ViewId;
  return NAVIGATION.some((item) => item.id === hash) ? hash : "dashboard";
}

function initials(name: string): string {
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function roleName(role?: string): string {
  const labels: Record<string, string> = {
    ADMIN: "Администратор",
    DIRECTOR: "Руководитель",
    MANAGER: "Менеджер",
    ACCOUNTANT: "Бухгалтер",
    TECHNOLOGIST: "Технолог",
    OPERATOR: "Оператор",
    STOREKEEPER: "Кладовщик",
    QUALITY_MANAGER: "Контроль качества",
    LRT_RECEIVER: "Менеджер отгрузок",
  };
  return role === undefined ? "" : labels[role] ?? role;
}
