import { useState } from "react";
import { Database, RefreshCw } from "lucide-react";
import { useApi } from "../hooks/use-api.js";
import { useDateFilter } from "../hooks/use-date-filter.js";
import { formatMoney, formatNumber } from "../lib/format.js";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel } from "../components/ui.js";

type Section = "warehouses" | "receipts" | "contracts" | "specifications" | "production";
type SourceRow = Record<string, unknown>;
type SourceResponse = { available: boolean; snapshotAt?: string; readStartedAt?: string;
  section?: Section; items?: SourceRow[] };
type Column = { key: string; label: string };

const SECTIONS: Array<{ id: Section; label: string; roles: string[]; columns: Column[] }> = [
  { id: "warehouses", label: "Склады", roles: ["ADMIN", "DIRECTOR", "TECHNOLOGIST", "OPERATOR", "STOREKEEPER"],
    columns: [{ key: "code", label: "Код" }, { key: "name", label: "Склад" }, { key: "deleted", label: "Состояние" }] },
  { id: "receipts", label: "Поступления", roles: ["ADMIN", "DIRECTOR", "ACCOUNTANT"],
    columns: [{ key: "receivedAt", label: "Дата" }, { key: "number", label: "Документ" },
      { key: "supplier", label: "Поставщик" }, { key: "material", label: "Номенклатура" },
      { key: "warehouse", label: "Склад" }, { key: "quantity", label: "Количество" },
      { key: "unitPrice", label: "Цена" }, { key: "amount", label: "Сумма" }, { key: "posted", label: "Проведён" }] },
  { id: "contracts", label: "Договоры", roles: ["ADMIN", "DIRECTOR", "ACCOUNTANT"],
    columns: [{ key: "contractNumber", label: "Номер" }, { key: "contractAt", label: "Дата" },
      { key: "counterparty", label: "Контрагент" }, { key: "name", label: "Договор" },
      { key: "deleted", label: "Состояние" }] },
  { id: "specifications", label: "Спецификации", roles: ["ADMIN", "DIRECTOR", "TECHNOLOGIST"],
    columns: [{ key: "code", label: "Код" }, { key: "name", label: "Спецификация" },
      { key: "material", label: "Продукция" }, { key: "quantity", label: "Количество" },
      { key: "components", label: "Состав" }] },
  { id: "production", label: "Выпуск", roles: ["ADMIN", "DIRECTOR", "TECHNOLOGIST"],
    columns: [{ key: "documentAt", label: "Дата" }, { key: "number", label: "Отчёт" },
      { key: "warehouse", label: "Склад" }, { key: "products", label: "Продукция" },
      { key: "posted", label: "Проведён" }] },
];

function display(row: SourceRow, key: string): string {
  const value = row[key];
  if (key === "components" || key === "products") return `${Array.isArray(value) ? value.length : 0} поз.`;
  if (key === "deleted") return value === true ? "Помечен на удаление" : "Активен";
  if (key === "posted") return value === true ? "Да" : "Нет";
  if (value === null || value === undefined || value === "") return "—";
  if (key === "documentAt" || key === "receivedAt" || key === "contractAt") return String(value).replace("T", " ").slice(0, 16);
  if (["quantity", "unitPrice"].includes(key)) return formatNumber(String(value));
  if (key === "amount") return formatMoney(String(value), String(row.currencyName ?? "KZT"));
  return String(value);
}

function nestedRows(row: SourceRow, key: string): SourceRow[] {
  const value = row[key];
  return Array.isArray(value) ? value as SourceRow[] : [];
}

export function OneCSourcePage({ actorRole }: { actorRole: string | undefined }) {
  const { selectedDate, allDates } = useDateFilter();
  const allowed = SECTIONS.filter((section) => section.roles.includes(actorRole ?? ""));
  const [selected, setSelected] = useState<Section>("warehouses");
  const section = allowed.find((item) => item.id === selected) ?? allowed[0];
  const source = useApi<SourceResponse>(section ? `/integrations/1c/source/${section.id}` : null);
  const rawRows = source.data !== null && source.data.section === section?.id ? source.data.items ?? [] : [];
  const dateField = section?.id === "receipts" ? "receivedAt"
    : section?.id === "contracts" ? "contractAt"
      : section?.id === "production" ? "documentAt" : null;
  const rows = dateField === null || allDates ? rawRows : rawRows.filter((row) =>
    String(row[dateField] ?? "").slice(0, 10) === selectedDate);

  return <>
    <PageHeader title="Данные 1С"
      actions={<button type="button" className="button ghost" onClick={source.reload}><RefreshCw size={16} /> Обновить</button>} />
    {allowed.length > 0 ? <nav className="one-c-source-tabs" aria-label="Разделы 1С">
      {allowed.map((item) => <button type="button" key={item.id} aria-current={section?.id === item.id ? "page" : undefined}
        onClick={() => setSelected(item.id)}>{item.label}</button>)}
    </nav> : null}
    {source.loading && (source.data === null || source.data.section !== section?.id) ? <LoadingState />
      : source.error ? <ErrorState message={source.error} retry={source.reload} />
      : !source.data?.available ? <EmptyState title="Снимок 1С пока не получен" text="Раздел появится после успешной синхронизации." />
        : <Panel className="one-c-source-panel">
          <div className="table-toolbar"><div><h2>{section?.label}</h2>
            <p>Снимок: {new Date(source.data.snapshotAt ?? "").toLocaleString("ru-KZ")} · {rows.length} записей</p>
          </div><Database size={21} /></div>
          {rows.length === 0 ? <EmptyState title="Записей нет" text={dateField !== null && !allDates
            ? "За выбранную дату записей нет. Выберите «Все даты» вверху страницы."
            : "В последнем снимке 1С данных этого раздела нет."} />
            : <div className="data-table-wrap"><table className="data-table one-c-source-table"><thead><tr>
              {section?.columns.map((column) => <th key={column.key}>{column.label}</th>)}
            </tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.externalId ?? row.documentId ?? index) + index}>
              {section?.columns.map((column) => <td key={column.key} data-label={column.label}>
                {column.key === "components" || column.key === "products"
                  ? <details><summary>{display(row, column.key)}</summary><div className="one-c-source-lines">
                    {nestedRows(row, column.key).map((part, partIndex) => <div key={partIndex}>
                      <strong>{String(part.material ?? "—")}</strong><span>{formatNumber(String(part.quantity ?? "0"))}</span>
                      {part.plannedAmount !== undefined ? <small>План: {formatMoney(String(part.plannedAmount))}</small> : null}
                    </div>)}
                  </div></details> : display(row, column.key)}
              </td>)}
            </tr>)}</tbody></table></div>}
        </Panel>}
  </>;
}
