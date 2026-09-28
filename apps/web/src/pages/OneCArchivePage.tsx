import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Database, LockKeyhole, RefreshCw, Search } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect.js";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel } from "../components/ui.js";
import { useApi } from "../hooks/use-api.js";

type Collection = {
  key: string;
  kind: string;
  name: string;
  sensitivity: "BUSINESS" | "HR" | "SYSTEM_SECRET";
  rowCount: number;
  chunkHashes: string[];
};
type Archive = {
  id: string;
  archiveId: string;
  generatedAt: string;
  readStartedAt: string;
  configurationVersion: string;
  manifest: { collections: Collection[] };
};
type ArchiveChunk = { collectionKey: string; chunkIndex: number; records: Record<string, unknown>[] };
type Reconciliation = {
  verdict: "PARTIAL" | "DIVERGED" | "UNSTABLE_RETRY";
  source: { generatedAt: string };
  discrepancyCount: number;
  countsByArea: Record<string, number>;
  notProjected: Record<string, number | boolean>;
};

const formatNumber = (value: number) => new Intl.NumberFormat("ru-KZ").format(value);
const formatDate = (value: string) => new Date(value).toLocaleString("ru-KZ", { dateStyle: "medium", timeStyle: "short" });

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "value" in value && (typeof value.value === "string" || typeof value.value === "number")) {
    return String(value.value);
  }
  return JSON.stringify(value);
}

