import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  CopyPlus,
  FileText,
  MapPin,
  PackageCheck,
  Plus,
  RotateCcw,
  Search,
  Send,
  Truck,
  X,
} from "lucide-react";
import { apiFetch, apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import { useDateFilter } from "../hooks/use-date-filter.js";
import { sourceDecimal, sourceMoney } from "../hooks/use-one-c-source.js";
import type { MetaData, Transfer } from "../types.js";
import type { HistoricalSale } from "../types/historical.js";
import { formatDate, formatNumber, unitLabel } from "../lib/format.js";
import {
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui.js";

const DELIVERY_METHOD_OPTIONS = [
  { value: "Автобетоносмеситель", label: "Автобетоносмеситель", description: "Доставка готовой смеси миксером" },
  { value: "Железнодорожный вагон", label: "Железнодорожный вагон", description: "Отгрузка по железной дороге" },
  { value: "Самосвал", label: "Самосвал", description: "Навальный или инертный груз" },
  { value: "Самовывоз", label: "Самовывоз", description: "Транспорт предоставляет получатель" },
  { value: "Контейнер", label: "Контейнер", description: "Контейнерная перевозка" },
];

interface OneCSale {
  id: string;
  number: string;
  status: string;
  documentAt: string;
  counterparty: string;
  totalAmount: string;
  currency: string;
  items: { id: string; description: string; quantity: string; unit: string }[];
  reconciliation: {
    state: "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "NOT_CHECKED";
    transfer: { id: string; number: string } | null;
  };
}

const oneCSaleDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Almaty",
});
function oneCSaleStatus(status: string) {
  if (status === "ISSUED" || status === "PAID") return "Проведено";
  if (status === "CANCELLED") return "Отменено";
  return "Не проведено";
}

