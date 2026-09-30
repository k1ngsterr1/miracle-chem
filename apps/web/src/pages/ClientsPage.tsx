import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import {
  Building2,
  BadgeDollarSign,
  CircleDollarSign,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Factory,
  FileCheck2,
  FileText,
  FlaskConical,
  Mail,
  MapPin,
  Percent,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Truck,
  UserRound,
  UsersRound,
  Weight,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, Panel } from "../components/ui.js";
import { useApi } from "../hooks/use-api.js";
import { formatDate, formatKzPhone, formatMoney, formatNumber, normalizeKzPhone, unitLabel } from "../lib/format.js";
import type { Customer, CustomerResponse, CustomerTimelineItem, Unit } from "../types.js";

interface AdditiveFormulaOption {
  id: string;
  name: string;
  versions: Array<{
    id: string;
    version: number;
    dosagePercent: string | null;
    components: unknown[];
  }>;
}

interface ComponentDraft {
  key: number;
  name: string;
  quantity: string;
  unit: "" | Unit;
  note: string;
}

const UNIT_OPTIONS: Array<{ value: Unit; label: string }> = [
  { value: "G", label: "г" },
  { value: "KG", label: "кг" },
  { value: "T", label: "т" },
  { value: "ML", label: "мл" },
  { value: "L", label: "л" },
  { value: "M3", label: "м³" },
  { value: "PCS", label: "шт" },
  { value: "M", label: "м" },
  { value: "PAIR", label: "пар" },
];

let nextComponentKey = 1;

function emptyComponent(): ComponentDraft {
  const key = nextComponentKey;
  nextComponentKey += 1;
  return { key, name: "", quantity: "", unit: "", note: "" };
}

