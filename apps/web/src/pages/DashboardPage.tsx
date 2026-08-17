import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CircleGauge,
  Factory,
  FlaskConical,
  PackageCheck,
  TrendingDown,
  Truck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../hooks/use-api.js";
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

export function DashboardPage({ onNavigate }: { onNavigate: (target: "batches" | "materials" | "transfers") => void }) {
  const dashboard = useApi<DashboardData>("/dashboard");
  const batches = useApi<{ items: Batch[] }>("/batches");
  if (dashboard.loading || batches.loading) return <LoadingState />;
  if (dashboard.error !== null) return <ErrorState message={dashboard.error} retry={dashboard.reload} />;
  if (dashboard.data === null) return null;
  const data = dashboard.data;
  const active = batches.data?.items.filter((batch) => ["PLANNED", "PREPARATION", "IN_PROGRESS"].includes(batch.status)) ?? [];
  const trend = data.productionTrend.map((point) => ({
    ...point,
    produced: Number(point.produced),
    sent: Number(point.sent),
    loss: Number(point.loss),
    label: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${point.date}T12:00:00`)),
  }));

  return (
    <>
      <div className="dashboard-heading">
        <div><span className="eyebrow">Оперативная сводка</span><h1>Добрый день, производство</h1><p>{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date())} · данные обновлены сейчас</p></div>
        <button className="button primary" onClick={() => onNavigate("batches")}><Factory size={17} /> Новый замес</button>
      </div>

      <div className="kpi-grid">
        <Kpi icon={<FlaskConical />} label="Расход сырья сегодня" value={formatMetric(data.metrics.consumedMaterials)} hint="фактическое списание" tone="lime" />
        <Kpi icon={<PackageCheck />} label="Произведено сегодня" value={formatMetric(data.metrics.produced)} hint="готового продукта" tone="blue" />
        <Kpi icon={<Truck />} label="Отгружено" value={formatMetric(data.metrics.sentToLrt)} hint="подтверждённые отправки" tone="violet" />
        <Kpi icon={<Boxes />} label="Доступный остаток" value={formatMetric(data.metrics.availableProduct)} hint="по всем партиям" tone="amber" />
        <Kpi icon={<CircleGauge />} label="Активные замесы" value={String(data.metrics.activeBatches)} hint={`${active.filter((batch) => batch.status === "IN_PROGRESS").length} сейчас в работе`} tone="green" />
        <Kpi icon={<TrendingDown />} label="Потери за день" value={`${data.metrics.lossPercent}%`} hint="от общего выпуска" tone="red" warning={Number(data.metrics.lossPercent) > 2} />
      </div>

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
                <Area type="monotone" dataKey="produced" stroke="#7daa27" strokeWidth={2.5} fill="url(#producedFill)" />
                <Area type="monotone" dataKey="sent" stroke="#6375ca" strokeWidth={2} fill="url(#sentFill)" />
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
          </div>
          <button className="text-button" onClick={() => onNavigate("transfers")}>Открыть движения <ArrowRight size={15} /></button>
        </Panel>
      </div>

      <div className="dashboard-lower-grid">
        <Panel>
          <PanelHeader title="Текущая очередь" description="Ближайшие и активные производственные замесы" action={<button className="text-button" onClick={() => onNavigate("batches")}>Все замесы <ArrowRight size={15} /></button>} />
          <div className="batch-cards">
            {active.slice(0, 4).map((batch) => (
              <article className="batch-mini-card" key={batch.id}>
                <div className="batch-time"><strong>{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(batch.scheduledAt))}</strong><span>{formatDate(batch.scheduledAt)}</span></div>
                <div className="batch-main"><div><strong>{batch.number}</strong><StatusBadge status={batch.status} /></div><p>{batch.concreteGrade} · {batch.recipeVersion.recipe.name}</p><div className="batch-meta"><span>{batch.productionLine.name}</span><span>{formatNumber(batch.plannedVolume)} {unitLabel[batch.plannedVolumeUnit]}</span><span>{batch.operator.name}</span></div></div>
                <div className="batch-progress"><span>{batch.status === "IN_PROGRESS" ? "62%" : "Ожидает"}</span><ProgressBar value={batch.status === "IN_PROGRESS" ? 62 : 8} /></div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Контроль и риски" description="Отклонения и критические остатки" />
          {data.criticalMaterials.length === 0 && data.deviations.length === 0 ? (
            <EmptyState title="Отклонений нет" text="Все остатки и дозировки находятся в допустимых пределах." />
          ) : (
            <div className="risk-list">
              {data.criticalMaterials.map((material) => (
                <button key={material.id} onClick={() => onNavigate("materials")}><span className="risk-icon"><AlertTriangle size={17} /></span><span><strong>{material.name}</strong><small>Остаток {formatNumber(material.currentStock)} {unitLabel[material.baseUnit]}</small></span><ArrowRight size={15} /></button>
              ))}
              {data.deviations.map((component) => (
                <button key={component.id} onClick={() => onNavigate("batches")}><span className="risk-icon red"><CircleGauge size={17} /></span><span><strong>{component.materialNameSnapshot}</strong><small>Отклонение {formatNumber(component.deviationPercent)}%</small></span><ArrowRight size={15} /></button>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
  warning = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: string;
  warning?: boolean;
}) {
  return (
    <article className={`kpi-card ${tone} ${warning ? "warning" : ""}`}>
      <div className="kpi-top"><span className="kpi-icon">{icon}</span>{warning ? <span className="warning-label">выше нормы</span> : <span className="delta">сегодня</span>}</div>
      <p>{label}</p><strong>{value}</strong><small>{hint}</small>
    </article>
  );
}