export function TransfersPage({ meta, actorRole }: { meta: MetaData | null; actorRole: string | undefined }) {
  const { selectedDate, allDates } = useDateFilter();
  const transfers = useApi<{ items: Transfer[] }>("/transfers");
  const sales = useApi<{ items: OneCSale[]; hasMore: boolean }>(["ADMIN", "DIRECTOR"].includes(actorRole ?? "")
    ? allDates ? "/transfers/one-c-sales" : `/transfers/one-c-sales?date=${selectedDate}` : null);
  const workbookSales = useApi<{ items: HistoricalSale[] }>("/historical-workbooks/sales");
  const [createOpen, setCreateOpen] = useState(false);
  const [template, setTemplate] = useState<Transfer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWorkbookSale, setSelectedWorkbookSale] = useState<HistoricalSale | null>(null);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(30);
  const entries = useMemo(() => [
    ...(transfers.data?.items ?? []).map((value) => ({ kind: "transfer" as const, value, date: value.transferAt })),
    ...(sales.data?.items ?? []).map((value) => ({ kind: "sale" as const, value, date: value.documentAt })),
    ...(workbookSales.data?.items ?? []).map((value) => ({ kind: "workbook-sale" as const, value, date: `${value.date}T12:00:00.000Z` })),
  ].filter((entry) => {
    const needle = query.trim().toLocaleLowerCase("ru");
    if (!needle) return true;
    const fields = entry.kind === "transfer"
      ? [entry.value.number, entry.value.customer?.name, ...entry.value.items.map((item) => item.productLot.concreteGrade)]
      : entry.kind === "sale"
        ? [entry.value.number, entry.value.counterparty, ...entry.value.items.map((item) => item.description)]
        : [entry.value.customer, entry.value.date, entry.value.fileName];
    return fields.some((field) => field?.toLocaleLowerCase("ru").includes(needle));
  }).sort((a, b) => b.date.localeCompare(a.date)), [query, sales.data, transfers.data, workbookSales.data]);
  useEffect(() => setVisibleCount(30), [allDates, query, selectedDate]);
  const grouped = useMemo(() => {
    const items = transfers.data?.items ?? [];
    return {
      sent: items.filter((item) => item.status === "SENT").length,
      accepted: items.filter((item) => item.status === "ACCEPTED").length,
      draft: items.filter((item) => ["DRAFT", "PREPARED"].includes(item.status)).length,
      volume: items.reduce((sum, item) => sum + item.items.reduce((nested, row) => nested + Number(row.sentQuantity), 0), 0),
    };
  }, [transfers.data]);
  if (transfers.loading) return <LoadingState />;
  if (transfers.error !== null) return <ErrorState message={transfers.error} retry={transfers.reload} />;

  return (
    <>
      <PageHeader
        title="Отгрузки"
        actions={<button className="button primary" disabled={(meta?.customers.length ?? 0) === 0} onClick={() => { setTemplate(null); setCreateOpen(true); }}><Plus size={17} /> Новая отгрузка</button>}
      />
      <div className="transfer-summary"><Panel><span className="blue"><Truck size={19} /></span><div><strong>{grouped.sent}</strong><small>в пути / на приёмке</small></div></Panel><Panel><span className="green"><PackageCheck size={19} /></span><div><strong>{grouped.accepted}</strong><small>принято отгрузок</small></div></Panel><Panel><span className="amber"><FileText size={19} /></span><div><strong>{grouped.draft}</strong><small>требует отправки</small></div></Panel><Panel><span className="violet"><ChevronDown size={19} /></span><div><strong>{formatNumber(grouped.volume)} м³</strong><small>{allDates && (transfers.data?.items.length ?? 0) >= 500 ? "по показанным записям" : "физически отгружено"}</small></div></Panel></div>
      <Panel className="table-panel">
        <div className="table-toolbar"><div><h2>Журнал отгрузок</h2></div><div className="toolbar-actions"><label className="inline-search"><Search size={16} /><input aria-label="Поиск по отгрузкам" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, клиент или продукт" /></label><span className="soft-tag">{entries.length} записей</span></div></div>
        <div className="transfer-cards">{entries.slice(0, visibleCount).map((entry) => entry.kind === "transfer"
          ? <TransferCard key={`transfer:${entry.value.id}`} transfer={entry.value} onOpen={setSelectedId} />
          : entry.kind === "sale"
            ? <SaleCard key={`sale:${entry.value.id}`} sale={entry.value} onOpenTransfer={setSelectedId} />
            : <WorkbookSaleCard key={`workbook-sale:${entry.value.id}`} sale={entry.value} onOpen={setSelectedWorkbookSale} />)}</div>
        {entries.length > visibleCount ? <div className="journal-more"><button type="button" className="button ghost small" onClick={() => setVisibleCount((count) => count + 30)}>Показать ещё</button></div> : null}
        {entries.length === 0 && !sales.loading && !workbookSales.loading ? <p className="journal-empty">За выбранную дату записей нет.</p> : null}
        {sales.error ? <p className="inline-load-error" role="alert">Не удалось загрузить часть записей. <button type="button" onClick={() => void sales.reload()}>Повторить</button></p> : null}
        {workbookSales.error ? <p className="inline-load-error" role="alert">Не удалось загрузить данные Excel. <button type="button" onClick={() => void workbookSales.reload()}>Повторить</button></p> : null}
        {sales.data?.hasMore ? <p className="history-limit-note">Показаны последние 500 документов реализации; для более ранних выберите дату.</p> : null}
        {allDates && (transfers.data?.items.length ?? 0) >= 500 ? <p className="history-limit-note">Лимит списка — 500 записей. Для поиска более ранних выберите дату.</p> : null}
      </Panel>
      {createOpen ? <CreateTransferModal meta={meta} template={template} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); setTemplate(null); await transfers.reload(); }} /> : null}
      {selectedId === null ? null : <TransferDetailModal id={selectedId} actorRole={actorRole} onClose={() => setSelectedId(null)} onChanged={transfers.reload} onDuplicate={(transfer) => { setSelectedId(null); setTemplate(transfer); setCreateOpen(true); }} />}
      {selectedWorkbookSale ? <Modal title={`Реализация ${selectedWorkbookSale.customer}`} onClose={() => setSelectedWorkbookSale(null)}>
        <div className="imported-record-detail">
          <p>{formatDate(`${selectedWorkbookSale.date}T12:00:00.000Z`)} · {formatNumber(selectedWorkbookSale.quantityM3)} м³</p>
          {selectedWorkbookSale.unitPrice === null ? null : <div><strong>Цена за м³</strong><span>{formatNumber(selectedWorkbookSale.unitPrice)}</span></div>}
          {selectedWorkbookSale.total === null ? null : <div><strong>Сумма по отчёту</strong><span>{formatNumber(selectedWorkbookSale.total)}</span></div>}
          {selectedWorkbookSale.acceptedQuantity === null ? null : <div><strong>Принято</strong><span>{formatNumber(selectedWorkbookSale.acceptedQuantity)} м³{selectedWorkbookSale.acceptedDate ? ` · ${selectedWorkbookSale.acceptedDate}` : ""}</span></div>}
          <p className="imported-record-note">{selectedWorkbookSale.fileName} · лист «{selectedWorkbookSale.sourceSheet}», строка {selectedWorkbookSale.sourceRows[0]}. Валюта и номер первичного документа в файле не указаны; запись не создаёт отгрузку или счёт.</p>
        </div>
      </Modal> : null}
    </>
  );
}

