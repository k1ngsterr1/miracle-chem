import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Ban,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  CopyPlus,
  FilePlus2,
  FileDown,
  FileSignature,
  FileText,
  Plus,
  ReceiptText,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { apiFetch, apiMutation, apiUrl } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import { useDateFilter } from "../hooks/use-date-filter.js";
import { oneCDocumentStatus, sourceMoney, sumSourceDecimals } from "../hooks/use-one-c-source.js";
import { useMobileLayout } from "../hooks/use-mobile-layout.js";
import { formatDate, formatMoney, formatNumber } from "../lib/format.js";
import type {
  AccountingDocument,
  AccountingDocumentStatus,
  AccountingDocumentType,
  AccountingResponse,
  MetaData,
  Transfer,
} from "../types.js";
import type { HistoricalSale } from "../types/historical.js";
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, Panel, StatusBadge } from "../components/ui.js";

const TYPE_LABELS: Record<AccountingDocumentType, string> = {
  WAYBILL: "Накладная",
  PAYMENT_INVOICE: "Счёт на оплату",
  COMPLETION_ACT: "Акт выполненных работ",
  POWER_OF_ATTORNEY: "Доверенность на получение товара",
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));
const TYPE_FILTER_OPTIONS = [{ value: "ALL", label: "Все документы" }, ...TYPE_OPTIONS];
const STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "Все статусы" },
  { value: "DRAFT", label: "Черновик" },
  { value: "PENDING_DIRECTOR_APPROVAL", label: "На согласовании у руководителя" },
  { value: "PENDING_ACCOUNTANT_APPROVAL", label: "На проверке у бухгалтера" },
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
  { value: "M", label: "м" },
  { value: "PAIR", label: "пар" },
];

interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

interface OneCFinance {
  available: boolean;
  snapshotAt?: string;
  totalReceivables?: string;
  totalPrepayments?: string;
  receivedPayments?: string;
  paidPayments?: string;
  receivables?: Array<{ counterparty: string; amount: string; currency: string }>;
  incomingPayments?: Array<FinancePayment>;
  outgoingPayments?: Array<FinancePayment>;
}

interface FinancePayment {
  externalId: string;
  number: string;
  documentAt: string;
  counterparty: string;
  amount: string;
  currency: string;
  purpose?: string;
  posted: boolean;
  deleted: boolean;
}

const almatyDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
});

