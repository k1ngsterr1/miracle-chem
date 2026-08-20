import { useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Download,
  FileSpreadsheet,
  FlaskConical,
  PackageSearch,
  RefreshCw,
  Scale,
  Truck,
  WalletCards,
} from "lucide-react";
import { reportExportUrl } from "../api.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import { formatNumber } from "../lib/format.js";
import { ErrorState, LoadingState, PageHeader, Panel, PanelHeader } from "../components/ui.js";

type ReportType = "production" | "materials" | "balance" | "recipe-efficiency" | "lrt" | "expenses";

const REPORTS = {
  production: {
    title: "Выпуск продукции",
    description: "План, факт, выход, брак, потери и себестоимость по замесам.",
    icon: BarChart3,
    path: "/reports/production",
  },
  materials: {
    title: "Расход реагентов",
    description: "Плановый и фактический расход, возвраты и отклонения.",
    icon: PackageSearch,
    path: "/reports/material-consumption",
  },
  balance: {
    title: "Производственный баланс",
    description: "Начальный остаток, выпуск, движения и остаток на конец.",
    icon: Scale,
    path: "/reports/product-balance",
  },
  "recipe-efficiency": {
    title: "Эффективность рецептур",
    description: "Выход, годность, потери и себестоимость по версиям рецептур.",
    icon: FlaskConical,
    path: "/reports/recipe-efficiency",
  },
  lrt: {
    title: "Отгрузки",
    description: "Отправлено, принято, отклонено и возвращено по документам.",
    icon: Truck,
    path: "/reports/lrt",
  },
  expenses: {
    title: "Операционные расходы",
    description: "Затраты по категориям, центрам ответственности и контрагентам.",
    icon: WalletCards,
    path: "/reports/expenses",
  },
} as const;

export function ReportsPage() {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [type, setType] = useState<ReportType>("production");
  const [from, setFrom] = useState(monthAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const path = `${REPORTS[type].path}?from=${encodeURIComponent(`${from}T00:00:00`)}&to=${encodeURIComponent(`${to}T23:59:59`)}`;
  const report = useApi<{ items: Array<Record<string, unknown>> }>(path);
  const columns = useMemo(() => Object.keys(report.data?.items[0] ?? {}).slice(0, 12), [report.data]);

  return (
    <>
      <PageHeader
        eyebrow="Аналитика и экспорт"
        title="Производственные отчёты"
        description="Сверяйте расход, выпуск, себестоимость и движение каждой партии за любой период."
        actions={<div className="export-actions"><a className="button ghost" href={reportExportUrl(type, "csv", `${from}T00:00:00`, `${to}T23:59:59`)}><Download size={16} /> CSV</a><a className="button primary" href={reportExportUrl(type, "xlsx", `${from}T00:00:00`, `${to}T23:59:59`)}><FileSpreadsheet size={16} /> XLSX</a></div>}
      />

      <div className="report-cards">{(Object.entries(REPORTS) as Array<[ReportType, (typeof REPORTS)[ReportType]]>).map(([id, item]) => <button key={id} className={type === id ? "active" : ""} onClick={() => setType(id)}><span><item.icon size={20} /></span><div><strong>{item.title}</strong><p>{item.description}</p></div></button>)}</div>

      <Panel className="report-workspace">
        <div className="report-controls"><div><span className="eyebrow">Параметры отчёта</span><h2>{REPORTS[type].title}</h2></div><div className="period-control"><CalendarDays size={17} /><div className="period-date"><small>С</small><DateTimePicker mode="date" compact ariaLabel="Начало периода" value={from} onChange={setFrom} align="right" /></div><i /><div className="period-date"><small>По</small><DateTimePicker mode="date" compact ariaLabel="Конец периода" value={to} onChange={setTo} align="right" /></div><button className="icon-button" aria-label="Обновить отчёт" onClick={() => void report.reload()}><RefreshCw size={16} /></button></div></div>
        {report.loading ? <LoadingState /> : report.error !== null ? <ErrorState message={report.error} retry={report.reload} /> : (
          <>
            <div className="report-result-summary"><span>Строк: <strong>{report.data?.items.length ?? 0}</strong></span><span>Период: <strong>{from} — {to}</strong></span><span>Расчёт: <strong>backend Decimal</strong></span></div>
            <div className="data-table-wrap"><table className="data-table report-table"><thead><tr>{columns.map((column) => <th key={column}>{columnLabel(column)}</th>)}</tr></thead><tbody>{report.data?.items.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{formatCell(column, row[column])}</td>)}</tr>)}</tbody></table></div>
          </>
        )}
      </Panel>

      <div className="report-footnotes"><Panel><PanelHeader title="Точность данных" /><p>Количества и деньги рассчитаны в PostgreSQL Decimal. Значения разных единиц не суммируются без явной конвертации.</p></Panel><Panel><PanelHeader title="Прослеживаемость" /><p>Каждая строка отчёта связана с замесом, версией рецептуры, партиями сырья и движениями продукта.</p></Panel><Panel><PanelHeader title="Неизменяемость" /><p>Завершённые замесы блокируются. Исправления проводятся отдельным корректирующим документом с audit log.</p></Panel></div>
    </>
  );
}

const LABELS: Record<string, string> = {
  batchNumber: "Замес",
  scheduledAt: "Дата",
  completedAt: "Завершён",
  status: "Статус",
  batchStatus: "Статус",
  recipe: "Рецептура",
  concreteGrade: "Класс",
  productionLine: "Линия",
  operator: "Оператор",
  plannedVolume: "План",
  actualVolume: "Факт",
  volumeUnit: "Ед.",
  plannedOutput: "План выпуска",
  actualOutput: "Выпуск",
  goodOutput: "Годно",
  rejectedOutput: "Брак",
  technologicalLoss: "Потери",
  totalCost: "Себестоимость",
  costPerUnit: "Цена ед.",
  outputUnit: "Ед.",
  currency: "Валюта",
  batches: "Замесов",
  materialName: "Материал",
  planned: "План",
  reserved: "Резерв",
  actual: "Факт",
  returned: "Возврат",
  loss: "Потери",
  deviationPercent: "Отклонение",
  productLot: "Партия",
  opening: "На начало",
  produced: "Произведено",
  sentToLrt: "Отгружено",
  writtenOff: "Списано",
  closing: "На конец",
  recipeVersion: "Версия",
  yieldPercent: "Выход, %",
  goodYieldPercent: "Годно, %",
  lossPercent: "Потери, %",
  transferNumber: "Отгрузка",
  transferAt: "Дата отгрузки",
  sent: "Отправлено",
  accepted: "Принято",
  rejected: "Отклонено",
  receiver: "Получатель",
  sender: "Отправитель",
  expenseNumber: "Расход",
  incurredAt: "Дата расхода",
  category: "Категория",
  costCenter: "Центр затрат",
  paymentMethod: "Оплата",
  description: "Назначение",
  counterparty: "Контрагент",
  documentNumber: "Документ",
  amount: "Сумма",
  createdBy: "Создал",
  cancellationReason: "Причина отмены",
};

function columnLabel(value: string): string {
  return LABELS[value] ?? value.replace(/([A-Z])/gu, " $1").trim();
}

function formatCell(column: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (/At$|^date$/u.test(column)) return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "2-digit" }).format(new Date(String(value)));
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value)) return formatNumber(value);
  return String(value);
}
