import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, FileSpreadsheet } from "lucide-react";
import { useApi } from "../hooks/use-api.js";
import { useDateFilter } from "../hooks/use-date-filter.js";
import { formatNumber } from "../lib/format.js";
import { ErrorState, LoadingState, PageHeader, Panel } from "../components/ui.js";

interface Summary {
  id: string;
  fileName: string;
  sha256: string;
  sheets: Array<{ name: string; rowCount: number }>;
  productionCount: number;
  formulaCount: number;
  salesCount: number;
  unlabelledSalesMetricCount: number;
}

interface Cell { address: string; value: string | null; formula?: string }
interface Sheet { name: string; maxRow: number; maxColumn: number; rows: Array<{ number: number; cells: Cell[] }> }
interface Production {
  sourceRows: number[];
  dateFrom: string;
  dateTo: string;
  customer: string | null;
  part?: string | null;
  volumeM3: string;
  ingredients: Array<{ name: string; rate: string; consumed: string }>;
}
interface Formula {
  number: string;
  customer: string | null;
  total: string;
  costPerUnit: string | null;
  components: Array<{ name: string; quantity: string; unitPrice: string; lineTotal: string }>;
}
interface Sale {
  date: string;
  customer: string;
  quantityM3: string;
  unitPrice: string;
  total: string;
  acceptedDate: string | null;
  acceptedQuantity: string | null;
}
interface UnlabelledMetric { date: string; label: string | null; columnE: string | null; columnF: string | null }
interface Workbook {
  payload: {
    fileName: string;
    sheets: Sheet[];
    production: Production[];
    formulas: Formula[];
    sales: Sale[];
    unlabelledSalesMetrics: UnlabelledMetric[];
  };
}

