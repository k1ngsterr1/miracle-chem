import { useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  ChevronRight,
  Boxes,
  CircleGauge,
  Factory,
  FlaskConical,
  Landmark,
  PackageCheck,
  TrendingDown,
  Truck,
  WalletCards,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../hooks/use-api.js";
import { useDateFilter } from "../hooks/use-date-filter.js";
import { useMobileLayout } from "../hooks/use-mobile-layout.js";
import type { Batch, DashboardData } from "../types.js";
import { formatDate, formatMetric, formatMoney, formatNumber, unitLabel } from "../lib/format.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  PanelHeader,
  ProgressBar,
  StatusBadge,
} from "../components/ui.js";

export function DashboardPage({ onNavigate }: { onNavigate: (target: "batches" | "materials" | "transfers" | "expenses" | "accounting") => void }) {
  const { selectedDate } = useDateFilter();
  const dashboard = useApi<DashboardData>("/dashboard");
  const batches = useApi<{ items: Batch[] }>("/batches");
  const compactDashboard = useMobileLayout();
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  if (dashboard.loading || batches.loading) return <LoadingState />;
  if (dashboard.error !== null) return <ErrorState message={dashboard.error} retry={dashboard.reload} />;
  if (dashboard.data === null) return null;
  const data = dashboard.data;
  const stockWarnings = data.stockWarnings ?? [];
  const missingReagents = (data.mainReagents ?? []).filter((reagent) => reagent.missing);
  const stockAlertCount = stockWarnings.length + missingReagents.length;
  const analytics = data.analytics ?? { productionByLine: [], batchStatuses: [], expenseTrend: [] };
  const active = batches.data?.items.filter((batch) => ["PLANNED", "PREPARATION", "IN_PROGRESS"].includes(batch.status)) ?? [];
  const trend = data.productionTrend.map((point) => ({
    ...point,
    produced: Number(point.produced),
    sent: Number(point.sent),
    loss: Number(point.loss),
    label: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${point.date}T12:00:00`)),
  }));
  const lineStats = analytics.productionByLine.map((point) => ({ ...point, produced: Number(point.produced), loss: Number(point.loss) }));
  const statusStats = analytics.batchStatuses.map((point) => ({ ...point, label: BATCH_STATUS_LABELS[point.status] ?? point.status }));
  const expenseTrend = analytics.expenseTrend
    .filter((point) => point.currency === data.metrics.operatingExpenses[0]?.currency || point.currency === "KZT")
    .map((point) => ({ ...point, amount: Number(point.amount), label: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${point.date}T12:00:00`)) }));

  return (
    <>
      <div className="dashboard-heading">
        <div><span className="eyebrow">Оперативная сводка</span><h1>Добрый день, производство</h1><p>{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${selectedDate}T12:00:00`))} · данные за выбранную дату</p></div>
        <button className="button primary" onClick={() => onNavigate("batches")}><Factory size={17} /> Новый замес</button>
      </div>

      {stockAlertCount > 0 ? (
        <section className={`stock-warning-banner ${missingReagents.length > 0 || stockWarnings.some((warning) => ["OUT_OF_STOCK", "SHORTAGE"].includes(warning.level)) ? "critical" : "low"}`}>
          <span className="stock-warning-banner-icon"><AlertTriangle size={20} /></span>
          <div className="stock-warning-banner-copy">
            <strong>Требуют внимания: {stockPositionLabel(stockAlertCount)}</strong>
            <p>Свободного остатка недостаточно либо после ближайших замесов он опустится ниже установленного минимума.</p>
          </div>
          <div className="stock-warning-banner-items">
            {stockWarnings.slice(0, 3).map((warning) => <span key={warning.id}><b>{warning.name}</b><small>{stockWarningSummary(warning)}</small></span>)}
            {missingReagents.slice(0, Math.max(0, 3 - stockWarnings.length)).map((reagent) => <span key={reagent.code}><b>{reagent.name}</b><small>Позиция отсутствует на складе</small></span>)}
            {stockAlertCount > 3 ? <em>+{stockAlertCount - 3}</em> : null}
          </div>
          <button type="button" className="button ghost" onClick={() => onNavigate("materials")}>Проверить склад <ChevronRight size={15} /></button>
        </section>
      ) : null}

      <div className="kpi-grid">
        <Kpi icon={<FlaskConical />} label="Расход сырья сегодня" value={formatMetric(data.metrics.consumedMaterials)} hint="фактическое списание" tone="lime" />
        <Kpi icon={<PackageCheck />} label="Произведено сегодня" value={formatMetric(data.metrics.produced)} hint="готового продукта" tone="blue" />
        <Kpi icon={<Truck />} label="Отгружено" value={formatMetric(data.metrics.sentToLrt)} hint="подтверждённые отправки" tone="violet" />
        <Kpi icon={<Boxes />} label="Доступный остаток" value={formatMetric(data.metrics.availableProduct)} hint="по всем партиям" tone="amber" />
        <Kpi icon={<CircleGauge />} label="Активные замесы" value={String(data.metrics.activeBatches)} hint={`${active.filter((batch) => batch.status === "IN_PROGRESS").length} сейчас в работе`} tone="green" />
        <Kpi icon={<TrendingDown />} label="Потери за день" value={`${data.metrics.lossPercent}%`} hint="от общего выпуска" tone="red" warning={Number(data.metrics.lossPercent) > 2} />
        <Kpi icon={<BadgeDollarSign />} label="Доход за день" value={formatExpenseTotals(data.metrics.dailyRevenue ?? [])} hint="по выставленным и оплаченным счетам" tone="green" />
        <Kpi icon={<Landmark />} label="Дебиторская задолженность" value={formatExpenseTotals(data.metrics.accountsReceivable ?? [])} hint={`${(data.receivables ?? []).reduce((sum, item) => sum + item.invoiceCount, 0)} неоплаченных счетов`} tone="amber" badge="текущая" />
      </div>

      <Panel className="receivables-panel">
        <PanelHeader
          title="Дебиторская задолженность"
          description="Сколько отгружено и выставлено клиентам, но ещё не оплачено"
          action={<button className="text-button" onClick={() => onNavigate("accounting")}>Открыть бухгалтерию <ChevronRight size={15} /></button>}
        />
        {(data.receivables ?? []).length === 0 ? (
          <EmptyState title="Задолженности нет" text="Все выставленные клиентам счета оплачены." />
        ) : (
          <div className="receivables-list">
            {data.receivables.map((item) => {
              const overdue = Number(item.overdueAmount) > 0;
              return (
                <button type="button" key={`${item.counterpartyTaxId ?? item.counterparty}-${item.currency}`} onClick={() => onNavigate("accounting")}>
                  <span className="receivable-avatar">{counterpartyInitials(item.counterparty)}</span>
                  <span className="receivable-client"><strong>{item.counterparty}</strong><small>{item.counterpartyTaxId === null ? "БИН не указан" : `БИН ${item.counterpartyTaxId}`}</small></span>
                  <span className="receivable-meta"><small>Неоплаченные счета</small><strong>{item.invoiceCount}</strong></span>
                  <span className="receivable-meta"><small>Последний документ</small><strong>{formatDate(item.lastDocumentAt)}</strong></span>
                  <span className="receivable-amount"><small>Отгружено / к оплате</small><strong>{formatMoney(item.amount, item.currency)}</strong>{overdue ? <em>Просрочено {formatMoney(item.overdueAmount, item.currency)}</em> : <em>{item.nearestDueAt === null ? "Срок не указан" : "В пределах срока"}</em>}</span>
                  <ChevronRight size={17} />
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel className="main-reagents-panel">
        <PanelHeader title="Основные реагенты на складе" description="Текущий и свободный остаток по ключевым компонентам" action={<button className="text-button" onClick={() => onNavigate("materials")}>Открыть склад <ChevronRight size={15} /></button>} />
        <div className="main-reagents-grid">
          {(data.mainReagents ?? []).map((reagent) => {
            const current = Number(reagent.currentStock);
            const minimum = Number(reagent.minimumStock);
            const level = minimum <= 0 ? (current > 0 ? 100 : 0) : Math.min(100, current / (minimum * 2) * 100);
            return (
              <button type="button" className={`main-reagent-card ${reagent.isCritical ? "critical" : ""} ${reagent.missing ? "missing" : ""}`} key={reagent.code} onClick={() => onNavigate("materials")}>
                <span className="main-reagent-icon"><FlaskConical size={17} /></span>
                <span className="main-reagent-status">{mainReagentStatus(reagent)}</span>
                <strong>{reagent.name}</strong>
                <small>{reagent.code}</small>
                {reagent.missing ? <em>Добавьте позицию на склад</em> : (
                  <>
                    <b>{formatNumber(reagent.currentStock)} {unitLabel[reagent.baseUnit]}</b>
                    <span className="main-reagent-balance"><span>Свободно {formatNumber(reagent.freeStock)}</span><span>Резерв {formatNumber(reagent.reservedStock)}</span></span>
                    <ProgressBar value={level} tone={reagent.isCritical ? "red" : level < 55 ? "amber" : "lime"} />
                    <em>{Number(reagent.plannedDemand) > 0 ? `После планов ${formatNumber(reagent.projectedStock)} ${unitLabel[reagent.baseUnit]}` : `Минимум ${formatNumber(reagent.minimumStock)} ${unitLabel[reagent.baseUnit]}`}</em>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="dashboard-grid">
        <Panel className="chart-panel">
          <PanelHeader title="Динамика производства" description="Выпуск, отгрузка и потери за последние 7 дней" action={<div className="chart-legend"><span className="produced">Выпуск</span><span className="sent">Отгрузка</span></div>} />
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="producedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b9f24d" stopOpacity={0.28} /><stop offset="100%" stopColor="#b9f24d" stopOpacity={0} /></linearGradient>
                  <linearGradient id="sentFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8da2fb" stopOpacity={0.18} /><stop offset="100%" stopColor="#8da2fb" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e5e8df" strokeDasharray="3 5" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#7d8375", fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ba092", fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e0e4d8", boxShadow: "0 12px 32px rgba(24,29,17,.12)" }} />
                <Area type="monotone" dataKey="produced" name="Создано" stroke="#7daa27" strokeWidth={2.5} fill="url(#producedFill)" />
                <Area type="monotone" dataKey="sent" name="Отправлено" stroke="#6375ca" strokeWidth={2} fill="url(#sentFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="balance-panel">
          <PanelHeader title="Баланс смены" description="Готовый продукт · м³" />
          <div className="balance-ring" style={{ "--progress": "78%" } as React.CSSProperties}>
            <div><strong>{formatMetric(data.metrics.availableProduct).replace(" м³", "")}</strong><span>доступно</span></div>
          </div>
          <div className="balance-lines">
            <div><span>Произведено</span><strong>{formatMetric(data.metrics.produced)}</strong></div>
            <div><span>Отгружено</span><strong>{formatMetric(data.metrics.sentToLrt)}</strong></div>
            <div><span>Стоимость выпуска</span><strong>{formatMoney(data.metrics.productionCost)}</strong></div>
            <div><span>Операционные расходы</span><strong>{formatExpenseTotals(data.metrics.operatingExpenses)}</strong></div>
          </div>
          <button className="text-button" onClick={() => onNavigate("expenses")}>Открыть расходы <ChevronRight size={15} /></button>
        </Panel>
      </div>

      {compactDashboard && !showMobileDetails ? <Panel className="dashboard-mobile-disclosure"><div><strong>Аналитика и очередь</strong><span>Графики, текущие замесы и контроль рисков</span></div><button className="button ghost" onClick={() => setShowMobileDetails(true)}>Показать <ChevronRight size={15} /></button></Panel> : <>
      <div className="dashboard-analytics-grid">
        <Panel className="mini-chart-panel">
          <PanelHeader title="Выпуск по линиям" description="Объём и потери за 30 дней" />
          <div className="mini-chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={lineStats} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e5e8df" strokeDasharray="3 5" /><XAxis dataKey="line" axisLine={false} tickLine={false} tick={{ fill: "#7d8375", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ba092", fontSize: 10 }} /><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e0e4d8" }} /><Bar dataKey="produced" name="Выпуск" fill="#91bb36" radius={[6, 6, 0, 0]} /><Bar dataKey="loss" name="Потери" fill="#e7a28f" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Panel>
        <Panel className="mini-chart-panel">
          <PanelHeader title="Статусы замесов" description="Структура документов за 30 дней" />
          <div className="mini-chart-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusStats} dataKey="count" nameKey="label" innerRadius={45} outerRadius={76} paddingAngle={3}>{statusStats.map((point, index) => <Cell key={point.status} fill={CHART_COLORS[index % CHART_COLORS.length] ?? "#91bb36"} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e0e4d8" }} /></PieChart></ResponsiveContainer></div>
          <div className="mini-chart-legend">{statusStats.slice(0, 5).map((point, index) => <span key={point.status}><i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />{point.label} <strong>{point.count}</strong></span>)}</div>
        </Panel>
        <Panel className="mini-chart-panel">
          <PanelHeader title="Динамика расходов" description="Операционные затраты за 7 дней" action={<WalletCards size={17} />} />
          <div className="mini-chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={expenseTrend} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e5e8df" strokeDasharray="3 5" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#7d8375", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ba092", fontSize: 10 }} /><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e0e4d8" }} /><Bar dataKey="amount" name="Расходы" fill="#6375ca" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Panel>
      </div>

      <div className="dashboard-lower-grid">
        <Panel>
          <PanelHeader title="Текущая очередь" description="Ближайшие и активные производственные замесы" action={<button className="text-button" onClick={() => onNavigate("batches")}>Все замесы <ChevronRight size={15} /></button>} />
          <div className="batch-cards">
            {active.slice(0, 4).map((batch) => (
              <article className="batch-mini-card" key={batch.id}>
                <div className="batch-time"><strong>{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(batch.scheduledAt))}</strong><span>{formatDate(batch.scheduledAt)}</span></div>
                <div className="batch-main"><div><strong>{batch.number}</strong><StatusBadge status={batch.status} /></div><p>{batch.concreteGrade} · {batch.recipeVersion.recipe.name}</p><div className="batch-meta"><span>{batch.productionLine.name}</span><span>{batch.productionTank?.name ?? "Чан не указан"}</span><span>{formatNumber(batch.plannedVolume)} {unitLabel[batch.plannedVolumeUnit]}</span><span>{batch.operator.name}</span></div></div>
                <div className="batch-progress"><span>{batch.status === "IN_PROGRESS" ? "62%" : "Ожидает"}</span><ProgressBar value={batch.status === "IN_PROGRESS" ? 62 : 8} /></div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Контроль и риски" description="Отклонения и критические остатки" />
          {stockWarnings.length === 0 && missingReagents.length === 0 && data.deviations.length === 0 ? (
            <EmptyState title="Отклонений нет" text="Все остатки и дозировки находятся в допустимых пределах." />
          ) : (
            <div className="risk-list">
              {stockWarnings.map((warning) => (
                <button key={warning.id} onClick={() => onNavigate("materials")}><span className={`risk-icon ${["OUT_OF_STOCK", "SHORTAGE"].includes(warning.level) ? "red" : ""}`}><AlertTriangle size={17} /></span><span><strong>{warning.name}</strong><small>{stockWarningSummary(warning)}</small></span><ChevronRight size={15} /></button>
              ))}
              {missingReagents.map((reagent) => (
                <button key={reagent.code} onClick={() => onNavigate("materials")}><span className="risk-icon red"><AlertTriangle size={17} /></span><span><strong>{reagent.name}</strong><small>Реагент отсутствует на складе</small></span><ChevronRight size={15} /></button>
              ))}
              {data.deviations.map((component) => (
                <button key={component.id} onClick={() => onNavigate("batches")}><span className="risk-icon red"><CircleGauge size={17} /></span><span><strong>{component.materialNameSnapshot}</strong><small>Отклонение {formatNumber(component.deviationPercent)}%</small></span><ChevronRight size={15} /></button>
              ))}
            </div>
          )}
        </Panel>
      </div>
      </>}
    </>
  );
}

const CHART_COLORS = ["#91bb36", "#6375ca", "#d39b45", "#55a06a", "#d97161", "#8a6fc2"];
const BATCH_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Запланировано",
  PREPARATION: "Подготовка",
  IN_PROGRESS: "В работе",
  COMPLETED: "Завершено",
  PARTIALLY_TRANSFERRED: "Частично отгружено",
  FULLY_TRANSFERRED: "Отгружено",
  CANCELLED: "Отменено",
  REJECTED: "Брак",
};

function formatExpenseTotals(values: Array<{ amount: string; currency: string }>): string {
  if (values.length === 0) return formatMoney(0);
  return values.map((value) => formatMoney(value.amount, value.currency)).join(" · ");
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
  warning = false,
  badge = "сегодня",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: string;
  warning?: boolean;
  badge?: string;
}) {
  return (
    <article className={`kpi-card ${tone} ${warning ? "warning" : ""}`}>
      <div className="kpi-top"><span className="kpi-icon">{icon}</span>{warning ? <span className="warning-label">выше нормы</span> : <span className="delta">{badge}</span>}</div>
      <p>{label}</p><strong>{value}</strong><small>{hint}</small>
    </article>
  );
}

function counterpartyInitials(name: string): string {
  return name.replace(/[«»"']/g, "").split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU");
}

function mainReagentStatus(reagent: DashboardData["mainReagents"][number]): string {
  if (reagent.missing) return "Нет позиции";
  if (reagent.warningLevel === null || reagent.warningLevel === undefined) return reagent.isCritical ? "Ниже минимума" : "В норме";
  return ({
    OUT_OF_STOCK: "Нет свободного остатка",
    SHORTAGE: "Не хватит на планы",
    CRITICAL: "Ниже минимума",
    LOW_AFTER_PLAN: "Снизится после планов",
    MISSING: "Нет позиции",
  } as const)[reagent.warningLevel];
}

function stockWarningSummary(warning: NonNullable<DashboardData["stockWarnings"]>[number]): string {
  if (warning.level === "OUT_OF_STOCK") return `Свободный остаток ${formatNumber(warning.freeStock)} ${unitLabel[warning.baseUnit]}`;
  if (warning.level === "SHORTAGE") return `Дефицит ${formatNumber(warning.shortfall)} ${unitLabel[warning.baseUnit]} под ${warning.affectedBatches.length} план.`;
  if (warning.level === "CRITICAL") return `Свободно ${formatNumber(warning.freeStock)} ${unitLabel[warning.baseUnit]} · ниже минимума`;
  return `После планов останется ${formatNumber(warning.projectedStock)} ${unitLabel[warning.baseUnit]}`;
}

function stockPositionLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return `${count} складская позиция`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} складские позиции`;
  return `${count} складских позиций`;
}
