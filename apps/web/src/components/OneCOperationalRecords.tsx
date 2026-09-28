import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Database, RefreshCw } from "lucide-react";
import { useApi } from "../hooks/use-api.js";
import { useDateFilter } from "../hooks/use-date-filter.js";
import { EmptyState, ErrorState, Panel } from "./ui.js";

interface SourceResponse<T> {
  available: boolean;
  section?: "receipts" | "production";
  snapshotAt?: string;
  items?: T[];
}

interface OneCReceipt {
  documentId: string;
  lineNumber: number;
  number: string;
  receivedAt: string;
  posted: boolean;
  deleted: boolean;
  supplier: string;
  warehouse: string;
  material: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  currencyName: string;
}

interface OneCProductionReport {
  externalId: string;
  number: string;
  documentAt: string;
  posted: boolean;
  deleted: boolean;
  warehouse: string;
  products: Array<{
    lineNumber: number;
    material: string;
    quantity: string;
    specification: string;
  }>;
}

const PAGE_SIZE = 20;

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function documentStatus(posted: boolean, deleted: boolean): string {
  return deleted ? "Помечен на удаление" : posted ? "Проведён" : "Не проведён";
}

function sourceDecimal(value: string): string {
  const [whole, fraction] = value.split(".");
  const significantFraction = fraction?.replace(/0+$/u, "");
  return significantFraction ? `${whole},${significantFraction}` : whole ?? value;
}

function SourcePanel<T extends { posted: boolean; deleted: boolean }>({
  title,
  section,
  dateField,
  columns,
  rowKey,
  renderRow,
}: {
  title: string;
  section: "receipts" | "production";
  dateField: keyof T;
  columns: string[];
  rowKey: (row: T) => string;
  renderRow: (row: T) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [allDates, setAllDates] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { selectedDate } = useDateFilter();
  const source = useApi<SourceResponse<T>>(open ? `/integrations/1c/source/${section}` : null);
  const rows = useMemo(() => {
    const items = source.data?.section === section ? source.data.items ?? [] : [];
    return items.filter((item) => allDates || String(item[dateField]).slice(0, 10) === selectedDate)
      .sort((left, right) => String(right[dateField]).localeCompare(String(left[dateField])));
  }, [allDates, dateField, section, selectedDate, source.data]);

  return <Panel className="one-c-operational-panel">
    <div className="table-toolbar one-c-operational-toolbar">
      <div><h2><Database size={17} /> {title}</h2>
        {open && source.data?.available && source.data.snapshotAt
          ? <p>Снимок 1С: {dateTime(source.data.snapshotAt)}</p> : null}
      </div>
      <button type="button" className="button ghost small" aria-expanded={open}
        aria-label={`${open ? "Свернуть" : "Показать"} ${title.toLowerCase()}`}
        onClick={() => setOpen((current) => !current)}>
        {open ? "Свернуть" : "Показать"}{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
    </div>
    {open ? <>
      {source.loading && source.data === null ? <div className="one-c-operational-state" role="status">Загрузка данных 1С…</div>
        : source.error ? <ErrorState message={source.error} retry={source.reload} />
          : !source.data?.available ? <EmptyState title="Снимок 1С не получен" text="Данные появятся после подтверждённого обмена." />
            : <>
              <div className="one-c-operational-meta">
                <span>{allDates ? "Все даты" : `За ${selectedDate}`} · {rows.length} записей</span>
                <div>
                  <button type="button" className="text-button" onClick={() => { setAllDates((current) => !current); setVisibleCount(PAGE_SIZE); }}>
                    {allDates ? "Выбранная дата" : "Все даты"}
                  </button>
                  <button type="button" className="icon-button" aria-label={`Обновить ${title.toLowerCase()}`} onClick={source.reload}><RefreshCw size={15} /></button>
                </div>
              </div>
              {rows.length === 0 ? <EmptyState
                title={allDates ? "Записей в снимке нет" : "Записей за этот период нет"}
                text={allDates ? "Последний применённый снимок 1С не содержит записей этого раздела." : "Выберите другую дату или покажите все даты."} />
                : <div className="data-table-wrap"><table className="data-table one-c-operational-table">
                  <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>{rows.slice(0, visibleCount).map((row) => <tr key={rowKey(row)}>{renderRow(row)}</tr>)}</tbody>
                </table></div>}
              {rows.length > visibleCount ? <div className="one-c-operational-more"><button type="button" className="button ghost small"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Показать ещё</button></div> : null}
            </>}
    </> : null}
  </Panel>;
}

export function OneCReceiptsPanel() {
  return <SourcePanel<OneCReceipt> title="Поступления из 1С" section="receipts" dateField="receivedAt"
    columns={["Документ", "Дата", "Поставщик", "Материал", "Склад", "Количество", "Цена", "Сумма", "Статус"]}
    rowKey={(row) => `${row.documentId}:${row.lineNumber}`}
    renderRow={(row) => <>
      <td><strong>{row.number}</strong><small>Строка {row.lineNumber}</small></td>
      <td>{dateTime(row.receivedAt)}</td><td>{row.supplier}</td><td>{row.material}</td><td>{row.warehouse}</td>
      <td>{sourceDecimal(row.quantity)} {row.unitName}</td><td>{sourceDecimal(row.unitPrice)} {row.currencyName}</td>
      <td>{sourceDecimal(row.amount)} {row.currencyName}</td><td>{documentStatus(row.posted, row.deleted)}</td>
    </>} />;
}

export function OneCProductionPanel() {
  return <SourcePanel<OneCProductionReport> title="Выпуск по 1С" section="production" dateField="documentAt"
    columns={["Отчёт за смену", "Дата", "Склад", "Продукция", "Статус"]}
    rowKey={(row) => row.externalId}
    renderRow={(row) => <>
      <td><strong>{row.number}</strong><small>1С · отчёт за смену</small></td>
      <td>{dateTime(row.documentAt)}</td><td>{row.warehouse}</td>
      <td>{row.products.length === 0 ? "—" : <details><summary>{row.products.length} поз.</summary>
        <div className="one-c-source-lines">{row.products.map((part) => <div key={part.lineNumber}>
          <strong>{part.material}</strong><span>{sourceDecimal(part.quantity)}</span>
          <small>Спецификация: {part.specification}</small>
        </div>)}</div></details>}</td>
      <td>{documentStatus(row.posted, row.deleted)}</td>
    </>} />;
}