function columnLetter(index: number): string {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export function HistoricalReportsPage({ onBack }: { onBack: () => void }) {
  const { selectedDate, allDates } = useDateFilter();
  const books = useApi<{ items: Summary[] }>("/historical-workbooks");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  useEffect(() => {
    if (books.data?.items.length && !books.data.items.some((item) => item.id === selectedId)) {
      setSelectedId(books.data.items[0]!.id);
    }
  }, [books.data, selectedId]);
  const detail = useApi<Workbook>(selectedId ? `/historical-workbooks/${selectedId}` : null);
  const payload = detail.data?.payload;
  const visibleProduction = payload?.production.filter((row) => allDates || row.dateFrom <= selectedDate && row.dateTo >= selectedDate) ?? [];
  const visibleSales = payload?.sales.filter((row) => allDates || row.date === selectedDate) ?? [];
  const visibleMetrics = payload?.unlabelledSalesMetrics.filter((row) => allDates || row.date === selectedDate) ?? [];
  const sheet = payload?.sheets.find((item) => item.name === selectedSheet);
  const sheetRows = useMemo(() => sheet?.rows.map((row) => ({ number: row.number,
    cells: new Map(row.cells.map((cell) => [cell.address, cell])) })) ?? [], [sheet]);

  return <>
    <div className="report-page-nav"><button type="button" className="text-button" onClick={onBack}><ChevronLeft size={16} /> Все отчёты</button></div>
    <PageHeader title="Исторические отчёты" />
    {books.loading ? <LoadingState /> : books.error ? <ErrorState message={books.error} retry={books.reload} />
      : books.data?.items.length === 0 ? <Panel>Импортированных отчётов пока нет.</Panel> : <>
        <div className="historical-book-tabs" aria-label="Период отчёта">
          {books.data?.items.map((book) => <button type="button" key={book.id} className={selectedId === book.id ? "active" : ""}
            onClick={() => { setSelectedId(book.id); setSelectedSheet(null); }}><FileSpreadsheet size={17} />{book.fileName}</button>)}
        </div>
        {detail.loading ? <LoadingState /> : detail.error ? <ErrorState message={detail.error} retry={detail.reload} /> : payload ? <>
          <div className="historical-sheet-tabs" aria-label="Лист отчёта">
            <button type="button" className={selectedSheet === null ? "active" : ""} onClick={() => setSelectedSheet(null)}>Сводка</button>
            {payload.sheets.map((item) => <button type="button" key={item.name} className={selectedSheet === item.name ? "active" : ""}
              onClick={() => setSelectedSheet(item.name)}>{item.name}</button>)}
          </div>
          {sheet ? <Panel className="historical-sheet-panel">
            <div className="historical-section-head"><h2>{sheet.name}</h2><span>{sheetRows.length} заполненных строк</span></div>
            <div className="historical-grid-wrap"><table className="historical-grid"><thead><tr><th>№</th>
              {Array.from({ length: sheet.maxColumn }, (_, i) => <th key={i}>{columnLetter(i + 1)}</th>)}</tr></thead>
              <tbody>{sheetRows.map((row) => <tr key={row.number}><th>{row.number}</th>
                {Array.from({ length: sheet.maxColumn }, (_, i) => {
                  const cell = row.cells.get(`${columnLetter(i + 1)}${row.number}`);
                  return <td key={i} title={cell?.formula ?? undefined}>{cell?.value ?? ""}</td>;
                })}</tr>)}</tbody></table></div>
          </Panel> : <div className="historical-overview">
            <p className="historical-caution">{allDates ? "Показаны все даты из файла." : `Показаны записи за ${selectedDate}. Выберите «Все даты» в шапке, чтобы увидеть весь период.`}</p>
            <Panel><div className="historical-section-head"><h2>Выпуск и расход</h2><span>{visibleProduction.length} записей</span></div>
              <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Клиент / партия</th><th>Выпуск</th><th>Реагенты и расход</th></tr></thead>
                <tbody>{visibleProduction.map((row, index) => <tr key={index}><td>{row.dateFrom}{row.dateTo !== row.dateFrom ? ` — ${row.dateTo}` : ""}</td>
                  <td>{row.customer ?? (row.part ? `Партия ${row.part}` : "Не указан")}</td><td>{formatNumber(row.volumeM3)} м³</td>
                  <td>{row.ingredients.map((item) => `${item.name}: ${formatNumber(item.consumed)}`).join(" · ")}</td></tr>)}</tbody></table></div>
            </Panel>
            <Panel><div className="historical-section-head"><h2>Формулы</h2><span>{payload.formulas.length} вариантов</span></div>
              <div className="historical-formulas">{payload.formulas.map((row) => <div key={row.number}>
                <strong>Формула №{row.number}{row.customer ? ` · ${row.customer}` : ""}</strong>
                <span>{row.components.map((part) => `${part.name} ${formatNumber(part.quantity)}`).join(" · ")}</span>
                <small>Итого по файлу: {formatNumber(row.total)}{row.costPerUnit ? ` · на единицу: ${formatNumber(row.costPerUnit)}` : ""}</small>
              </div>)}</div>
            </Panel>
            {payload.sales.length > 0 ? <Panel><div className="historical-section-head"><h2>Реализация</h2><span>{visibleSales.length} записей</span></div>
              <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Клиент</th><th>Объём</th><th>Цена в файле</th><th>Сумма в файле</th><th>Принято</th></tr></thead>
                <tbody>{visibleSales.map((row, index) => <tr key={index}><td>{row.date}</td><td>{row.customer}</td><td>{formatNumber(row.quantityM3)} м³</td>
                  <td>{formatNumber(row.unitPrice)}</td><td>{formatNumber(row.total)}</td><td>{row.acceptedQuantity ? formatNumber(row.acceptedQuantity) : "—"}</td></tr>)}</tbody></table></div>
            </Panel> : null}
            {payload.unlabelledSalesMetrics.length > 0 ? <Panel><div className="historical-section-head"><h2>Показатели реализации</h2><span>{visibleMetrics.length} строк</span></div>
              <p className="historical-caution">В исходном листе колонки E и F не подписаны. Они сохранены без отнесения к выручке или долгу.</p>
              <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Обозначение</th><th>Колонка E</th><th>Колонка F</th></tr></thead>
                <tbody>{visibleMetrics.map((row, index) => <tr key={index}><td>{row.date}</td><td>{row.label ?? "—"}</td>
                  <td>{row.columnE ?? "—"}</td><td>{row.columnF ?? "—"}</td></tr>)}</tbody></table></div>
            </Panel> : null}
            <p className="historical-caution">Листы «приход» и «вирт склад» доступны выше в исходном виде. Расчётные остатки не изменяют текущий склад CRM; записи не дублируются в бухгалтерии и сводных оборотах 1С.</p>
          </div>}
        </> : null}
      </>}
  </>;
}