function WorkbookSaleCard({ sale, onOpen }: { sale: HistoricalSale; onOpen: (sale: HistoricalSale) => void }) {
  return <article className="transfer-sale-card" onClick={() => onOpen(sale)}>
    <div className="transfer-card-head"><div><span>Реализация</span><h3>{sale.customer}</h3></div><span className="soft-tag">По отчёту</span></div>
    <div className="transfer-points"><span><small>Получатель</small><strong>{sale.customer}</strong></span><span /><span><small>Количество</small><strong>{formatNumber(sale.quantityM3)} м³</strong></span></div>
    <div className="transfer-meta"><span><small>Дата</small><strong>{formatDate(`${sale.date}T12:00:00.000Z`)}</strong></span><span><small>Сумма в файле</small><strong>{sale.total === null ? "—" : formatNumber(sale.total)}</strong></span><span><small>Принято</small><strong>{sale.acceptedQuantity === null ? "—" : `${formatNumber(sale.acceptedQuantity)} м³`}</strong></span></div>
    <button type="button" className="card-link" onClick={(event) => { event.stopPropagation(); onOpen(sale); }}>Открыть запись <ChevronRight size={15} /></button>
  </article>;
}

function TransferCard({ transfer, onOpen }: { transfer: Transfer; onOpen: (id: string) => void }) {
  return <article onClick={() => onOpen(transfer.id)}>
    <div className="transfer-route"><span className="route-point source"><MapPin size={15} /></span><i /><span className="route-truck"><Truck size={17} /></span><i /><span className="route-point destination"><MapPin size={15} /></span></div>
    <div className="transfer-card-head"><div><span>{transfer.number}</span><h3>{transfer.items[0]?.productLot.concreteGrade ?? "Продукт"}</h3></div><StatusBadge status={transfer.status} /></div>
    <div className="transfer-points"><span><small>Отправитель</small><strong>{transfer.sender.name}</strong></span><ChevronRight size={17} /><span><small>Получатель</small><strong>{transfer.customer?.name ?? "Клиент не указан"}</strong></span></div>
    <div className="transfer-meta"><span><small>Дата</small><strong>{formatDate(transfer.transferAt, true)}</strong></span><span><small>Количество</small><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.requestedQuantity), 0))} {unitLabel[transfer.items[0]?.unit ?? "M3"]}</strong></span><span><small>Транспорт</small><strong>{transfer.transport ?? "Не указан"}</strong></span></div>
    <button type="button" className="card-link" onClick={(event) => { event.stopPropagation(); onOpen(transfer.id); }}>Открыть документ <ChevronRight size={15} /></button>
  </article>;
}

