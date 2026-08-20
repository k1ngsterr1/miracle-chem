import { useMemo, useState } from "react";
import {
  Ban,
  CircleDollarSign,
  FileText,
  Landmark,
  Plus,
  ReceiptText,
  Search,
  WalletCards,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import type {
  Expense,
  ExpenseCategory,
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
  const [from, setFrom] = useState(() => monthStart());
  const [to, setTo] = useState(() => localDate());
  const [category, setCategory] = useState<ExpenseCategory | "ALL">("ALL");
  const [status, setStatus] = useState<ExpenseStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Expense | null>(null);
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
        actions={<button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Добавить расход</button>}
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
          <div className="data-table-wrap">
            <table className="data-table expense-table">
              <thead><tr><th>Документ</th><th>Дата</th><th>Категория</th><th>Центр затрат</th><th>Контрагент</th><th>Способ оплаты</th><th>Сумма</th><th>Статус</th></tr></thead>
              <tbody>{data.items.map((expense) => (
                <tr key={expense.id} onClick={() => setSelected(expense)}>
                  <td><strong>{expense.number}</strong><small>{expense.description}</small></td>
                  <td>{formatDate(expense.incurredAt, true)}</td>
                  <td><span className={`expense-category expense-category-${expense.category.toLowerCase()}`}>{CATEGORY_LABELS[expense.category]}</span></td>
                  <td>{COST_CENTER_LABELS[expense.costCenter]}</td>
                  <td>{expense.counterparty ?? "—"}</td>
                  <td>{PAYMENT_LABELS[expense.paymentMethod]}</td>
                  <td><strong>{formatMoney(expense.amount, expense.currency)}</strong></td>
                  <td><StatusBadge status={expense.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      {createOpen ? <CreateExpenseModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await expenses.reload(); }} /> : null}
      {selected === null ? null : <ExpenseDetail expense={selected} onClose={() => setSelected(null)} onCancelled={async () => { setSelected(null); await expenses.reload(); }} />}
    </>
  );
}

function CreateExpenseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({
    category: "LOGISTICS" as ExpenseCategory,
    costCenter: "LOGISTICS" as ExpenseCostCenter,
    paymentMethod: "BANK_TRANSFER" as ExpensePaymentMethod,
    incurredAt: localDateTime(),
    amount: "",
    currency: "KZT",
    description: "",
    counterparty: "",
    documentNumber: "",
    note: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiMutation("/expenses", {
        ...form,
        incurredAt: new Date(form.incurredAt).toISOString(),
        counterparty: form.counterparty || undefined,
        documentNumber: form.documentNumber || undefined,
        note: form.note || undefined,
      }, { idempotent: true });
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить расход");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Новый расход" onClose={onClose} wide>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <div className="form-field"><span>Категория</span><CustomSelect ariaLabel="Категория нового расхода" value={form.category} onChange={(value) => setForm({ ...form, category: value as ExpenseCategory })} options={CATEGORY_OPTIONS} /></div>
        <div className="form-field"><span>Центр затрат</span><CustomSelect ariaLabel="Центр затрат" value={form.costCenter} onChange={(value) => setForm({ ...form, costCenter: value as ExpenseCostCenter })} options={COST_CENTER_OPTIONS} /></div>
        <div className="form-field"><span>Дата и время</span><DateTimePicker ariaLabel="Дата и время расхода" value={form.incurredAt} onChange={(value) => setForm({ ...form, incurredAt: value })} /></div>
        <div className="form-field"><span>Способ оплаты</span><CustomSelect ariaLabel="Способ оплаты расхода" value={form.paymentMethod} onChange={(value) => setForm({ ...form, paymentMethod: value as ExpensePaymentMethod })} options={PAYMENT_OPTIONS} /></div>
        <label><span>Сумма</span><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
        <label><span>Валюта</span><input required minLength={3} maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label>
        <label className="span-2"><span>Назначение расхода</span><input required minLength={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Например, доставка цемента на площадку" /></label>
        <label><span>Контрагент</span><input value={form.counterparty} onChange={(event) => setForm({ ...form, counterparty: event.target.value })} /></label>
        <label><span>Номер счёта / акта</span><input value={form.documentNumber} onChange={(event) => setForm({ ...form, documentNumber: event.target.value })} /></label>
        <label className="span-2"><span>Комментарий</span><textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary" disabled={saving}><ReceiptText size={16} /> {saving ? "Сохраняем…" : "Учесть расход"}</button></div>
      </form>
    </Modal>
  );
}

function ExpenseDetail({ expense, onClose, onCancelled }: { expense: Expense; onClose: () => void; onCancelled: () => Promise<void> }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  return (
    <Modal title={expense.number} onClose={onClose} wide>
      <div className="expense-detail-hero">
        <div><StatusBadge status={expense.status} /><h3>{expense.description}</h3><p>{CATEGORY_LABELS[expense.category]} · {COST_CENTER_LABELS[expense.costCenter]}</p></div>
        <strong>{formatMoney(expense.amount, expense.currency)}</strong>
      </div>
      <div className="detail-facts expense-detail-facts">
        <span><small>Дата расхода</small><strong>{formatDate(expense.incurredAt, true)}</strong></span>
        <span><small>Контрагент</small><strong>{expense.counterparty ?? "—"}</strong></span>
        <span><small>Оплата</small><strong>{PAYMENT_LABELS[expense.paymentMethod]}</strong></span>
        <span><small>Документ</small><strong>{expense.documentNumber ?? "—"}</strong></span>
        <span><small>Создал</small><strong>{expense.createdBy.name}</strong></span>
      </div>
      {expense.note === null ? null : <div className="expense-note"><FileText size={16} /><div><strong>Комментарий</strong><p>{expense.note}</p></div></div>}
      {expense.status === "CANCELLED" ? (
        <div className="expense-cancelled"><Ban size={17} /><div><strong>Расход отменён</strong><p>{expense.cancellationReason} · {expense.cancelledAt === null ? "" : formatDate(expense.cancelledAt, true)}</p></div></div>
      ) : (
        <div className="modal-actions expense-detail-actions"><button className="button ghost" onClick={() => setCancelOpen(true)}><Ban size={15} /> Отменить запись</button></div>
      )}
      {cancelOpen ? <CancelExpenseModal expense={expense} onClose={() => setCancelOpen(false)} onCancelled={onCancelled} /> : null}
    </Modal>
  );
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

function localDateTime(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
