import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  CircleDollarSign,
  CopyPlus,
  ExternalLink,
  FileImage,
  FileText,
  Landmark,
  Paperclip,
  Plus,
  ReceiptText,
  Search,
  UploadCloud,
  WalletCards,
  X,
} from "lucide-react";
import { apiMutation, apiUpload, apiUrl } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import { useDateFilter } from "../hooks/use-date-filter.js";
import { useMobileLayout } from "../hooks/use-mobile-layout.js";
import type {
  Expense,
  ExpenseCategory,
  ExpenseAttachment,
  ExpenseCostCenter,
  ExpensePaymentMethod,
  ExpenseResponse,
  ExpenseStatus,
} from "../types.js";
import { formatDate, formatMoney } from "../lib/format.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui.js";

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RAW_MATERIALS: "Сырьё и материалы",
  LOGISTICS: "Логистика",
  UTILITIES: "Коммунальные услуги",
  MAINTENANCE: "Ремонт и обслуживание",
  SALARY: "Заработная плата",
  TAXES: "Налоги и сборы",
  RENT: "Аренда",
  LABORATORY: "Лаборатория",
  OTHER: "Прочее",
};

const COST_CENTER_LABELS: Record<ExpenseCostCenter, string> = {
  PRODUCTION: "Производство",
  WAREHOUSE: "Склад",
  LOGISTICS: "Логистика",
  LABORATORY: "Лаборатория",
  ADMINISTRATION: "Администрация",
  OTHER: "Другое",
};