function paymentDate(value: string): string {
  const parts = almatyDay.formatToParts(new Date(value));
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function paymentTotal(rows: Array<FinancePayment & { direction: "Поступление" | "Оплата" }>, direction: "Поступление" | "Оплата"): string {
  const currencies = new Map<string, string[]>();
  for (const row of rows) {
    if (row.direction !== direction || !row.posted || row.deleted) continue;
    const currency = ["тенге", "тг", "₸", "kzt"].includes(row.currency.toLocaleLowerCase("ru")) ? "KZT" : row.currency;
    const amounts = currencies.get(currency) ?? [];
    amounts.push(row.amount);
    currencies.set(currency, amounts);
  }
  return currencies.size === 0 ? sourceMoney("0", "KZT") : [...currencies]
    .map(([currency, amounts]) => sourceMoney(sumSourceDecimals(amounts), currency)).join(" · ");
}

export function AccountingPage({ actorRole }: { actorRole: string | undefined }) {
  const mobileLayout = useMobileLayout();
  const { selectedDate, allDates } = useDateFilter();
  const [from, setFrom] = useState(() => monthStart());
  const [to, setTo] = useState(() => localDate());
  const [type, setType] = useState<AccountingDocumentType | "ALL">("ALL");
  const [status, setStatus] = useState<AccountingDocumentStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<AccountingDocumentType | undefined>();
  const [template, setTemplate] = useState<AccountingDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => window.location.hash.startsWith("#accounting/")
    ? window.location.hash.slice("#accounting/".length) || null : null);
  const [selectedPayment, setSelectedPayment] = useState<(FinancePayment & { direction: "Поступление" | "Оплата" }) | null>(null);
  const [selectedWorkbookSale, setSelectedWorkbookSale] = useState<HistoricalSale | null>(null);
  const [showDebtors, setShowDebtors] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => {
    setFrom(selectedDate);
    setTo(selectedDate);
  }, [selectedDate, allDates]);
  useEffect(() => setVisibleCount(50), [allDates, from, query, status, to, type]);
  const params = useMemo(() => {
    const search = new URLSearchParams(allDates ? {} : { from: dayStartIso(from), to: dayEndIso(to) });
    if (type !== "ALL") search.set("type", type);
    if (status !== "ALL") search.set("status", status);
    if (query.trim() !== "") search.set("search", query.trim());
    return search.toString();
  }, [allDates, from, to, query, status, type]);
  const documents = useApi<AccountingResponse>(`/accounting?${params}`);
  const workbookSales = useApi<{ items: HistoricalSale[] }>(allDates
    ? "/historical-workbooks/sales" : `/historical-workbooks/sales?from=${from}&to=${to}`);
  const oneCFinance = useApi<OneCFinance>(["ADMIN", "DIRECTOR", "ACCOUNTANT"].includes(actorRole ?? "")
    ? "/integrations/1c/finance" : null);
  const datedPayments = useMemo(() => [
    ...(oneCFinance.data?.incomingPayments ?? []).map((value) => ({ ...value, direction: "Поступление" as const })),
    ...(oneCFinance.data?.outgoingPayments ?? []).map((value) => ({ ...value, direction: "Оплата" as const })),
  ].filter((payment) => allDates || paymentDate(payment.documentAt) >= from && paymentDate(payment.documentAt) <= to),
  [allDates, from, oneCFinance.data, to]);
  const payments = useMemo(() => {
    if (!oneCFinance.data?.available || type !== "ALL" || status !== "ALL") return [];
    const normalized = query.trim().toLocaleLowerCase("ru");
    return datedPayments.filter((payment) => [payment.number, payment.counterparty, payment.purpose ?? "", payment.direction]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalized)));
  }, [datedPayments, oneCFinance.data, query, status, type]);
  const paymentTotals = useMemo(() => ({
    incoming: paymentTotal(datedPayments, "Поступление"),
    outgoing: paymentTotal(datedPayments, "Оплата"),
  }), [datedPayments]);
  const historicalSales = useMemo(() => {
    if (type !== "ALL" || status !== "ALL") return [];
    const needle = query.trim().toLocaleLowerCase("ru");
    return (workbookSales.data?.items ?? []).filter((sale) => [sale.customer, sale.date, sale.fileName]
      .some((value) => value.toLocaleLowerCase("ru").includes(needle)));
  }, [query, status, type, workbookSales.data]);
  const journal = useMemo(() => [
    ...(documents.data?.items ?? []).map((value) => ({ kind: "document" as const, value, date: value.documentAt })),
    ...payments.map((value) => ({ kind: "payment" as const, value, date: value.documentAt })),
    ...historicalSales.map((value) => ({ kind: "historical-sale" as const, value, date: `${value.date}T12:00:00.000Z` })),
  ].sort((a, b) => b.date.localeCompare(a.date)), [documents.data, historicalSales, payments]);

  if (documents.loading) return <LoadingState />;
  if (documents.error !== null) return <ErrorState message={documents.error} retry={documents.reload} />;
  const data = documents.data ?? { items: [], summary: { totals: [], byStatus: [], byType: [] } };
  const total = data.summary.totals.find((item) => item.currency === "KZT") ?? data.summary.totals[0];

  return (
    <>
      <PageHeader
        title="Бухгалтерия"
        actions={<>{canCreateDocuments(actorRole) ? <button className="button ghost" onClick={() => { setTemplate(null); setCreateType("POWER_OF_ATTORNEY"); setCreateOpen(true); }}><FileSignature size={17} /> Доверенность</button> : null}{canCreateDocuments(actorRole) ? <button className="button primary" onClick={() => { setTemplate(null); setCreateType(undefined); setCreateOpen(true); }}><Plus size={17} /> Новый документ</button> : null}</>}
      />

      <div className="accounting-summary">
        <Panel><span><BadgeDollarSign size={19} /></span><div><strong>{total === undefined ? formatMoney(0) : formatMoney(total.amount, total.currency)}</strong><small>сумма документов</small></div></Panel>
        <Panel><button type="button" className="accounting-kpi-button" onClick={() => setShowDebtors(true)} disabled={!oneCFinance.data?.available}><span className="amber"><FileText size={19} /></span><span><strong>{oneCFinance.data?.available ? sourceMoney(oneCFinance.data.totalReceivables ?? "0", "KZT") : "—"}</strong><small>дебиторка на дату снимка</small></span></button></Panel>
        <Panel><span className="blue"><Send size={19} /></span><div><strong title={paymentTotals.incoming}>{oneCFinance.data?.available ? paymentTotals.incoming : "—"}</strong><small>поступило платежей</small></div></Panel>
        <Panel><span className="green"><CheckCircle2 size={19} /></span><div><strong title={paymentTotals.outgoing}>{oneCFinance.data?.available ? paymentTotals.outgoing : "—"}</strong><small>оплачено поставщикам</small></div></Panel>
      </div>
      {oneCFinance.error !== null ? <p className="inline-load-error" role="alert">Не удалось загрузить часть финансовых данных. <button type="button" onClick={() => void oneCFinance.reload()}>Повторить</button></p> : null}
      {workbookSales.error !== null ? <p className="inline-load-error" role="alert">Не удалось загрузить реализации из Excel. <button type="button" onClick={() => void workbookSales.reload()}>Повторить</button></p> : null}

      <Panel className="accounting-filter-panel">
        <div className="accounting-filters">
          {allDates ? <div className="form-field"><span>Период</span><strong className="all-dates-value">Все даты</strong></div> : <>
            <div className="form-field"><span>С даты</span><DateTimePicker mode="date" ariaLabel="Начало периода бухгалтерии" value={from} onChange={setFrom} /></div>
            <div className="form-field"><span>По дату</span><DateTimePicker mode="date" ariaLabel="Конец периода бухгалтерии" value={to} onChange={setTo} /></div>
          </>}
          <div className="form-field"><span>Тип документа</span><CustomSelect ariaLabel="Тип бухгалтерского документа" value={type} onChange={(value) => setType(value as AccountingDocumentType | "ALL")} options={TYPE_FILTER_OPTIONS} /></div>
          <div className="form-field"><span>Статус</span><CustomSelect ariaLabel="Статус бухгалтерского документа" value={status} onChange={(value) => setStatus(value as AccountingDocumentStatus | "ALL")} options={STATUS_FILTER_OPTIONS} /></div>
          <label className="expense-search"><span>Поиск</span><span><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, контрагент, основание…" /></span></label>
        </div>
      </Panel>

      <Panel className="table-panel">
        <div className="table-toolbar"><div><h2>Журнал операций</h2></div><span className="expense-count">{journal.length} записей</span></div>
        {journal.length === 0 ? <EmptyState title="Записей за период нет" text="Измените фильтры или создайте первый бухгалтерский документ." /> : (
          <>
          <div className="data-table-wrap desktop-document-table">
            <table className="data-table accounting-table">
              <thead><tr><th>Документ</th><th>Дата</th><th>Контрагент</th><th>Основание</th><th>Без НДС</th><th>НДС</th><th>Итого</th><th>Статус</th><th aria-label="Открыть" /></tr></thead>
              <tbody>{journal.slice(0, visibleCount).map((entry) => entry.kind === "document" ? (
                <tr key={`document:${entry.value.id}`} onClick={() => setSelectedId(entry.value.id)}>
                  <td><strong>{entry.value.number}</strong><small>{TYPE_LABELS[entry.value.type]}</small></td>
                  <td>{formatDate(entry.value.documentAt)}</td>
                  <td>{entry.value.counterparty}</td>
                  <td>{entry.value.basis ?? "—"}</td>
                  <td>{formatMoney(entry.value.subtotal, entry.value.currency)}</td>
                  <td>{formatMoney(entry.value.vatAmount, entry.value.currency)}</td>
                  <td><strong>{formatMoney(entry.value.totalAmount, entry.value.currency)}</strong></td>
                  <td><StatusBadge status={entry.value.status} /></td>
                  <td><button type="button" className="row-action" aria-label={`Открыть ${entry.value.number}`}><ChevronRight size={16} /></button></td>
                </tr>
              ) : entry.kind === "payment" ? <tr key={`payment:${entry.value.direction}:${entry.value.externalId}`} onClick={() => setSelectedPayment(entry.value)}>
                <td><strong>{entry.value.number}</strong><small>{entry.value.direction}</small></td>
                <td>{formatDate(entry.value.documentAt)}</td>
                <td>{entry.value.counterparty}</td>
                <td>{entry.value.purpose || "—"}</td><td>—</td><td>—</td>
                <td><strong>{sourceMoney(entry.value.amount, entry.value.currency)}</strong></td>
                <td><span className="soft-tag">{oneCDocumentStatus(entry.value.posted, entry.value.deleted)}</span></td>
                <td><button type="button" className="row-action" aria-label={`Открыть платёж ${entry.value.number}`}><ChevronRight size={16} /></button></td>
              </tr> : <tr key={`historical-sale:${entry.value.id}`} onClick={() => setSelectedWorkbookSale(entry.value)}>
                <td><strong>Реализация</strong><small>По Excel</small></td>
                <td>{formatDate(entry.date)}</td><td>{entry.value.customer}</td>
                <td>{formatNumber(entry.value.quantityM3)} м³{entry.value.unitPrice === null ? "" : ` · цена ${formatNumber(entry.value.unitPrice)}`}</td>
                <td>—</td><td>—</td><td><strong>{entry.value.total === null ? "—" : formatNumber(entry.value.total)}</strong></td>
                <td><span className="soft-tag">Для сверки</span></td><td><ChevronRight size={16} /></td>
              </tr>)}</tbody>
            </table>
          </div>
          {mobileLayout ? <div className="mobile-document-cards" aria-label="Журнал бухгалтерских документов">
            {journal.slice(0, visibleCount).map((entry) => entry.kind === "document" ? <button type="button" className="mobile-document-card" key={`document:${entry.value.id}`} onClick={() => setSelectedId(entry.value.id)}>
                <div className="mobile-document-card-head"><span>{TYPE_LABELS[entry.value.type]}</span><StatusBadge status={entry.value.status} /></div>
                <strong>{entry.value.number}</strong><small>{entry.value.customer?.name ?? entry.value.counterparty}</small>
                <div className="mobile-document-card-meta"><span>{formatDate(entry.value.documentAt)}</span><span>{entry.value.basis ?? "Без основания"}</span></div>
                <div className="mobile-document-card-footer"><strong>{formatMoney(entry.value.totalAmount, entry.value.currency)}</strong><span>{entry.value.dueAt === null ? "Без срока" : `до ${formatDate(entry.value.dueAt)}`}</span></div>
              </button> : entry.kind === "payment" ? <button type="button" className="mobile-document-card" key={`payment:${entry.value.direction}:${entry.value.externalId}`} onClick={() => setSelectedPayment(entry.value)}>
                <div className="mobile-document-card-head"><span>{entry.value.direction}</span><span className="soft-tag">{oneCDocumentStatus(entry.value.posted, entry.value.deleted)}</span></div>
                <strong>{entry.value.number}</strong><small>{entry.value.counterparty}</small>
                <div className="mobile-document-card-meta"><span>{formatDate(entry.value.documentAt)}</span><span>{entry.value.purpose || "Без назначения"}</span></div>
                <div className="mobile-document-card-footer"><strong>{sourceMoney(entry.value.amount, entry.value.currency)}</strong></div>
              </button> : <button type="button" className="mobile-document-card" key={`historical-sale:${entry.value.id}`} onClick={() => setSelectedWorkbookSale(entry.value)}>
                <div className="mobile-document-card-head"><span>Реализация по Excel</span><span className="soft-tag">Для сверки</span></div>
                <strong>{entry.value.customer}</strong><small>{formatNumber(entry.value.quantityM3)} м³</small>
                <div className="mobile-document-card-meta"><span>{formatDate(entry.date)}</span></div>
                <div className="mobile-document-card-footer"><strong>{entry.value.total === null ? "—" : formatNumber(entry.value.total)}</strong></div>
              </button>)}
          </div> : null}
          {journal.length > visibleCount ? <div className="journal-more"><button type="button" className="button ghost small" onClick={() => setVisibleCount((count) => count + 50)}>Показать ещё</button></div> : null}
          {allDates && data.items.length >= 500 ? <p className="history-limit-note">Лимит списка — 500 записей. Для поиска более ранних выберите дату.</p> : null}
          </>
        )}
      </Panel>

      {createOpen ? <CreateAccountingModal initialType={createType} template={template} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); setTemplate(null); await documents.reload(); }} /> : null}
      {selectedId === null ? null : <AccountingDetail id={selectedId} actorRole={actorRole} onClose={() => { setSelectedId(null); if (window.location.hash.startsWith("#accounting/")) window.location.hash = "accounting"; }} onChanged={documents.reload} onDuplicate={(document) => { setSelectedId(null); setCreateType(document.type); setTemplate(document); setCreateOpen(true); }} />}
      {selectedPayment ? <Modal title={`${selectedPayment.direction} №${selectedPayment.number}`} onClose={() => setSelectedPayment(null)}>
        <div className="imported-record-detail"><p>{formatDate(selectedPayment.documentAt, true)} · {oneCDocumentStatus(selectedPayment.posted, selectedPayment.deleted)}</p>
          <div><strong>Контрагент</strong><span>{selectedPayment.counterparty}</span></div>
          <div><strong>Сумма</strong><span>{sourceMoney(selectedPayment.amount, selectedPayment.currency)}</span></div>
          {selectedPayment.purpose ? <div><strong>Назначение</strong><span>{selectedPayment.purpose}</span></div> : null}
          <p className="imported-record-note">Запись доступна только для просмотра.</p></div>
      </Modal> : null}
      {selectedWorkbookSale ? <Modal title={`Реализация ${selectedWorkbookSale.customer}`} onClose={() => setSelectedWorkbookSale(null)}>
        <div className="imported-record-detail"><p>{selectedWorkbookSale.date} · {formatNumber(selectedWorkbookSale.quantityM3)} м³</p>
          {selectedWorkbookSale.unitPrice === null ? null : <div><strong>Цена</strong><span>{formatNumber(selectedWorkbookSale.unitPrice)}</span></div>}
          {selectedWorkbookSale.total === null ? null : <div><strong>Сумма по отчёту</strong><span>{formatNumber(selectedWorkbookSale.total)}</span></div>}
          {selectedWorkbookSale.acceptedQuantity === null ? null : <div><strong>Принято</strong><span>{formatNumber(selectedWorkbookSale.acceptedQuantity)} м³</span></div>}
          <p className="imported-record-note">{selectedWorkbookSale.fileName} · лист «{selectedWorkbookSale.sourceSheet}», строка {selectedWorkbookSale.sourceRows[0]}. Это не счёт, не платёж и не дебиторская задолженность: номера документа и валюта в файле не указаны.</p>
        </div>
      </Modal> : null}
      {showDebtors && oneCFinance.data?.available ? <Modal title="Дебиторская задолженность" onClose={() => setShowDebtors(false)}>
        <div className="imported-record-detail"><p>Состояние на {formatDate(oneCFinance.data.snapshotAt ?? "", true)} · авансы клиентов: {sourceMoney(oneCFinance.data.totalPrepayments ?? "0", "KZT")}</p>
          {(oneCFinance.data.receivables ?? []).length === 0 ? <p>Задолженности нет</p> : oneCFinance.data.receivables?.map((row) =>
            <div key={row.counterparty}><strong>{row.counterparty}</strong><span>{sourceMoney(row.amount, row.currency)}</span></div>)}
        </div>
      </Modal> : null}
    </>
  );
}