function SaleCard({ sale, onOpenTransfer }: { sale: OneCSale; onOpenTransfer: (id: string) => void }) {
  const openAccounting = () => { window.location.hash = `accounting/${sale.id}`; };
  return <article className="transfer-sale-card" onClick={openAccounting}>
    <div className="transfer-card-head"><div><span>Реализация</span><h3>{sale.number}</h3></div><span className="soft-tag">{oneCSaleStatus(sale.status)}</span></div>
    <div className="transfer-points"><span><small>Получатель</small><strong>{sale.counterparty}</strong></span><span /><span><small>Сумма</small><strong>{sourceMoney(sale.totalAmount, sale.currency)}</strong></span></div>
    <div className="transfer-meta"><span><small>Дата</small><strong>{oneCSaleDate.format(new Date(sale.documentAt))}</strong></span><span><small>Позиции</small><strong>{sale.items.length}</strong></span><span><small>Тип</small><strong>Документ реализации</strong></span></div>
    <p className="transfer-sale-items">{sale.items.map((item) => `${item.description} — ${sourceDecimal(item.quantity)} ${item.unit}`).join(" · ") || "Нет позиций"}</p>
    {sale.reconciliation.state === "MATCHED" && sale.reconciliation.transfer ? <button type="button" className="card-link" onClick={(event) => { event.stopPropagation(); onOpenTransfer(sale.reconciliation.transfer!.id); }}>Связанная отгрузка {sale.reconciliation.transfer.number} <ChevronRight size={15} /></button>
      : <button type="button" className="card-link" onClick={(event) => { event.stopPropagation(); openAccounting(); }}>Открыть документ <ChevronRight size={15} /></button>}
  </article>;
}

function CreateTransferModal({ meta, template, onClose, onCreated }: { meta: MetaData | null; template: Transfer | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState(() => transferDraftFromTemplate(template));
  const [error, setError] = useState<string | null>(null);
  const customerOptions = (meta?.customers ?? []).map((customer) => ({ value: customer.id, label: customer.name, description: [customer.taxId, customer.contactPerson].filter(Boolean).join(" · ") || "Клиент" }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.number === "" || form.transferAt === "" || form.productLotId === "" || form.quantity === "" || form.customerId === "" || form.transport === "") { setError("Заполните обязательные поля отгрузки"); return; }
    try {
      const selectedLot = meta?.productLots.find((item) => item.id === form.productLotId);
      await apiMutation("/transfers", {
        number: form.number,
        transferAt: new Date(form.transferAt).toISOString(),
        senderId: meta?.actor.id,
        customerId: form.customerId,
        transport: form.transport,
        comments: form.comments || undefined,
        items: [{ productLotId: form.productLotId, quantity: form.quantity, unit: selectedLot?.unit ?? "M3" }],
      });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать отгрузку"); }
  }
  return <Modal title={template === null ? "Новая отгрузка" : `Повторить отгрузку ${template.number}`} onClose={onClose} wide><form className="form-grid" onSubmit={(event) => void submit(event)}><label><span>Номер документа</span><input required value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} /></label><div className="form-field"><span>Дата и время</span><DateTimePicker required ariaLabel="Дата и время отгрузки" value={form.transferAt} onChange={(transferAt) => setForm({ ...form, transferAt })} /></div><div className="form-field span-2"><span>Производственная партия</span><CustomSelect required ariaLabel="Производственная партия" value={form.productLotId} onChange={(productLotId) => setForm({ ...form, productLotId, quantity: "" })} options={(meta?.productLots ?? []).map((item) => ({ value: item.id, label: `${item.number} · ${item.concreteGrade}`, description: `Доступно ${formatNumber(item.availableQuantity)} ${unitLabel[item.unit]}` }))} /></div><label><span>Количество</span><input required type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><div className="form-field"><span>Получатель</span><CustomSelect required ariaLabel="Получатель отгрузки" value={form.customerId} onChange={(customerId) => setForm({ ...form, customerId })} options={customerOptions} placeholder="Выберите клиента" /></div><div className="form-field span-2"><span>Способ отгрузки</span><CustomSelect required ariaLabel="Способ отгрузки" value={form.transport} onChange={(transport) => setForm({ ...form, transport })} options={DELIVERY_METHOD_OPTIONS} /></div><label className="span-2"><span>Комментарий</span><textarea rows={3} value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} /></label>{error === null ? null : <div className="form-error span-2">{error}</div>}<div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><FileText size={16} /> Создать отгрузку</button></div></form></Modal>;
}