const PAYMENT_LABELS: Record<ExpensePaymentMethod, string> = {
  BANK_TRANSFER: "Банковский перевод",
  CASH: "Наличные",
  CORPORATE_CARD: "Корпоративная карта",
  OFFSET: "Взаимозачёт",
  OTHER: "Другое",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
const COST_CENTER_OPTIONS = Object.entries(COST_CENTER_LABELS).map(([value, label]) => ({ value, label }));
const PAYMENT_OPTIONS = Object.entries(PAYMENT_LABELS).map(([value, label]) => ({ value, label }));
const FILTER_CATEGORY_OPTIONS = [{ value: "ALL", label: "Все категории" }, ...CATEGORY_OPTIONS];
const STATUS_OPTIONS = [
  { value: "ALL", label: "Все статусы" },
  { value: "RECORDED", label: "Учтён" },
  { value: "CANCELLED", label: "Отменён" },
];

export function ExpensesPage() {
  const mobileLayout = useMobileLayout();
  const { selectedDate } = useDateFilter();
  const [from, setFrom] = useState(() => monthStart());
  const [to, setTo] = useState(() => localDate());
  const [category, setCategory] = useState<ExpenseCategory | "ALL">("ALL");
  const [status, setStatus] = useState<ExpenseStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [template, setTemplate] = useState<Expense | null>(null);
  const [selected, setSelected] = useState<Expense | null>(null);
  useEffect(() => {
    setFrom(selectedDate);
    setTo(selectedDate);
  }, [selectedDate]);
  const params = useMemo(() => {
    const search = new URLSearchParams({ from: dayStartIso(from), to: dayEndIso(to) });
    if (category !== "ALL") search.set("category", category);
    if (status !== "ALL") search.set("status", status);
    if (query.trim() !== "") search.set("search", query.trim());
    return search.toString();
  }, [from, to, category, status, query]);
  const expenses = useApi<ExpenseResponse>(`/expenses?${params}`);

  if (expenses.loading && expenses.data === null) return <LoadingState />;
  if (expenses.error !== null) return <ErrorState message={expenses.error} retry={expenses.reload} />;
  const data = expenses.data ?? { items: [], summary: { totals: [], byCategory: [], recordedCount: 0, cancelledCount: 0 } };
  const primaryTotal = data.summary.totals.find((item) => item.currency === "KZT") ?? data.summary.totals[0];
  const topCategory = [...data.summary.byCategory].sort((left, right) => Number(right.amount) - Number(left.amount))[0];
  const average = primaryTotal === undefined || data.summary.recordedCount === 0
    ? 0
    : Number(primaryTotal.amount) / data.summary.recordedCount;

  return (
    <>
      <PageHeader
        eyebrow="Финансовый контур"
        title="Расходы"
        description="Операционные затраты предприятия по категориям, центрам ответственности и способам оплаты."
        actions={<button className="button primary" onClick={() => { setTemplate(null); setCreateOpen(true); }}><Plus size={17} /> Добавить расход</button>}
      />

      <div className="expense-summary">
        <Panel><span><CircleDollarSign size={19} /></span><div><strong>{primaryTotal === undefined ? formatMoney(0) : formatMoney(primaryTotal.amount, primaryTotal.currency)}</strong><small>учтено за период</small></div></Panel>
        <Panel><span className="blue"><ReceiptText size={19} /></span><div><strong>{data.summary.recordedCount}</strong><small>активных записей</small></div></Panel>
        <Panel><span className="amber"><WalletCards size={19} /></span><div><strong>{formatMoney(average, primaryTotal?.currency ?? "KZT")}</strong><small>средний расход</small></div></Panel>
        <Panel><span className="green"><Landmark size={19} /></span><div><strong>{topCategory === undefined ? "—" : CATEGORY_LABELS[topCategory.category]}</strong><small>крупнейшая категория</small></div></Panel>
      </div>

      <Panel className="expense-filter-panel">
        <div className="expense-filters">
          <div className="form-field"><span>С даты</span><DateTimePicker mode="date" ariaLabel="Начало периода расходов" value={from} onChange={setFrom} /></div>
          <div className="form-field"><span>По дату</span><DateTimePicker mode="date" ariaLabel="Конец периода расходов" value={to} onChange={setTo} /></div>
          <div className="form-field"><span>Категория</span><CustomSelect ariaLabel="Категория расходов" value={category} onChange={(value) => setCategory(value as ExpenseCategory | "ALL")} options={FILTER_CATEGORY_OPTIONS} /></div>
          <div className="form-field"><span>Статус</span><CustomSelect ariaLabel="Статус расходов" value={status} onChange={(value) => setStatus(value as ExpenseStatus | "ALL")} options={STATUS_OPTIONS} /></div>
          <label className="expense-search"><span>Поиск</span><span><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, описание, контрагент…" /></span></label>
        </div>
      </Panel>

      <Panel className="table-panel">
        <div className="table-toolbar"><div><h2>Журнал расходов</h2><p>Отменённые записи остаются в истории и не входят в итоговые суммы</p></div><span className="expense-count">{data.items.length} записей</span></div>
        {data.items.length === 0 ? <EmptyState title="Расходов за период нет" text="Измените фильтры или добавьте первую операционную затрату." /> : (
          <>
          <div className="data-table-wrap desktop-document-table">
            <table className="data-table expense-table">
              <thead><tr><th>Документ</th><th>Дата</th><th>Категория</th><th>Центр затрат</th><th>Контрагент</th><th>Способ оплаты</th><th>Сумма</th><th>Подтверждение</th><th>Статус</th></tr></thead>
              <tbody>{data.items.map((expense) => (
                <tr key={expense.id} onClick={() => setSelected(expense)}>
                  <td><strong>{expense.number}</strong><small>{expense.description}</small></td>
                  <td>{formatDate(expense.incurredAt, true)}</td>
                  <td><span className={`expense-category expense-category-${expense.category.toLowerCase()}`}>{CATEGORY_LABELS[expense.category]}</span></td>
                  <td>{COST_CENTER_LABELS[expense.costCenter]}</td>
                  <td>{expense.counterparty ?? "—"}</td>
                  <td>{PAYMENT_LABELS[expense.paymentMethod]}</td>
                  <td><strong>{formatMoney(expense.amount, expense.currency)}</strong></td>
                  <td>{expense.attachments.length === 0 ? <span className="expense-no-receipt">Нет чека</span> : <span className="expense-receipt-count"><Paperclip size={12} /> {receiptCountLabel(expense.attachments.length)}</span>}</td>
                  <td><StatusBadge status={expense.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {mobileLayout ? <div className="mobile-document-cards" aria-label="Журнал расходов">
            {data.items.map((expense) => (
              <button type="button" className="mobile-document-card" key={expense.id} onClick={() => setSelected(expense)}>
                <div className="mobile-document-card-head"><span className={`expense-category expense-category-${expense.category.toLowerCase()}`}>{CATEGORY_LABELS[expense.category]}</span><StatusBadge status={expense.status} /></div>
                <strong>{expense.number}</strong>
                <small>{expense.description}</small>
                <div className="mobile-document-card-meta"><span>{formatDate(expense.incurredAt, true)}</span><span>{expense.counterparty ?? COST_CENTER_LABELS[expense.costCenter]}</span></div>
                <div className="mobile-document-card-footer"><strong>{formatMoney(expense.amount, expense.currency)}</strong><span>{expense.attachments.length === 0 ? "Без чека" : receiptCountLabel(expense.attachments.length)}</span></div>
              </button>
            ))}
          </div> : null}
          </>
        )}
      </Panel>

      {createOpen ? <CreateExpenseModal template={template} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); setTemplate(null); await expenses.reload(); }} /> : null}
      {selected === null ? null : <ExpenseDetail expense={selected} onClose={() => setSelected(null)} onChanged={expenses.reload} onCancelled={async () => { setSelected(null); await expenses.reload(); }} onDuplicate={(expense) => { setSelected(null); setTemplate(expense); setCreateOpen(true); }} />}
    </>
  );
}

function CreateExpenseModal({ template, onClose, onCreated }: { template: Expense | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState(() => expenseDraftFromTemplate(template));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [receipts, setReceipts] = useState<File[]>([]);
  const [savedExpenseId, setSavedExpenseId] = useState<string | null>(null);
  const [uploadedReceiptKeys, setUploadedReceiptKeys] = useState<Set<string>>(() => new Set());

  function close(): void {
    if (savedExpenseId === null) onClose();
    else void onCreated();
  }

  function addReceipts(files: FileList | null): void {
    if (files === null) return;
    const incoming = Array.from(files);
    const oversized = incoming.find((file) => file.size > MAX_RECEIPT_BYTES);
    if (oversized !== undefined) {
      setError(`Файл «${oversized.name}» больше 10 МБ`);
      return;
    }
    setError(null);
    setReceipts((current) => {
      const existing = new Set(current.map(receiptFileKey));
      return [...current, ...incoming.filter((file) => !existing.has(receiptFileKey(file)))];
    });
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (form.category === "" || form.costCenter === "" || form.paymentMethod === "" || form.incurredAt === "" || Number(form.amount) <= 0 || form.currency.length !== 3 || form.description.trim().length < 3) { setError("Заполните обязательные поля расхода"); return; }
    setSaving(true);
    setError(null);
    try {
      let expenseId = savedExpenseId;
      if (expenseId === null) {
        const created = await apiMutation<Expense>("/expenses", {
          ...form,
          incurredAt: new Date(form.incurredAt).toISOString(),
          counterparty: form.counterparty || undefined,
          documentNumber: form.documentNumber || undefined,
          note: form.note || undefined,
        }, { idempotent: true });
        expenseId = created.id;
        setSavedExpenseId(expenseId);
      }
      const completed = new Set(uploadedReceiptKeys);
      for (const receipt of receipts) {
        const key = receiptFileKey(receipt);
        if (completed.has(key)) continue;
        const payload = new FormData();
        payload.append("file", receipt);
        await apiUpload<ExpenseAttachment>(`/expenses/${expenseId}/receipts`, payload);
        completed.add(key);
        setUploadedReceiptKeys(new Set(completed));
      }
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить расход");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={template === null ? "Новый расход" : `Создать расход на основе ${template.number}`} onClose={close} wide>
      <form className="form-grid" noValidate onSubmit={(event) => void submit(event)}>
        <div className="form-field"><span>Категория</span><CustomSelect required ariaLabel="Категория нового расхода" value={form.category} onChange={(value) => setForm({ ...form, category: value as ExpenseCategory })} options={CATEGORY_OPTIONS} /></div>
        <div className="form-field"><span>Центр затрат</span><CustomSelect required ariaLabel="Центр затрат" value={form.costCenter} onChange={(value) => setForm({ ...form, costCenter: value as ExpenseCostCenter })} options={COST_CENTER_OPTIONS} /></div>
        <div className="form-field"><span>Дата и время</span><DateTimePicker required ariaLabel="Дата и время расхода" value={form.incurredAt} onChange={(value) => setForm({ ...form, incurredAt: value })} /></div>
        <div className="form-field"><span>Способ оплаты</span><CustomSelect required ariaLabel="Способ оплаты расхода" value={form.paymentMethod} onChange={(value) => setForm({ ...form, paymentMethod: value as ExpensePaymentMethod })} options={PAYMENT_OPTIONS} /></div>
        <label><span>Сумма</span><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
        <label><span>Валюта</span><input required minLength={3} maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label>
        <label className="span-2"><span>Назначение расхода</span><input required minLength={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Например, доставка цемента на площадку" /></label>
        <label><span>Контрагент</span><input value={form.counterparty} onChange={(event) => setForm({ ...form, counterparty: event.target.value })} /></label>
        <label><span>Номер счёта / акта</span><input value={form.documentNumber} onChange={(event) => setForm({ ...form, documentNumber: event.target.value })} /></label>
        <label className="span-2"><span>Комментарий</span><textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        <div className="expense-receipt-field span-2">
          <div className="expense-receipt-label"><span>Чеки Kaspi</span><small>Подтверждение расхода</small></div>
          <label className="expense-receipt-upload">
            <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={(event) => { addReceipts(event.target.files); event.target.value = ""; }} />
            <UploadCloud size={20} />
            <span><strong>Выбрать чеки</strong><small>JPG, PNG, WEBP или PDF · до 10 МБ каждый</small></span>
          </label>
          {receipts.length === 0 ? null : <div className="expense-receipt-selection">{receipts.map((file) => {
            const key = receiptFileKey(file);
            const uploaded = uploadedReceiptKeys.has(key);
            return <span key={key}><FileImage size={14} /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}{uploaded ? " · загружен" : ""}</small></span><button type="button" aria-label={`Убрать ${file.name}`} disabled={uploaded || saving} onClick={() => setReceipts((current) => current.filter((item) => receiptFileKey(item) !== key))}><X size={13} /></button></span>;
          })}</div>}
        </div>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={close}>Отмена</button><button className="button primary" disabled={saving}><ReceiptText size={16} /> {saving ? (savedExpenseId === null ? "Сохраняем…" : "Загружаем чеки…") : "Учесть расход"}</button></div>
      </form>
    </Modal>
  );
}

function ExpenseDetail({ expense, onClose, onChanged, onCancelled, onDuplicate }: { expense: Expense; onClose: () => void; onChanged: () => Promise<void>; onCancelled: () => Promise<void>; onDuplicate: (expense: Expense) => void }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const detail = useApi<Expense>(`/expenses/${expense.id}`);
  const current = detail.data ?? expense;

  async function uploadReceipts(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return;
    const incoming = Array.from(files);
    const oversized = incoming.find((file) => file.size > MAX_RECEIPT_BYTES);
    if (oversized !== undefined) { setReceiptError(`Файл «${oversized.name}» больше 10 МБ`); return; }
    setUploading(true);
    setReceiptError(null);
    try {
      for (const file of incoming) {
        const payload = new FormData();
        payload.append("file", file);
        await apiUpload<ExpenseAttachment>(`/expenses/${expense.id}/receipts`, payload);
      }
      await detail.reload();
      await onChanged();
    } catch (cause) {
      setReceiptError(cause instanceof Error ? cause.message : "Не удалось загрузить чек Kaspi");
    } finally {
      setUploading(false);
    }
  }
  return (
    <Modal title={current.number} onClose={onClose} wide>
      <div className="expense-detail-hero">
        <div><StatusBadge status={current.status} /><h3>{current.description}</h3><p>{CATEGORY_LABELS[current.category]} · {COST_CENTER_LABELS[current.costCenter]}</p></div>
        <strong>{formatMoney(current.amount, current.currency)}</strong>
      </div>
      <div className="detail-facts expense-detail-facts">
        <span><small>Дата расхода</small><strong>{formatDate(current.incurredAt, true)}</strong></span>
        <span><small>Контрагент</small><strong>{current.counterparty ?? "—"}</strong></span>
        <span><small>Оплата</small><strong>{PAYMENT_LABELS[current.paymentMethod]}</strong></span>
        <span><small>Документ</small><strong>{current.documentNumber ?? "—"}</strong></span>
        <span><small>Создал</small><strong>{current.createdBy.name}</strong></span>
      </div>
      {current.note === null ? null : <div className="expense-note"><FileText size={16} /><div><strong>Комментарий</strong><p>{current.note}</p></div></div>}
      <div className="expense-receipts">
        <div className="expense-receipts-head"><div><strong>Чеки Kaspi</strong><small>Подтверждающие документы к расходу</small></div><label className={`button ghost ${uploading ? "disabled" : ""}`}><Paperclip size={15} /> {uploading ? "Загрузка…" : "Добавить чек"}<input disabled={uploading} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={(event) => { void uploadReceipts(event.target.files); event.target.value = ""; }} /></label></div>
        {current.attachments.length === 0 ? <div className="expense-receipts-empty"><ReceiptText size={20} /><span><strong>Чеки пока не прикреплены</strong><small>Добавьте чек Kaspi в формате изображения или PDF.</small></span></div> : <div className="expense-receipt-list">{current.attachments.map((receipt) => <a key={receipt.id} href={apiUrl(`/expenses/${current.id}/receipts/${receipt.id}/file`)} target="_blank" rel="noreferrer"><span className={receipt.mimeType === "application/pdf" ? "pdf" : "image"}>{receipt.mimeType === "application/pdf" ? <FileText size={17} /> : <FileImage size={17} />}</span><span><strong>{receipt.name}</strong><small>{formatFileSize(receipt.sizeBytes)} · {formatDate(receipt.createdAt, true)}</small></span><ExternalLink size={15} /></a>)}</div>}
        {receiptError === null ? null : <div className="form-error">{receiptError}</div>}
      </div>
      {current.status === "CANCELLED" ? (
        <div className="expense-cancelled"><Ban size={17} /><div><strong>Расход отменён</strong><p>{current.cancellationReason} · {current.cancelledAt === null ? "" : formatDate(current.cancelledAt, true)}</p></div></div>
      ) : (
        <div className="modal-actions expense-detail-actions"><button className="button ghost" onClick={() => onDuplicate(current)}><CopyPlus size={15} /> Создать на основе</button><button className="button ghost" onClick={() => setCancelOpen(true)}><Ban size={15} /> Отменить запись</button></div>
      )}
      {cancelOpen ? <CancelExpenseModal expense={current} onClose={() => setCancelOpen(false)} onCancelled={onCancelled} /> : null}
    </Modal>
  );
}

function expenseDraftFromTemplate(template: Expense | null) {
  return {
    category: template?.category ?? "" as ExpenseCategory | "",
    costCenter: template?.costCenter ?? "" as ExpenseCostCenter | "",
    paymentMethod: template?.paymentMethod ?? "" as ExpensePaymentMethod | "",
    incurredAt: "",
    amount: template?.amount ?? "",
    currency: template?.currency ?? "",
    description: template?.description ?? "",
    counterparty: template?.counterparty ?? "",
    documentNumber: "",
    note: template?.note ?? "",
  };
}

function CancelExpenseModal({ expense, onClose, onCancelled }: { expense: Expense; onClose: () => void; onCancelled: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await apiMutation(`/expenses/${expense.id}/cancel`, { reason }, { idempotent: true });
      await onCancelled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отменить расход");
    }
  }
  return (
    <Modal title="Отмена расхода" onClose={onClose}>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <div className="expense-warning span-2"><Ban size={18} /><p>Запись сохранится в журнале, но её сумма перестанет участвовать в итогах.</p></div>
        <label className="span-2"><span>Причина отмены</span><textarea required minLength={3} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Назад</button><button className="button primary"><Ban size={15} /> Подтвердить отмену</button></div>
      </form>
    </Modal>
  );
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

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

function receiptFileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".0", "")} МБ`;
}

function receiptCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} чеков`;
  if (last === 1) return `${count} чек`;
  if (last >= 2 && last <= 4) return `${count} чека`;
  return `${count} чеков`;
}