function CreateAccountingModal({ initialType, template, onClose, onCreated }: { initialType: AccountingDocumentType | undefined; template: AccountingDocument | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const meta = useApi<MetaData>("/meta");
  const transfers = useApi<{ items: Transfer[] }>("/transfers");
  const [form, setForm] = useState(() => accountingDraftFromTemplate(template, initialType));
  const [items, setItems] = useState<DraftLine[]>(() => accountingItemsFromTemplate(template));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPowerOfAttorney = form.type === "POWER_OF_ATTORNEY";
  const isSalesDocument = form.type === "WAYBILL" || form.type === "PAYMENT_INVOICE" || form.type === "COMPLETION_ACT";
  const customerOptions = (meta.data?.customers ?? []).map((customer) => ({
    value: customer.id,
    label: customer.name,
    description: [customer.taxId, customer.contactPerson, customer.contractNumber === null ? null : `договор ${customer.contractNumber}`, customer.paymentTermDays === null ? null : `${customer.paymentTermDays} дн.`].filter(Boolean).join(" · ") || "Клиент",
  }));
  const transferOptions = (transfers.data?.items ?? [])
    .filter((transfer) => transfer.customer !== null && (form.customerId === "" || transfer.customerId === form.customerId))
    .map((transfer) => ({ value: transfer.id, label: `${transfer.number} · ${transfer.customer?.name ?? "Клиент"}`, description: `${formatDate(transfer.transferAt)} · ${formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.requestedQuantity), 0))} ${unitName(transfer.items[0]?.unit ?? "M3")}` }));
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const vatAmount = subtotal * Number(form.vatRate || 0) / 100;

  function selectCustomer(customerId: string): void {
    const customer = meta.data?.customers.find((item) => item.id === customerId);
    setForm((current) => ({
      ...current,
      customerId,
      transferId: "",
      basis: current.basis === "" && customer?.contractNumber !== null && customer?.contractNumber !== undefined
        ? `Договор №${customer.contractNumber}`
        : current.basis,
      dueAt: current.dueAt === "" && customer?.paymentTermDays !== null && customer?.paymentTermDays !== undefined && current.documentAt !== ""
        ? addDays(current.documentAt, customer.paymentTermDays)
        : current.dueAt,
    }));
  }

  function selectDocumentDate(documentAt: string): void {
    const customer = meta.data?.customers.find((item) => item.id === form.customerId);
    setForm((current) => ({
      ...current,
      documentAt,
      dueAt: current.dueAt === "" && customer?.paymentTermDays !== null && customer?.paymentTermDays !== undefined
        ? addDays(documentAt, customer.paymentTermDays)
        : current.dueAt,
    }));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (form.type === "" || form.documentAt === "" || (isSalesDocument && form.customerId === "") || (!isSalesDocument && form.counterparty.trim() === "")) {
      setError(isSalesDocument ? "Заполните тип, дату и клиента" : "Заполните тип, дату и контрагента");
      return;
    }
    if (!isPowerOfAttorney && form.currency.length !== 3) {
      setError("Укажите трёхбуквенный код валюты");
      return;
    }
    if (isPowerOfAttorney && (
      form.dueAt === ""
      || form.representativeName.trim() === ""
      || form.identityDocument.trim() === ""
      || form.identityIssuedBy.trim() === ""
      || form.identityIssuedAt === ""
    )) {
      setError("Заполните срок действия и обязательные данные доверенного лица");
      return;
    }
    if (items.some((item) => item.description.trim() === "" || item.quantity === "" || item.unit === "" || (!isPowerOfAttorney && item.unitPrice === ""))) {
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
        customerId: isSalesDocument ? form.customerId : undefined,
        transferId: isSalesDocument && form.transferId !== "" ? form.transferId : undefined,
        counterparty: isSalesDocument ? undefined : form.counterparty,
        counterpartyTaxId: isSalesDocument ? undefined : form.counterpartyTaxId || undefined,
        basis: form.basis || undefined,
        vatRate: isPowerOfAttorney ? undefined : form.vatRate || undefined,
        currency: isPowerOfAttorney ? undefined : form.currency,
        powerOfAttorney: isPowerOfAttorney ? {
          representativeName: form.representativeName,
          representativePosition: form.representativePosition || undefined,
          representativeIin: form.representativeIin || undefined,
          identityDocument: form.identityDocument,
          identityIssuedBy: form.identityIssuedBy,
          identityIssuedAt: new Date(form.identityIssuedAt).toISOString(),
        } : undefined,
        notes: form.notes || undefined,
        items: items.map(({ key: _key, ...item }) => ({ ...item, unitPrice: isPowerOfAttorney ? "0" : item.unitPrice })),
      }, { idempotent: true });
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать документ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={template === null ? (isPowerOfAttorney ? "Новая доверенность на получение товара" : "Новый бухгалтерский документ") : `Создать на основе ${template.number}`} onClose={onClose} wide>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <div className="form-field"><span>Тип документа</span><CustomSelect required ariaLabel="Тип нового бухгалтерского документа" value={form.type} onChange={(type) => setForm({ ...form, type })} options={TYPE_OPTIONS} /></div>
          <label><span>Номер</span><input value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} placeholder="Сформируется автоматически" /></label>
          <div className="form-field"><span>Дата документа <b>*</b></span><DateTimePicker required mode="date" ariaLabel="Дата бухгалтерского документа" value={form.documentAt} onChange={selectDocumentDate} /></div>
          <div className="form-field"><span>{isPowerOfAttorney ? "Действительна до" : "Срок оплаты"}</span><DateTimePicker required={isPowerOfAttorney} mode="date" ariaLabel={isPowerOfAttorney ? "Срок действия доверенности" : "Срок оплаты документа"} value={form.dueAt} onChange={(dueAt) => setForm({ ...form, dueAt })} align="right" /></div>
          {isSalesDocument ? <div className="form-field span-2"><span>Клиент <b>*</b></span><CustomSelect required ariaLabel="Клиент бухгалтерского документа" value={form.customerId} onChange={selectCustomer} options={customerOptions} placeholder="Выберите клиента" /></div> : <><label><span>Поставщик <b>*</b></span><input required value={form.counterparty} onChange={(event) => setForm({ ...form, counterparty: event.target.value })} /></label><label><span>БИН / ИИН</span><input value={form.counterpartyTaxId} onChange={(event) => setForm({ ...form, counterpartyTaxId: event.target.value })} /></label></>}
          {isSalesDocument ? <div className="form-field span-2"><span>Связанная отгрузка</span><CustomSelect ariaLabel="Связанная отгрузка" value={form.transferId} onChange={(transferId) => {
            const transfer = transfers.data?.items.find((item) => item.id === transferId);
            setForm({ ...form, transferId, customerId: transfer?.customerId ?? form.customerId, basis: transfer === undefined ? form.basis : `Отгрузка №${transfer.number}` });
            if (transfer !== undefined) setItems(transfer.items.map((item) => ({ key: crypto.randomUUID(), description: `${item.productLot.concreteGrade} · партия ${item.productLot.number}`, quantity: item.requestedQuantity, unit: item.unit, unitPrice: "" })));
          }} options={transferOptions} placeholder="Необязательно: заполнит позиции" /></div> : null}
          <label className="span-2"><span>{isPowerOfAttorney ? "Основание получения" : "Основание"}</span><input value={form.basis} onChange={(event) => setForm({ ...form, basis: event.target.value })} placeholder={isPowerOfAttorney ? "Договор, счёт или заказ поставщику" : isSalesDocument ? "Договор или заказ клиента" : undefined} /></label>
          {isPowerOfAttorney ? null : <><label><span>НДС, %</span><input type="number" min="0" step="0.01" value={form.vatRate} onChange={(event) => setForm({ ...form, vatRate: event.target.value })} /></label><label><span>Валюта</span><input required minLength={3} maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label></>}
        </div>

        {isPowerOfAttorney ? <>
          <div className="section-title accounting-lines-title"><h3>Доверенное лицо</h3><span>обязательные данные для печатной формы</span></div>
          <div className="form-grid power-attorney-fields">
            <label><span>Ф.И.О.</span><input required value={form.representativeName} onChange={(event) => setForm({ ...form, representativeName: event.target.value })} /></label>
            <label><span>Должность</span><input value={form.representativePosition} onChange={(event) => setForm({ ...form, representativePosition: event.target.value })} /></label>
            <label><span>ИИН</span><input value={form.representativeIin} onChange={(event) => setForm({ ...form, representativeIin: event.target.value })} /></label>
            <label><span>Удостоверение / паспорт</span><input required value={form.identityDocument} onChange={(event) => setForm({ ...form, identityDocument: event.target.value })} placeholder="№ документа" /></label>
            <label><span>Кем выдан</span><input required value={form.identityIssuedBy} onChange={(event) => setForm({ ...form, identityIssuedBy: event.target.value })} /></label>
            <div className="form-field"><span>Дата выдачи</span><DateTimePicker required mode="date" ariaLabel="Дата выдачи удостоверения личности" value={form.identityIssuedAt} onChange={(identityIssuedAt) => setForm({ ...form, identityIssuedAt })} /></div>
          </div>
        </> : null}

        <div className="section-title accounting-lines-title"><h3>{isPowerOfAttorney ? "Товары к получению" : "Позиции документа"}</h3><button type="button" className="button ghost small" onClick={() => setItems([...items, { key: crypto.randomUUID(), description: "", quantity: "", unit: "", unitPrice: "" }])}><Plus size={15} /> Добавить позицию</button></div>
        <div className={`accounting-lines ${isPowerOfAttorney ? "power-attorney-lines" : ""}`}>
          {items.map((item) => (
            <div key={item.key}>
              <label><span>Наименование</span><input required value={item.description} onChange={(event) => setItems(items.map((row) => row.key === item.key ? { ...row, description: event.target.value } : row))} /></label>
              <label><span>Количество</span><input required type="number" min="0.000001" step="0.001" value={item.quantity} onChange={(event) => setItems(items.map((row) => row.key === item.key ? { ...row, quantity: event.target.value } : row))} /></label>
              <div className="form-field"><span>Единица</span><CustomSelect required ariaLabel="Единица позиции документа" value={item.unit} onChange={(unit) => setItems(items.map((row) => row.key === item.key ? { ...row, unit } : row))} options={DOCUMENT_UNIT_OPTIONS} /></div>
              {isPowerOfAttorney ? null : <label><span>Цена</span><input required type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => setItems(items.map((row) => row.key === item.key ? { ...row, unitPrice: event.target.value } : row))} /></label>}
              <button type="button" className="row-action danger" aria-label="Удалить позицию" disabled={items.length === 1} onClick={() => setItems(items.filter((row) => row.key !== item.key))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        {isPowerOfAttorney ? null : <div className="accounting-calculation"><span><small>Без НДС</small><strong>{formatMoney(subtotal, form.currency || "KZT")}</strong></span><span><small>НДС</small><strong>{formatMoney(vatAmount, form.currency || "KZT")}</strong></span><span><small>Итого</small><strong>{formatMoney(subtotal + vatAmount, form.currency || "KZT")}</strong></span></div>}
        <label className="full-label"><span>Комментарий</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        {error === null ? null : <div className="form-error modal-inline-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary" disabled={saving}><FilePlus2 size={16} /> {saving ? "Сохраняем…" : isPowerOfAttorney ? "Создать доверенность" : "Создать документ"}</button></div>
      </form>
    </Modal>
  );
}

function AccountingDetail({ id, actorRole, onClose, onChanged, onDuplicate }: { id: string; actorRole: string | undefined; onClose: () => void; onChanged: () => Promise<void>; onDuplicate: (document: AccountingDocument) => void }) {
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
  const isPowerOfAttorney = document.type === "POWER_OF_ATTORNEY";
  const isOneCDocument = document.details?.source === "1C";
  const hasPdf = true;
  const powerOfAttorney = document.details ?? {};
  return (
    <Modal title={document.number} onClose={onClose} wide>
      <div className="accounting-detail-hero"><div><StatusBadge status={document.status} /><span>{TYPE_LABELS[document.type]}</span><h3>{document.customer?.name ?? document.counterparty}</h3><p>{document.basis ?? "Без основания"}</p></div><strong>{isPowerOfAttorney ? `до ${document.dueAt === null ? "—" : formatDate(document.dueAt)}` : formatMoney(document.totalAmount, document.currency)}</strong></div>
      {isPowerOfAttorney ? <div className="detail-facts accounting-detail-facts power-attorney-detail-facts">
        <span><small>Дата выдачи</small><strong>{formatDate(document.documentAt)}</strong></span>
        <span><small>Доверенное лицо</small><strong>{powerOfAttorney.representativeName ?? "—"}</strong></span>
        <span><small>Должность</small><strong>{powerOfAttorney.representativePosition ?? "—"}</strong></span>
        <span><small>ИИН</small><strong>{powerOfAttorney.representativeIin ?? "—"}</strong></span>
        <span><small>Документ</small><strong>{powerOfAttorney.identityDocument ?? "—"}</strong></span>
        <span><small>Кем выдан</small><strong>{powerOfAttorney.identityIssuedBy ?? "—"}</strong></span>
      </div> : <div className="detail-facts accounting-detail-facts">
        <span><small>Дата</small><strong>{formatDate(document.documentAt)}</strong></span>
        <span><small>Срок оплаты</small><strong>{document.dueAt === null ? "—" : formatDate(document.dueAt)}</strong></span>
        <span><small>Без НДС</small><strong>{formatMoney(document.subtotal, document.currency)}</strong></span>
        <span><small>НДС {formatNumber(document.vatRate)}%</small><strong>{formatMoney(document.vatAmount, document.currency)}</strong></span>
        <span><small>Создал</small><strong>{document.createdBy.name}</strong></span>
        <span><small>Клиент</small><strong>{document.customer?.name ?? "—"}</strong></span>
      </div>}
      <div className="section-title"><h3>{isPowerOfAttorney ? "Товары к получению" : "Позиции"}</h3><span>{document.items.length}</span></div>
      <div className="accounting-detail-lines">{document.items.map((item) => <div key={item.id}><span><ReceiptText size={17} /></span><div><strong>{item.description}</strong><small>{formatNumber(item.quantity)} {unitName(item.unit)}{isPowerOfAttorney ? "" : ` × ${formatMoney(item.unitPrice, document.currency)}`}</small></div>{isPowerOfAttorney ? null : <strong>{formatMoney(item.amount, document.currency)}</strong>}</div>)}</div>
      {document.notes === null ? null : <div className="expense-note"><FileText size={16} /><div><strong>Комментарий</strong><p>{document.notes}</p></div></div>}
      {error === null ? null : <div className="form-error modal-inline-error">{error}</div>}
      <div className="workflow-actions">
        {!isOneCDocument ? <button className="button ghost" onClick={() => onDuplicate(document)}><CopyPlus size={16} /> Создать на основе</button> : null}
        {hasPdf ? <a className="button primary" href={apiUrl(`/accounting/${document.id}/pdf`)} target="_blank" rel="noreferrer"><FileDown size={16} /> Скачать PDF</a> : null}
        {!isOneCDocument && document.status === "DRAFT" && canIssueDirectly(actorRole) ? <button className="button primary" disabled={busy} onClick={() => void action(`/accounting/${document.id}/issue`)}><Send size={16} /> {isPowerOfAttorney ? "Выдать доверенность" : "Выпустить документ"}</button> : null}
        {!isOneCDocument && document.status === "DRAFT" && canSubmitForApproval(actorRole) ? <button className="button primary" disabled={busy} onClick={() => void action(`/accounting/${document.id}/submit`)}><Send size={16} /> {actorRole === "DIRECTOR" ? "Передать бухгалтеру" : "Отправить руководителю"}</button> : null}
        {!isOneCDocument && document.status === "PENDING_DIRECTOR_APPROVAL" && (actorRole === "DIRECTOR" || actorRole === "ADMIN") ? <button className="button primary" disabled={busy} onClick={() => void action(`/accounting/${document.id}/approve`)}><CheckCircle2 size={16} /> Согласовать и передать бухгалтеру</button> : null}
        {!isOneCDocument && document.status === "PENDING_ACCOUNTANT_APPROVAL" && (actorRole === "ACCOUNTANT" || actorRole === "ADMIN") ? <button className="button primary" disabled={busy} onClick={() => void action(`/accounting/${document.id}/approve`)}><CheckCircle2 size={16} /> Проверить и выпустить</button> : null}
        {!isOneCDocument && document.type === "PAYMENT_INVOICE" && document.status === "ISSUED" && canMarkPaid(actorRole) ? <button className="button primary" disabled={busy} onClick={() => void action(`/accounting/${document.id}/pay`)}><ClipboardCheck size={16} /> Отметить оплату</button> : null}
        {!isOneCDocument && ["DRAFT", "ISSUED"].includes(document.status) ? <button className="button ghost" disabled={busy} onClick={() => setCancelOpen(true)}><Ban size={16} /> Отменить документ</button> : null}
      </div>
      {cancelOpen ? <CancelAccountingModal onClose={() => setCancelOpen(false)} onConfirm={async (reason) => { setCancelOpen(false); await action(`/accounting/${document.id}/cancel`, { reason }); }} /> : null}
    </Modal>
  );
}

function accountingDraftFromTemplate(template: AccountingDocument | null, initialType: AccountingDocumentType | undefined) {
  const details = template?.details ?? {};
  return {
    type: template?.type ?? initialType ?? "",
    number: "",
    documentAt: "",
    dueAt: "",
    customerId: template?.customerId ?? "",
    transferId: "",
    counterparty: template?.customerId === null || template === null ? template?.counterparty ?? "" : "",
    counterpartyTaxId: template?.customerId === null || template === null ? template?.counterpartyTaxId ?? "" : "",
    basis: template?.basis ?? "",
    vatRate: template?.vatRate ?? "",
    currency: template?.currency ?? "",
    representativeName: details.representativeName ?? "",
    representativePosition: details.representativePosition ?? "",
    representativeIin: details.representativeIin ?? "",
    identityDocument: details.identityDocument ?? "",
    identityIssuedBy: details.identityIssuedBy ?? "",
    identityIssuedAt: "",
    notes: template?.notes ?? "",
  };
}

function accountingItemsFromTemplate(template: AccountingDocument | null): DraftLine[] {
  if (template === null || template.items.length === 0) {
    return [{ key: crypto.randomUUID(), description: "", quantity: "", unit: "", unitPrice: "" }];
  }
  return template.items.map((item) => ({
    key: crypto.randomUUID(),
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
  }));
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

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function canCreateDocuments(role?: string): boolean {
  return ["ADMIN", "DIRECTOR", "ACCOUNTANT", "MANAGER"].includes(role ?? "");
}

function canIssueDirectly(role?: string): boolean {
  return role === "ADMIN" || role === "ACCOUNTANT";
}

function canSubmitForApproval(role?: string): boolean {
  return role === "MANAGER" || role === "DIRECTOR";
}

function canMarkPaid(role?: string): boolean {
  return role === "ADMIN" || role === "DIRECTOR" || role === "ACCOUNTANT";
}
