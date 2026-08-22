import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Ban,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FilePlus2,
  FileText,
  Plus,
  ReceiptText,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { apiFetch, apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import { formatDate, formatMoney, formatNumber } from "../lib/format.js";
import type {
  AccountingDocument,
  AccountingDocumentStatus,
  AccountingDocumentType,
  AccountingResponse,
} from "../types.js";
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, Panel, StatusBadge } from "../components/ui.js";

const TYPE_LABELS: Record<AccountingDocumentType, string> = {
  WAYBILL: "Накладная",
  PAYMENT_INVOICE: "Счёт на оплату",
  COMPLETION_ACT: "Акт выполненных работ",
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));
const TYPE_FILTER_OPTIONS = [{ value: "ALL", label: "Все документы" }, ...TYPE_OPTIONS];
const STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "Все статусы" },
  { value: "DRAFT", label: "Черновик" },
  { value: "ISSUED", label: "Выставлен" },
  { value: "PAID", label: "Оплачен" },
  { value: "CANCELLED", label: "Отменён" },
];
const DOCUMENT_UNIT_OPTIONS = [
  { value: "PCS", label: "шт." },
  { value: "SERVICE", label: "услуга" },
  { value: "M3", label: "м³" },
  { value: "T", label: "т" },
  { value: "KG", label: "кг" },
  { value: "L", label: "л" },
];

interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export function AccountingPage() {
  const [from, setFrom] = useState(() => monthStart());
  const [to, setTo] = useState(() => localDate());
  const [type, setType] = useState<AccountingDocumentType | "ALL">("ALL");
  const [status, setStatus] = useState<AccountingDocumentStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const params = useMemo(() => {
    const search = new URLSearchParams({ from: dayStartIso(from), to: dayEndIso(to) });
    if (type !== "ALL") search.set("type", type);
    if (status !== "ALL") search.set("status", status);
    if (query.trim() !== "") search.set("search", query.trim());
    return search.toString();
  }, [from, to, query, status, type]);
  const documents = useApi<AccountingResponse>(`/accounting?${params}`);

  if (documents.loading && documents.data === null) return <LoadingState />;
  if (documents.error !== null) return <ErrorState message={documents.error} retry={documents.reload} />;
  const data = documents.data ?? { items: [], summary: { totals: [], byStatus: [], byType: [] } };
  const total = data.summary.totals.find((item) => item.currency === "KZT") ?? data.summary.totals[0];
  const statusCount = (value: AccountingDocumentStatus) => data.summary.byStatus.find((item) => item.status === value)?.count ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Финансы и первичные документы"
        title="Бухгалтерия"
        description="Накладные, счета на оплату и акты выполненных работ с автоматическим расчётом сумм и НДС."
        actions={<button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Новый документ</button>}
      />

      <div className="accounting-summary">
        <Panel><span><BadgeDollarSign size={19} /></span><div><strong>{total === undefined ? formatMoney(0) : formatMoney(total.amount, total.currency)}</strong><small>сумма документов</small></div></Panel>
        <Panel><span className="amber"><FileText size={19} /></span><div><strong>{statusCount("DRAFT")}</strong><small>черновиков</small></div></Panel>
        <Panel><span className="blue"><Send size={19} /></span><div><strong>{statusCount("ISSUED")}</strong><small>выставлено</small></div></Panel>
        <Panel><span className="green"><CheckCircle2 size={19} /></span><div><strong>{statusCount("PAID")}</strong><small>оплачено</small></div></Panel>
      </div>

      <Panel className="accounting-filter-panel">
        <div className="accounting-filters">
          <div className="form-field"><span>С даты</span><DateTimePicker mode="date" ariaLabel="Начало периода бухгалтерии" value={from} onChange={setFrom} /></div>
          <div className="form-field"><span>По дату</span><DateTimePicker mode="date" ariaLabel="Конец периода бухгалтерии" value={to} onChange={setTo} /></div>
          <div className="form-field"><span>Тип документа</span><CustomSelect ariaLabel="Тип бухгалтерского документа" value={type} onChange={(value) => setType(value as AccountingDocumentType | "ALL")} options={TYPE_FILTER_OPTIONS} /></div>
          <div className="form-field"><span>Статус</span><CustomSelect ariaLabel="Статус бухгалтерского документа" value={status} onChange={(value) => setStatus(value as AccountingDocumentStatus | "ALL")} options={STATUS_FILTER_OPTIONS} /></div>
          <label className="expense-search"><span>Поиск</span><span><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, контрагент, основание…" /></span></label>
        </div>
      </Panel>

      <Panel className="table-panel">
        <div className="table-toolbar"><div><h2>Журнал документов</h2><p>Сумма и НДС рассчитываются по позициям на сервере</p></div><span className="expense-count">{data.items.length} документов</span></div>
        {data.items.length === 0 ? <EmptyState title="Документов за период нет" text="Измените фильтры или создайте первый бухгалтерский документ." /> : (
          <div className="data-table-wrap">
            <table className="data-table accounting-table">
              <thead><tr><th>Документ</th><th>Дата</th><th>Контрагент</th><th>Основание</th><th>Без НДС</th><th>НДС</th><th>Итого</th><th>Статус</th><th aria-label="Открыть" /></tr></thead>
              <tbody>{data.items.map((document) => (
                <tr key={document.id} onClick={() => setSelectedId(document.id)}>
                  <td><strong>{document.number}</strong><small>{TYPE_LABELS[document.type]}</small></td>
                  <td>{formatDate(document.documentAt)}</td>
                  <td>{document.counterparty}</td>
                  <td>{document.basis ?? "—"}</td>
                  <td>{formatMoney(document.subtotal, document.currency)}</td>
                  <td>{formatMoney(document.vatAmount, document.currency)}</td>
                  <td><strong>{formatMoney(document.totalAmount, document.currency)}</strong></td>
                  <td><StatusBadge status={document.status} /></td>
                  <td><button type="button" className="row-action" aria-label={`Открыть ${document.number}`}><ChevronRight size={16} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      {createOpen ? <CreateAccountingModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await documents.reload(); }} /> : null}
      {selectedId === null ? null : <AccountingDetail id={selectedId} onClose={() => setSelectedId(null)} onChanged={documents.reload} />}
    </>
  );
}

function CreateAccountingModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({
    type: "",
    number: "",
    documentAt: "",
    dueAt: "",
    counterparty: "",
    counterpartyTaxId: "",
    basis: "",
    vatRate: "",
    currency: "",
    notes: "",
  });
  const [items, setItems] = useState<DraftLine[]>([
    { key: crypto.randomUUID(), description: "", quantity: "", unit: "", unitPrice: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const vatAmount = subtotal * Number(form.vatRate || 0) / 100;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (form.type === "" || form.documentAt === "" || form.counterparty.trim() === "" || form.currency.length !== 3) {
      setError("Заполните тип, дату, контрагента и валюту");
      return;
    }
    if (items.some((item) => item.description.trim() === "" || item.quantity === "" || item.unit === "" || item.unitPrice === "")) {
      setError("Заполните все позиции документа");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiMutation("/accounting", {
        type: form.type,
        number: form.number || undefined,
        documentAt: new Date(form.documentAt).toISOString(),
        dueAt: form.dueAt === "" ? undefined : new Date(form.dueAt).toISOString(),
        counterparty: form.counterparty,
        counterpartyTaxId: form.counterpartyTaxId || undefined,
        basis: form.basis || undefined,
        vatRate: form.vatRate || undefined,
        currency: form.currency,
        notes: form.notes || undefined,
        items: items.map(({ key: _key, ...item }) => item),
      }, { idempotent: true });
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать документ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Новый бухгалтерский документ" onClose={onClose} wide>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <div className="form-field"><span>Тип документа</span><CustomSelect ariaLabel="Тип нового бухгалтерского документа" value={form.type} onChange={(type) => setForm({ ...form, type })} options={TYPE_OPTIONS} /></div>
          <label><span>Номер</span><input value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} placeholder="Сформируется автоматически" /></label>
          <div className="form-field"><span>Дата документа</span><DateTimePicker mode="date" ariaLabel="Дата бухгалтерского документа" value={form.documentAt} onChange={(documentAt) => setForm({ ...form, documentAt })} /></div>
          <div className="form-field"><span>Срок оплаты</span><DateTimePicker mode="date" ariaLabel="Срок оплаты документа" value={form.dueAt} onChange={(dueAt) => setForm({ ...form, dueAt })} align="right" /></div>
          <label><span>Контрагент</span><input required value={form.counterparty} onChange={(event) => setForm({ ...form, counterparty: event.target.value })} /></label>
          <label><span>БИН / ИИН</span><input value={form.counterpartyTaxId} onChange={(event) => setForm({ ...form, counterpartyTaxId: event.target.value })} /></label>
          <label className="span-2"><span>Основание</span><input value={form.basis} onChange={(event) => setForm({ ...form, basis: event.target.value })} /></label>
          <label><span>НДС, %</span><input type="number" min="0" step="0.01" value={form.vatRate} onChange={(event) => setForm({ ...form, vatRate: event.target.value })} /></label>
          <label><span>Валюта</span><input required minLength={3} maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label>
        </div>

        <div className="section-title accounting-lines-title"><h3>Позиции документа</h3><button type="button" className="button ghost small" onClick={() => setItems([...items, { key: crypto.randomUUID(), description: "", quantity: "", unit: "", unitPrice: "" }])}><Plus size={15} /> Добавить позицию</button></div>
        <div className="accounting-lines">
          {items.map((item) => (
            <div key={item.key}>
              <label><span>Наименование</span><input required value={item.description} onChange={(event) => setItems(items.map((row) => row.key === item.key ? { ...row, description: event.target.value } : row))} /></label>
              <label><span>Количество</span><input required type="number" min="0.000001" step="0.001" value={item.quantity} onChange={(event) => setItems(items.map((row) => row.key === item.key ? { ...row, quantity: event.target.value } : row))} /></label>
              <div className="form-field"><span>Единица</span><CustomSelect ariaLabel="Единица позиции документа" value={item.unit} onChange={(unit) => setItems(items.map((row) => row.key === item.key ? { ...row, unit } : row))} options={DOCUMENT_UNIT_OPTIONS} /></div>
              <label><span>Цена</span><input required type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => setItems(items.map((row) => row.key === item.key ? { ...row, unitPrice: event.target.value } : row))} /></label>
              <button type="button" className="row-action danger" aria-label="Удалить позицию" disabled={items.length === 1} onClick={() => setItems(items.filter((row) => row.key !== item.key))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <div className="accounting-calculation"><span><small>Без НДС</small><strong>{formatMoney(subtotal, form.currency || "KZT")}</strong></span><span><small>НДС</small><strong>{formatMoney(vatAmount, form.currency || "KZT")}</strong></span><span><small>Итого</small><strong>{formatMoney(subtotal + vatAmount, form.currency || "KZT")}</strong></span></div>
        <label className="full-label"><span>Комментарий</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        {error === null ? null : <div className="form-error modal-inline-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary" disabled={saving}><FilePlus2 size={16} /> {saving ? "Сохраняем…" : "Создать документ"}</button></div>
      </form>
    </Modal>
  );
}

function AccountingDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [document, setDocument] = useState<AccountingDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  async function load(): Promise<void> {
    setLoading(true);
    try { setDocument(await apiFetch<AccountingDocument>(`/accounting/${id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось открыть документ"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [id]);

  async function action(path: string, body: unknown = {}): Promise<void> {
    setBusy(true); setError(null);
    try { await apiMutation(path, body, { idempotent: true }); await load(); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); }
    finally { setBusy(false); }
  }

  if (loading || document === null) return <Modal title="Бухгалтерский документ" onClose={onClose} wide>{error === null ? <LoadingState /> : <ErrorState message={error} retry={load} />}</Modal>;
  return (
    <Modal title={document.number} onClose={onClose} wide>
      <div className="accounting-detail-hero"><div><StatusBadge status={document.status} /><span>{TYPE_LABELS[document.type]}</span><h3>{document.counterparty}</h3><p>{document.basis ?? "Без основания"}</p></div><strong>{formatMoney(document.totalAmount, document.currency)}</strong></div>
      <div className="detail-facts accounting-detail-facts">
        <span><small>Дата</small><strong>{formatDate(document.documentAt)}</strong></span>
        <span><small>Срок оплаты</small><strong>{document.dueAt === null ? "—" : formatDate(document.dueAt)}</strong></span>
        <span><small>Без НДС</small><strong>{formatMoney(document.subtotal, document.currency)}</strong></span>
        <span><small>НДС {formatNumber(document.vatRate)}%</small><strong>{formatMoney(document.vatAmount, document.currency)}</strong></span>
        <span><small>Создал</small><strong>{document.createdBy.name}</strong></span>
      </div>
      <div className="section-title"><h3>Позиции</h3><span>{document.items.length}</span></div>
      <div className="accounting-detail-lines">{document.items.map((item) => <div key={item.id}><span><ReceiptText size={17} /></span><div><strong>{item.description}</strong><small>{formatNumber(item.quantity)} {unitName(item.unit)} × {formatMoney(item.unitPrice, document.currency)}</small></div><strong>{formatMoney(item.amount, document.currency)}</strong></div>)}</div>
      {document.notes === null ? null : <div className="expense-note"><FileText size={16} /><div><strong>Комментарий</strong><p>{document.notes}</p></div></div>}
      {error === null ? null : <div className="form-error modal-inline-error">{error}</div>}
      <div className="workflow-actions">
        {document.status === "DRAFT" ? <button className="button primary" disabled={busy} onClick={() => void action(`/accounting/${document.id}/issue`)}><Send size={16} /> Выставить документ</button> : null}
        {document.type === "PAYMENT_INVOICE" && document.status === "ISSUED" ? <button className="button primary" disabled={busy} onClick={() => void action(`/accounting/${document.id}/pay`)}><ClipboardCheck size={16} /> Отметить оплату</button> : null}
        {["DRAFT", "ISSUED"].includes(document.status) ? <button className="button ghost" disabled={busy} onClick={() => setCancelOpen(true)}><Ban size={16} /> Отменить документ</button> : null}
      </div>
      {cancelOpen ? <CancelAccountingModal onClose={() => setCancelOpen(false)} onConfirm={async (reason) => { setCancelOpen(false); await action(`/accounting/${document.id}/cancel`, { reason }); }} /> : null}
    </Modal>
  );
}

function CancelAccountingModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  return <Modal title="Отмена документа" onClose={onClose}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void onConfirm(reason); }}><label className="span-2"><span>Причина отмены</span><textarea required minLength={3} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Назад</button><button className="button primary"><Ban size={15} /> Отменить документ</button></div></form></Modal>;
}

function unitName(value: string): string {
  return DOCUMENT_UNIT_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function monthStart(): string {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function dayStartIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

function dayEndIso(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}