function TransferDetailModal({ id, actorRole, onClose, onChanged, onDuplicate }: { id: string; actorRole: string | undefined; onClose: () => void; onChanged: () => Promise<void>; onDuplicate: (transfer: Transfer) => void }) {
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [acceptanceOpen, setAcceptanceOpen] = useState(false);
  const [acceptance, setAcceptance] = useState<Record<string, { accepted: string; rejected: string }>>({});
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});

  async function load() {
    try {
      const value = await apiFetch<Transfer>(`/transfers/${id}`);
      setTransfer(value);
      setAcceptance(Object.fromEntries(value.items.map((item) => [item.id, { accepted: item.sentQuantity, rejected: "0" }])));
      setReturnQuantities(Object.fromEntries(value.items.map((item) => [item.id, ""])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка"); }
  }

  useEffect(() => { void load(); }, [id]);

  async function action(path: string, body: unknown = {}, idempotent = false) {
    setBusy(true); setError(null);
    try { await apiMutation(path, body, { idempotent }); await load(); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); }
    finally { setBusy(false); }
  }

  if (transfer === null) return <Modal title="Документ отгрузки" onClose={onClose} wide><LoadingState /></Modal>;
  const canManage = ["ADMIN", "DIRECTOR", "MANAGER", "STOREKEEPER", "LRT_RECEIVER"].includes(actorRole ?? "");
  const canAccept = ["ADMIN", "DIRECTOR", "STOREKEEPER", "LRT_RECEIVER"].includes(actorRole ?? "");
  const canCancel = canManage && ["DRAFT", "PREPARED"].includes(transfer.status);
  const canReturn = canAccept && ["SENT", "ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"].includes(transfer.status);
  const hasReturnQuantity = transfer.items.some((item) => Number(returnQuantities[item.id] ?? 0) > 0);

  return <Modal title={transfer.number} onClose={onClose} wide>
    <div className="detail-hero"><div><StatusBadge status={transfer.status} /><h3>Отгрузка готового продукта</h3><p className="transfer-direction"><span>{transfer.sender.name}</span><ChevronRight size={13} /><span>{transfer.customer?.name ?? "Клиент не указан"}</span></p></div><div className="detail-volume"><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.requestedQuantity), 0))} {unitLabel[transfer.items[0]?.unit ?? "M3"]}</strong><span>по документу</span></div></div>
    <div className="transfer-document"><div><small>Дата отгрузки</small><strong>{formatDate(transfer.transferAt, true)}</strong></div><div><small>Транспорт</small><strong>{transfer.transport ?? "—"}</strong></div><div><small>Отправлено</small><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.sentQuantity), 0))}</strong></div><div><small>Принято</small><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.acceptedQuantity), 0))}</strong></div></div>
    <div className="section-title"><h3>Позиции</h3><span>{transfer.items.length}</span></div>
    <div className="transfer-items">{transfer.items.map((item) => <div key={item.id}><span><PackageCheck size={17} /></span><div><strong>{item.productLot.number}</strong><small>Замес {item.batch.number} · {item.productLot.concreteGrade}</small></div><span><small>Заявлено</small><strong>{formatNumber(item.requestedQuantity)} {unitLabel[item.unit]}</strong></span><span><small>Принято</small><strong>{formatNumber(item.acceptedQuantity)} {unitLabel[item.unit]}</strong></span></div>)}</div>
    {error === null ? null : <div className="form-error">{error}</div>}
    <div className="workflow-actions">
      {canManage ? <button className="button ghost" onClick={() => onDuplicate(transfer)}><CopyPlus size={16} /> Создать на основе</button> : null}
      {canManage && transfer.status === "DRAFT" ? <button disabled={busy} className="button ghost" onClick={() => void action(`/transfers/${transfer.id}/prepare`)}><Check size={16} /> Подготовить</button> : null}
      {canManage && ["DRAFT", "PREPARED"].includes(transfer.status) ? <button disabled={busy} className="button primary" onClick={() => void action(`/transfers/${transfer.id}/send`, {}, true)}><Send size={16} /> Подтвердить отправку</button> : null}
      {canCancel ? <div className="workflow-inline-form"><label><span>Причина отмены</span><input minLength={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Причина отмены документа" /></label><button type="button" disabled={busy || cancelReason.trim().length < 3} className="button danger" onClick={() => void action(`/transfers/${transfer.id}/cancel`, { reason: cancelReason.trim() }, true)}><X size={16} /> Отменить отгрузку</button></div> : null}
      {canAccept && transfer.status === "SENT" ? <><button disabled={busy} className="button primary" onClick={() => void action(`/transfers/${transfer.id}/accept`, { items: transfer.items.map((item) => ({ transferItemId: item.id, acceptedQuantity: item.sentQuantity, rejectedQuantity: "0", unit: item.unit })) }, true)}><PackageCheck size={16} /> Принять полностью</button><button type="button" disabled={busy} className="button ghost" onClick={() => setAcceptanceOpen((current) => !current)}>Принять с расхождениями</button></> : null}
      {acceptanceOpen && transfer.status === "SENT" ? <div className="workflow-inline-form transfer-resolution-form"><div className="transfer-resolution-head"><strong>Фактическая приёмка</strong><small>Принятое и отклонённое количество по каждой позиции должно равняться отправленному.</small></div>{transfer.items.map((item) => <div className="transfer-resolution-row" key={item.id}><strong>{item.productLot.number}</strong><label><span>Принято, {unitLabel[item.unit]}</span><input type="number" min="0" step="0.001" value={acceptance[item.id]?.accepted ?? ""} onChange={(event) => setAcceptance((current) => ({ ...current, [item.id]: { accepted: event.target.value, rejected: current[item.id]?.rejected ?? "0" } }))} /></label><label><span>Отклонено, {unitLabel[item.unit]}</span><input type="number" min="0" step="0.001" value={acceptance[item.id]?.rejected ?? ""} onChange={(event) => setAcceptance((current) => ({ ...current, [item.id]: { accepted: current[item.id]?.accepted ?? "0", rejected: event.target.value } }))} /></label></div>)}<button type="button" disabled={busy || transfer.items.some((item) => (acceptance[item.id]?.accepted ?? "") === "" || (acceptance[item.id]?.rejected ?? "") === "")} className="button primary" onClick={() => void action(`/transfers/${transfer.id}/accept`, { items: transfer.items.map((item) => ({ transferItemId: item.id, acceptedQuantity: acceptance[item.id]?.accepted ?? "0", rejectedQuantity: acceptance[item.id]?.rejected ?? "0", unit: item.unit })) }, true)}><PackageCheck size={16} /> Подтвердить приёмку</button></div> : null}
      {canReturn ? <button type="button" disabled={busy} className="button ghost" onClick={() => setReturnOpen((current) => !current)}><RotateCcw size={16} /> Оформить возврат</button> : null}
      {returnOpen && canReturn ? <div className="workflow-inline-form transfer-resolution-form"><div className="transfer-resolution-head"><strong>Возврат продукции</strong><small>Укажите фактически возвращённое количество. Остаток вернётся на склад готовой продукции.</small></div>{transfer.items.map((item) => <div className="transfer-resolution-row" key={item.id}><strong>{item.productLot.number}</strong><label><span>Количество, {unitLabel[item.unit]}</span><input type="number" min="0" max={Math.max(0, Number(item.sentQuantity) - Number(item.returnedQuantity))} step="0.001" value={returnQuantities[item.id] ?? ""} placeholder="0" onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></label><small>Доступно для возврата: {formatNumber(Math.max(0, Number(item.sentQuantity) - Number(item.returnedQuantity)))} {unitLabel[item.unit]}</small></div>)}<label><span>Причина возврата</span><input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Необязательно" /></label><button type="button" disabled={busy || !hasReturnQuantity} className="button primary" onClick={() => void action(`/transfers/${transfer.id}/return`, { items: transfer.items.filter((item) => Number(returnQuantities[item.id] ?? 0) > 0).map((item) => ({ transferItemId: item.id, quantity: returnQuantities[item.id], unit: item.unit, reason: returnReason.trim() || undefined })) }, true)}><RotateCcw size={16} /> Подтвердить возврат</button></div> : null}
    </div>
  </Modal>;
}

function transferDraftFromTemplate(template: Transfer | null) {
  const sourceItem = template?.items[0];
  return {
    number: "",
    transferAt: "",
    productLotId: sourceItem?.productLot.id ?? "",
    quantity: sourceItem?.requestedQuantity ?? "",
    customerId: template?.customerId ?? "",
    transport: template?.transport ?? "",
    comments: "",
  };
}