export function ClientsPage({ actorRole }: { actorRole: string | undefined }) {
  const customers = useApi<CustomerResponse>("/customers");
  const formulas = useApi<{ items: AdditiveFormulaOption[] }>("/formulas");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(emptyCustomerDraft);
  const [recipeDraft, setRecipeDraft] = useState(emptyRecipeDraft);
  const [components, setComponents] = useState<ComponentDraft[]>(() => [emptyComponent()]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const canManageCustomers = ["ADMIN", "DIRECTOR", "MANAGER", "TECHNOLOGIST"].includes(actorRole ?? "");

  const selectedFromList = customers.data?.items.find((customer) => customer.id === selectedId) ?? null;
  const customerDetail = useApi<Customer>(selectedId === null ? null : `/customers/${selectedId}`);
  const selected = selectedId === null
    ? null
    : customerDetail.data?.id === selectedId ? customerDetail.data : selectedFromList;
  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    if (query === "") return customers.data?.items ?? [];
    return (customers.data?.items ?? []).filter((customer) => [
      customer.name,
      customer.taxId,
      customer.contactPerson,
      customer.phone,
      customer.email,
      ...customer.concreteRecipes.flatMap((recipe) => [recipe.name, recipe.concreteGrade, recipe.additiveFormulaVersion.formula.name]),
    ].some((value) => value?.toLocaleLowerCase("ru").includes(query)));
  }, [customers.data, search]);

  const formulaOptions = (formulas.data?.items ?? []).flatMap((formula) => formula.versions
    .filter((version) => version.dosagePercent !== null && version.components.length > 0)
    .map((version) => ({
      value: version.id,
      label: formula.name,
      description: `v${version.version} · рекомендовано ${formatNumber(version.dosagePercent)}%`,
    })));

  if (customers.loading || formulas.loading) return <LoadingState />;
  if (customers.error !== null) return <ErrorState message={customers.error} retry={customers.reload} />;
  if (formulas.error !== null) return <ErrorState message={formulas.error} retry={formulas.reload} />;

  async function submitCustomer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const payload = customerPayload({ ...customerDraft, phone: normalizeKzPhone(customerDraft.phone) });
      const created = editingCustomer === null
        ? await apiMutation<Customer>("/customers", payload)
        : await apiMutation<Customer>(`/customers/${editingCustomer.id}`, payload, { method: "PATCH" });
      await Promise.all([customers.reload(), customerDetail.reload()]);
      setSelectedId(created.id);
      setCustomerDraft(emptyCustomerDraft());
      setEditingCustomer(null);
      setCustomerModalOpen(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось сохранить клиента");
    } finally {
      setBusy(false);
    }
  }

  async function submitRecipe(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (selectedId === null) return;
    if (components.some((component) => component.name === "" || component.quantity === "" || component.unit === "")) {
      setFormError("Заполните название, количество и единицу каждого компонента");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await apiMutation(`/customers/${selectedId}/recipes`, {
        ...compactPayload(recipeDraft),
        components: components.map((component, position) => ({
          name: component.name,
          quantity: component.quantity,
          unit: component.unit,
          position,
          ...(component.note.trim() === "" ? {} : { note: component.note }),
        })),
      });
      await Promise.all([customers.reload(), customerDetail.reload()]);
      setRecipeDraft(emptyRecipeDraft());
      setComponents([emptyComponent()]);
      setRecipeModalOpen(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Состав бетона не сохранён");
    } finally {
      setBusy(false);
    }
  }

  function openCustomerModal(): void {
    setCustomerDraft(emptyCustomerDraft());
    setEditingCustomer(null);
    setFormError(null);
    setCustomerModalOpen(true);
  }

  function openEditCustomerModal(): void {
    if (selected === null) return;
    setCustomerDraft(customerDraftFrom(selected));
    setEditingCustomer(selected);
    setFormError(null);
    setCustomerModalOpen(true);
  }

  function closeCustomerModal(): void {
    setCustomerModalOpen(false);
    setEditingCustomer(null);
    setFormError(null);
  }

  function openRecipeModal(): void {
    setRecipeDraft(emptyRecipeDraft());
    setComponents([emptyComponent()]);
    setFormError(null);
    setRecipeModalOpen(true);
  }

  if (selected !== null) {
    const timelineReady = customerDetail.data?.id === selected.id;
    return (
      <>
        <div className="client-detail-nav">
          <button type="button" onClick={() => setSelectedId(null)}><ChevronLeft size={17} /> Все клиенты</button>
        </div>
        <PageHeader
          title={selected.name}
          actions={canManageCustomers ? <><button className="button secondary" onClick={openEditCustomerModal}><Pencil size={16} /> Редактировать</button><button className="button primary" disabled={formulaOptions.length === 0} onClick={openRecipeModal}><Plus size={17} /> Добавить состав бетона</button></> : undefined}
        />

        <section className="client-profile-strip">
          <ContactItem icon={Building2} label="БИН / ИИН" value={selected.taxId} />
          <ContactItem icon={UserRound} label="Контакт" value={selected.contactPerson} />
          <ContactItem icon={Phone} label="Телефон" value={selected.phone === null ? null : formatKzPhone(selected.phone)} />
          <ContactItem icon={Mail} label="Почта" value={selected.email} />
          <ContactItem icon={MapPin} label="Адрес" value={selected.address} />
          <ContactItem icon={FileText} label="Договор" value={customerContractSummary(selected)} />
          <ContactItem icon={BadgeDollarSign} label="Отсрочка оплаты" value={selected.paymentTermDays === null ? null : `${selected.paymentTermDays} дн.`} />
          <ContactItem icon={BadgeDollarSign} label="Лимит" value={selected.creditLimit === null ? null : formatMoney(selected.creditLimit)} />
          <ContactItem icon={BadgeDollarSign} label="Дебиторка" value={(selected.receivables ?? []).length === 0 ? "Нет долга" : (selected.receivables ?? []).map((item) => `${formatMoney(item.amount, item.currency)}${Number(item.overdueAmount) > 0 ? ` · просрочено ${formatMoney(item.overdueAmount, item.currency)}` : ""}`).join(" · ")} />
        </section>

        {selected.concreteRecipes.length === 0 ? (
          <Panel><EmptyState title="Составов бетона пока нет" text="Добавьте состав клиента и укажите процент вашей добавки." /></Panel>
        ) : (
          <div className="customer-recipe-grid">
            {selected.concreteRecipes.map((recipe) => (
              <article className="customer-recipe-card" key={recipe.id}>
                <header>
                  <span className="customer-recipe-icon"><Factory size={19} /></span>
                  <div><small>{recipe.concreteGrade}</small><h2>{recipe.name}</h2></div>
                  <span className="customer-dosage-badge"><Percent size={13} /> {formatNumber(recipe.additiveDosagePercent)}%</span>
                </header>
                <div className="customer-additive-result">
                  <div><span><FlaskConical size={15} /> Добавка</span><strong>{recipe.additiveFormulaVersion.formula.name}</strong><small>версия {recipe.additiveFormulaVersion.version}</small></div>
                  <div><span><Weight size={15} /> Расход на 1 м³</span><strong>{formatNumber(recipe.additiveQuantityPerM3Kg)} кг</strong><small>{formatNumber(recipe.binderMassKg)} кг вяжущего на {formatNumber(recipe.basisVolume)} м³</small></div>
                </div>
                <div className="customer-composition-heading"><strong>Состав бетона клиента</strong><span>на {formatNumber(recipe.basisVolume)} {unitLabel[recipe.basisUnit]}</span></div>
                <div className="customer-composition-table">
                  {recipe.components.map((component) => (
                    <div key={component.id}>
                      <span>{component.name}{component.note === null ? null : <small>{component.note}</small>}</span>
                      <strong>{formatNumber(component.quantity)} {unitLabel[component.unit]}</strong>
                    </div>
                  ))}
                </div>
                <footer>
                  <span>Фактическая дозировка <strong>{formatNumber(recipe.additiveDosagePercent)}%</strong></span>
                  {recipe.recommendedDosagePercent === null ? null : <span>Формула рекомендует <strong>{formatNumber(recipe.recommendedDosagePercent)}%</strong></span>}
                </footer>
              </article>
            ))}
          </div>
        )}

        <section className="client-timeline-section" aria-label="Лента клиента">
          <div className="client-timeline-head">
            <div><h2>Лента клиента</h2></div>
            <small>{selected.timeline?.length ?? 0} событий</small>
          </div>
          {customerDetail.error !== null ? <ErrorState message={customerDetail.error} retry={customerDetail.reload} /> : null}
          {customerDetail.error === null && !timelineReady ? <LoadingState /> : null}
          {customerDetail.error === null && timelineReady && (selected.timeline?.length ?? 0) === 0 ? <EmptyState title="Событий пока нет" text="Здесь появятся отгрузки, счета и оплаты по этому клиенту." /> : null}
          {customerDetail.error === null && timelineReady && (selected.timeline?.length ?? 0) > 0 ? <div className="client-timeline">{selected.timeline?.map((event) => <CustomerTimelineEvent key={event.id} event={event} />)}</div> : null}
        </section>

        {recipeModalOpen ? (
          <Modal title="Новый состав бетона клиента" wide onClose={() => setRecipeModalOpen(false)}>
            <form onSubmit={(event) => void submitRecipe(event)}>
              <div className="form-grid client-recipe-form">
                <label><span>Название состава</span><input required value={recipeDraft.name} placeholder="Например, Мостовой B35" onChange={(event) => setRecipeDraft({ ...recipeDraft, name: event.target.value })} /></label>
                <label><span>Марка / класс бетона</span><input required value={recipeDraft.concreteGrade} placeholder="Например, B35 П4 F300 W12" onChange={(event) => setRecipeDraft({ ...recipeDraft, concreteGrade: event.target.value })} /></label>
                <label><span>Расчётный объём, м³</span><input required min="0.000001" step="any" type="number" value={recipeDraft.basisVolume} placeholder="Например, 1" onChange={(event) => setRecipeDraft({ ...recipeDraft, basisVolume: event.target.value })} /></label>
                <label><span>Масса вяжущего, кг</span><input required min="0.000001" step="any" type="number" value={recipeDraft.binderMassKg} placeholder="Цемент и другие вяжущие" onChange={(event) => setRecipeDraft({ ...recipeDraft, binderMassKg: event.target.value })} /></label>
                <div className="form-field"><span>Формула вашей добавки</span><CustomSelect required ariaLabel="Формула вашей добавки" value={recipeDraft.additiveFormulaVersionId} options={formulaOptions} placeholder="Выберите формулу" onChange={(value) => setRecipeDraft({ ...recipeDraft, additiveFormulaVersionId: value })} /></div>
                <label><span>Фактическая дозировка, %</span><input required min="0.000001" max="100" step="any" type="number" value={recipeDraft.additiveDosagePercent} placeholder="Процент от массы вяжущего" onChange={(event) => setRecipeDraft({ ...recipeDraft, additiveDosagePercent: event.target.value })} /></label>
                <label className="span-2"><span>Комментарий</span><textarea value={recipeDraft.notes} placeholder="Особенности бетона или применения добавки" onChange={(event) => setRecipeDraft({ ...recipeDraft, notes: event.target.value })} /></label>
              </div>
              <div className="client-components-builder">
                <div className="client-components-title"><div><strong>Состав бетона клиента</strong></div><button type="button" className="button secondary" onClick={() => setComponents((current) => [...current, emptyComponent()])}><Plus size={15} /> Компонент</button></div>
                {components.map((component, index) => (
                  <div className="client-component-row" key={component.key}>
                    <label><span>Компонент {index + 1}</span><input required value={component.name} placeholder="Название" onChange={(event) => updateComponent(setComponents, component.key, { name: event.target.value })} /></label>
                    <label><span>Количество</span><input required min="0.000001" step="any" type="number" value={component.quantity} placeholder="0" onChange={(event) => updateComponent(setComponents, component.key, { quantity: event.target.value })} /></label>
                    <div className="form-field"><span>Единица</span><CustomSelect required ariaLabel={`Единица компонента ${index + 1}`} value={component.unit} options={UNIT_OPTIONS} placeholder="Выберите" onChange={(value) => updateComponent(setComponents, component.key, { unit: value as Unit })} /></div>
                    <label><span>Примечание</span><input value={component.note} placeholder="Необязательно" onChange={(event) => updateComponent(setComponents, component.key, { note: event.target.value })} /></label>
                    <button type="button" className="row-action danger" aria-label={`Удалить компонент ${index + 1}`} disabled={components.length === 1} onClick={() => setComponents((current) => current.filter((item) => item.key !== component.key))}><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              {formError === null ? null : <p className="form-error">{formError}</p>}
              <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setRecipeModalOpen(false)}>Отмена</button><button className="button primary" disabled={busy || formulaOptions.length === 0}>{busy ? "Сохраняем…" : "Сохранить состав"}</button></div>
            </form>
          </Modal>
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Клиенты"
        actions={canManageCustomers ? <button className="button primary" onClick={openCustomerModal}><Plus size={17} /> Новый клиент</button> : undefined}
      />
      <section className="client-summary-grid">
        <SummaryCard icon={UsersRound} label="Активные клиенты" value={customers.data?.summary.activeCustomers ?? 0} />
        <SummaryCard icon={Factory} label="Составы бетона" value={customers.data?.summary.concreteRecipes ?? 0} />
        <SummaryCard icon={FlaskConical} label="Формулы в работе" value={customers.data?.summary.formulasInUse ?? 0} />
      </section>
      <Panel className="clients-panel">
        <div className="clients-toolbar">
          <div><h2>Клиентская база</h2></div>
          <label className={`client-search${search === "" ? "" : " filled"}`}><Search size={16} /><input value={search} placeholder="Клиент, марка или добавка…" onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
        {filteredCustomers.length === 0 ? (
          <EmptyState title={search === "" ? "Клиентов пока нет" : "Ничего не найдено"} text={search === "" ? "Добавьте первого клиента без демонстрационных данных." : "Измените запрос поиска."} />
        ) : (
          <div className="client-list">
            {filteredCustomers.map((customer) => (
              <button type="button" className="client-list-card" key={customer.id} onClick={() => setSelectedId(customer.id)}>
                <span className="client-avatar">{customerInitials(customer.name)}</span>
                <span className="client-main"><strong>{customer.name}</strong><small>{[customer.contactPerson, customer.taxId].filter(Boolean).join(" · ") || "Реквизиты не заполнены"}</small></span>
                <span className="client-recipe-count"><strong>{customer.concreteRecipes.length}</strong><small>составов</small></span>
                <span className="client-debt">{customer.receivables?.[0] ? <><strong>{formatMoney(customer.receivables[0].amount, customer.receivables[0].currency)}</strong><small>дебиторка</small></> : null}</span>
                <span className="client-formula-tags">{customer.concreteRecipes.length === 0 ? <small>Нет составов</small> : [...new Set(customer.concreteRecipes.map((recipe) => recipe.additiveFormulaVersion.formula.name))].slice(0, 3).map((name) => <em key={name}>{name}</em>)}</span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        )}
      </Panel>

      {customerModalOpen ? (
        <Modal title={editingCustomer === null ? "Новый клиент" : "Карточка клиента"} onClose={closeCustomerModal}>
          <form onSubmit={(event) => void submitCustomer(event)}>
            <div className="form-grid">
              <label className="span-2"><span>Название клиента <b>*</b></span><input required value={customerDraft.name} placeholder="ТОО или название производства" onChange={(event) => setCustomerDraft({ ...customerDraft, name: event.target.value })} /></label>
              <label><span>БИН / ИИН</span><input value={customerDraft.taxId} placeholder="Необязательно" onChange={(event) => setCustomerDraft({ ...customerDraft, taxId: event.target.value })} /></label>
              <label><span>Контактное лицо</span><input value={customerDraft.contactPerson} placeholder="ФИО" onChange={(event) => setCustomerDraft({ ...customerDraft, contactPerson: event.target.value })} /></label>
              <label><span>Телефон</span><input type="tel" inputMode="tel" autoComplete="tel" maxLength={18} value={formatKzPhone(customerDraft.phone)} placeholder="+7 (700) 123-45-67" onChange={(event) => setCustomerDraft({ ...customerDraft, phone: formatKzPhone(event.target.value) })} /></label>
              <label><span>Электронная почта</span><input type="email" value={customerDraft.email} placeholder="mail@company.kz" onChange={(event) => setCustomerDraft({ ...customerDraft, email: event.target.value })} /></label>
              <label className="span-2"><span>Адрес</span><input value={customerDraft.address} placeholder="Адрес бетонного производства" onChange={(event) => setCustomerDraft({ ...customerDraft, address: event.target.value })} /></label>
              <label><span>№ договора</span><input value={customerDraft.contractNumber} placeholder="Например, 24/08-01" onChange={(event) => setCustomerDraft({ ...customerDraft, contractNumber: event.target.value })} /></label>
              <label><span>Отсрочка оплаты, дней</span><input type="number" min="0" max="365" value={customerDraft.paymentTermDays} placeholder="Например, 14" onChange={(event) => setCustomerDraft({ ...customerDraft, paymentTermDays: event.target.value })} /></label>
              <div className="form-field"><span>Дата договора</span><DateTimePicker mode="date" ariaLabel="Дата договора клиента" value={customerDraft.contractSignedAt} onChange={(contractSignedAt) => setCustomerDraft({ ...customerDraft, contractSignedAt })} /></div>
              <div className="form-field"><span>Договор действует до</span><DateTimePicker mode="date" ariaLabel="Срок действия договора клиента" value={customerDraft.contractValidUntil} onChange={(contractValidUntil) => setCustomerDraft({ ...customerDraft, contractValidUntil })} /></div>
              <label className="span-2"><span>Кредитный лимит, ₸</span><input type="number" min="0" step="0.01" value={customerDraft.creditLimit} placeholder="Необязательно" onChange={(event) => setCustomerDraft({ ...customerDraft, creditLimit: event.target.value })} /></label>
              <label className="span-2"><span>Комментарий</span><textarea value={customerDraft.notes} placeholder="Условия работы и особенности клиента" onChange={(event) => setCustomerDraft({ ...customerDraft, notes: event.target.value })} /></label>
            </div>
            {formError === null ? null : <p className="form-error">{formError}</p>}
            <div className="modal-actions"><button type="button" className="button secondary" onClick={closeCustomerModal}>Отмена</button><button className="button primary" disabled={busy}>{busy ? "Сохраняем…" : editingCustomer === null ? "Создать клиента" : "Сохранить изменения"}</button></div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof UsersRound; label: string; value: number }) {
  return <article><span><Icon size={18} /></span><div><strong>{value}</strong><small>{label}</small></div></article>;
}

function ContactItem({ icon: Icon, label, value }: { icon: typeof UsersRound; label: string; value: string | null }) {
  return <div><span><Icon size={15} /></span><div><small>{label}</small><strong>{value ?? "Не указано"}</strong></div></div>;
}

function CustomerTimelineEvent({ event }: { event: CustomerTimelineItem }) {
  const Icon = event.kind === "CONCRETE_RECIPE"
    ? FlaskConical
    : event.kind === "TRANSFER"
      ? Truck
      : event.kind === "PAYMENT"
        ? CreditCard
        : event.kind === "DEBT"
          ? CircleDollarSign
          : event.kind === "WAYBILL"
            ? FileCheck2
            : FileText;
  return <article className={`client-timeline-event ${event.kind.toLocaleLowerCase("en")}`}>
    <span className="client-timeline-marker"><Icon size={16} /></span>
    <div className="client-timeline-copy"><span className="client-timeline-kind">{customerTimelineKindLabel(event.kind)}</span><strong>{event.title}</strong><p>{event.description}</p></div>
    <div className="client-timeline-meta"><time>{formatDate(event.occurredAt, true)}</time>{event.amount === null ? null : <strong>{formatMoney(event.amount, event.currency ?? "KZT")}</strong>}</div>
  </article>;
}

function customerTimelineKindLabel(kind: CustomerTimelineItem["kind"]): string {
  return {
    CONCRETE_RECIPE: "Состав бетона",
    TRANSFER: "Отгрузка",
    WAYBILL: "Накладная",
    DOCUMENT: "Документ",
    PAYMENT: "Оплата",
    DEBT: "Дебиторка",
  }[kind];
}

function emptyCustomerDraft() {
  return {
    name: "", taxId: "", contactPerson: "", phone: "", email: "", address: "", contractNumber: "", contractSignedAt: "", contractValidUntil: "", paymentTermDays: "", creditLimit: "", notes: "",
  };
}

function customerDraftFrom(customer: Customer) {
  return {
    name: customer.name,
    taxId: customer.taxId ?? "",
    contactPerson: customer.contactPerson ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    address: customer.address ?? "",
    contractNumber: customer.contractNumber ?? "",
    contractSignedAt: customer.contractSignedAt?.slice(0, 10) ?? "",
    contractValidUntil: customer.contractValidUntil?.slice(0, 10) ?? "",
    paymentTermDays: customer.paymentTermDays?.toString() ?? "",
    creditLimit: customer.creditLimit ?? "",
    notes: customer.notes ?? "",
  };
}

function customerPayload(source: ReturnType<typeof emptyCustomerDraft>) {
  const { contractSignedAt, contractValidUntil, paymentTermDays, ...textFields } = source;
  return {
    ...compactPayload(textFields),
    ...(contractSignedAt === "" ? {} : { contractSignedAt: new Date(contractSignedAt).toISOString() }),
    ...(contractValidUntil === "" ? {} : { contractValidUntil: new Date(contractValidUntil).toISOString() }),
    ...(paymentTermDays === "" ? {} : { paymentTermDays: Number(paymentTermDays) }),
  };
}

function customerContractSummary(customer: Customer): string | null {
  if (customer.contractNumber === null || customer.contractNumber === undefined) return null;
  if (customer.contractValidUntil === null || customer.contractValidUntil === undefined || Number.isNaN(new Date(customer.contractValidUntil).getTime())) return customer.contractNumber;
  return `${customer.contractNumber} · до ${formatDate(customer.contractValidUntil)}`;
}

function emptyRecipeDraft() {
  return { name: "", concreteGrade: "", basisVolume: "", binderMassKg: "", additiveFormulaVersionId: "", additiveDosagePercent: "", notes: "" };
}

function compactPayload<T extends Record<string, string>>(source: T): Partial<T> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value.trim() !== "")) as Partial<T>;
}

function updateComponent(
  setter: Dispatch<SetStateAction<ComponentDraft[]>>,
  key: number,
  patch: Partial<ComponentDraft>,
): void {
  setter((current) => current.map((component) => component.key === key ? { ...component, ...patch } : component));
}

function customerInitials(name: string): string {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
