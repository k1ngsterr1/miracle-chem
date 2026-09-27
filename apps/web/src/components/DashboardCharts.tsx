import { WalletCards } from "lucide-react";
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
import { Panel, PanelHeader } from "./ui.js";

export interface ProductionTrendPoint {
  label: string;
  produced: number;
  sent: number;
  loss: number;
}

export interface LineStatPoint {
  line: string;
  produced: number;
  loss: number;
}

export interface StatusStatPoint {
  status: string;
  label: string;
  count: number;
}

export interface ExpenseTrendPoint {
  label: string;
  amount: number;
}

export function ProductionTrendChart({ trend }: { trend: ProductionTrendPoint[] }) {
  return (
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
  );
}

export function DashboardAnalyticsCharts({ lineStats, statusStats, expenseTrend }: { lineStats: LineStatPoint[]; statusStats: StatusStatPoint[]; expenseTrend: ExpenseTrendPoint[] }) {
  return (
    <>
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
    </>
  );
}

const CHART_COLORS = ["#91bb36", "#6375ca", "#d39b45", "#55a06a", "#d97161", "#8a6fc2"];