function previewText(value: unknown): string {
  const text = cellText(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export function OneCArchivePage() {
  const archives = useApi<{ items: Archive[] }>("/integrations/1c/archive");
  const reconciliation = useApi<Reconciliation>("/integrations/1c/reconciliation");
  const reconciliationResult = reconciliation.data && ["PARTIAL", "DIVERGED", "UNSTABLE_RETRY"].includes(reconciliation.data.verdict)
    ? reconciliation.data : null;
  const [archiveId, setArchiveId] = useState("");
  const [collectionKey, setCollectionKey] = useState("");
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [listLimit, setListLimit] = useState(80);
  const [chunkIndex, setChunkIndex] = useState(0);
  const archive = archives.data?.items.find((item) => item.id === archiveId) ?? archives.data?.items[0];
  const collections = archive?.manifest.collections ?? [];
  const populated = useMemo(() => collections.filter((item) => item.rowCount > 0), [collections]);
  const selected = collections.find((item) => item.key === collectionKey);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("ru");
    return collections.filter((item) => (showEmpty || item.rowCount > 0) &&
      (term === "" || `${item.name} ${item.key} ${item.kind}`.toLocaleLowerCase("ru").includes(term)));
  }, [collections, query, showEmpty]);
  const chunkPath = archive && selected && selected.sensitivity !== "SYSTEM_SECRET" && selected.chunkHashes.length > chunkIndex
    ? `/integrations/1c/archive/${archive.id}/collections/${encodeURIComponent(selected.key)}/chunks/${chunkIndex}` : null;
  const chunk = useApi<ArchiveChunk>(chunkPath);
  const records = chunk.data !== null && chunk.data.collectionKey === selected?.key && chunk.data.chunkIndex === chunkIndex && !chunk.loading
    ? chunk.data.records : [];
  const fields = Object.keys(records[0] ?? {}).slice(0, 6);

  if (archives.loading && archives.data === null) return <LoadingState />;
  if (archives.error) return <ErrorState message={archives.error} retry={archives.reload} />;

  return <>
    <PageHeader title="Архив 1С" />
    {reconciliationResult ? <Panel className={`one-c-reconciliation one-c-reconciliation-${reconciliationResult.verdict.toLowerCase()}`}>
      {reconciliationResult.verdict === "PARTIAL" ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
      <div>
        <strong>{reconciliationResult.verdict === "PARTIAL" ? "Рабочие данные сверены"
          : reconciliationResult.verdict === "DIVERGED" ? `Расхождений: ${formatNumber(reconciliationResult.discrepancyCount)}`
            : "Снимок обновился во время сверки"}</strong>
        <span>{reconciliationResult.verdict === "PARTIAL"
          ? "Остатки, документы и финансы совпали с последним снимком. Полный перенос ещё не подтверждён."
          : reconciliationResult.verdict === "DIVERGED"
            ? Object.entries(reconciliationResult.countsByArea).map(([area, count]) => `${area}: ${count}`).join(" · ")
            : "Повторите проверку после завершения синхронизации."}</span>
        <small>Снимок: {formatDate(reconciliationResult.source.generatedAt)} · Непроецированные наборы остаются в архиве 1С.</small>
      </div>
      <button type="button" className="button ghost" onClick={reconciliation.reload} aria-label="Повторить сверку"><RefreshCw size={16} /></button>
    </Panel> : reconciliation.error ? <div className="one-c-reconciliation-error">Сверка недоступна. <button type="button" onClick={reconciliation.reload}>Повторить</button></div> : null}
    {!archive ? <EmptyState title="Архив пока не получен" text="После передачи из 1С здесь появятся коллекции и записи." /> : <>
      <div className="one-c-archive-summary">
        <Panel><Database size={20} /><div><strong>{formatNumber(collections.length)}</strong><span>наборов данных</span></div></Panel>
        <Panel><Database size={20} /><div><strong>{formatNumber(collections.reduce((sum, item) => sum + item.rowCount, 0))}</strong><span>записей</span></div></Panel>
        <Panel><Database size={20} /><div><strong>{formatNumber(populated.length)}</strong><span>наборов с данными</span></div></Panel>
      </div>
      <div className="one-c-archive-note">
        <span>Выгрузка: {formatDate(archive.generatedAt)}</span>
        <span>1С: {archive.configurationVersion}</span>
      </div>
      {archives.data && archives.data.items.length > 1 ? <div className="one-c-archive-version">
        <CustomSelect ariaLabel="Выбрать выгрузку 1С" value={archive.id}
          options={archives.data.items.map((item) => ({ value: item.id, label: formatDate(item.generatedAt) }))}
          onChange={(value) => { setArchiveId(value); setCollectionKey(""); setChunkIndex(0); }} />
      </div> : null}
      <div className="one-c-archive-layout">
        <Panel className="one-c-archive-catalog">
          <div className="one-c-archive-catalog-head"><strong>Данные 1С</strong><span>{formatNumber(filtered.length)}</span></div>
          <label className="one-c-archive-search"><Search size={16} /><input value={query}
            onChange={(event) => { setQuery(event.target.value); setListLimit(80); }} placeholder="Найти набор данных" /></label>
          <label className="one-c-archive-toggle"><input type="checkbox" checked={showEmpty} onChange={(event) => setShowEmpty(event.target.checked)} />Показывать пустые</label>
          <div className="one-c-archive-collections">
            {filtered.slice(0, listLimit).map((item) => <button type="button" key={item.key}
              className={selected?.key === item.key ? "selected" : ""}
              onClick={() => { setCollectionKey(item.key); setChunkIndex(0); }}>
              <span><strong>{item.name}</strong><small>{item.kind}{item.sensitivity === "HR" ? " · Персонал" : item.sensitivity === "SYSTEM_SECRET" ? " · Закрыто" : ""}</small></span>
              <em>{formatNumber(item.rowCount)}</em>
            </button>)}
            {filtered.length > listLimit ? <button className="one-c-archive-more" onClick={() => setListLimit((value) => value + 80)}>Показать ещё</button> : null}
          </div>
        </Panel>
        <Panel className="one-c-archive-content">
          {!selected ? <EmptyState title="Выберите набор данных" text="Найдите нужный справочник, документ или регистр слева." /> : <>
            <div className="one-c-archive-content-head"><div><span>{selected.kind}</span><h2>{selected.name}</h2><small>{formatNumber(selected.rowCount)} записей · {selected.key}</small></div></div>
            {selected.sensitivity === "SYSTEM_SECRET" ? <div className="one-c-archive-locked"><LockKeyhole size={22} /><strong>Системные данные закрыты</strong><p>Они сохранены в зашифрованном архиве и не выдаются через CRM.</p></div>
              : selected.rowCount === 0 ? <EmptyState title="Записей нет" text="В выбранном наборе 1С нет записей." />
                : chunk.error ? <ErrorState message={chunk.error} retry={chunk.reload} />
                  : chunk.loading || records.length === 0 ? <LoadingState /> : <>
                    <div className="one-c-archive-table-wrap"><table className="one-c-archive-table"><thead><tr><th>№</th>{fields.map((field) => <th key={field}>{field}</th>)}<th>Все поля</th></tr></thead><tbody>
                      {records.map((record, index) => <tr key={`${chunkIndex}-${index}`}><td>{index + 1}</td>
                        {fields.map((field) => <td key={field}>{previewText(record[field])}</td>)}
                        <td><details><summary>Открыть</summary><pre>{JSON.stringify(record, null, 2)}</pre></details></td></tr>)}
                    </tbody></table></div>
                    <div className="one-c-archive-pagination">
                      <span>Порция {chunkIndex + 1} из {selected.chunkHashes.length} · {formatNumber(records.length)} записей</span>
                      <div><button className="button ghost" disabled={chunkIndex === 0} onClick={() => setChunkIndex(chunkIndex - 1)} aria-label="Предыдущая порция"><ChevronLeft size={16} /></button>
                      <button className="button ghost" disabled={chunkIndex === selected.chunkHashes.length - 1} onClick={() => setChunkIndex(chunkIndex + 1)} aria-label="Следующая порция"><ChevronRight size={16} /></button></div>
                    </div>
                  </>}
          </>}
        </Panel>
      </div>
    </>}
  </>;
}
