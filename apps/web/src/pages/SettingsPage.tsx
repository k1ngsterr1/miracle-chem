import { useEffect, useState } from "react";
import { Building2, KeyRound, Pencil, Plus, Save, ShieldCheck, UserCog, UsersRound } from "lucide-react";
import { apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, Panel, StatusBadge } from "../components/ui.js";
import { useApi } from "../hooks/use-api.js";
import { formatKzPhone, normalizeKzPhone } from "../lib/format.js";
import type { CompanyProfile, ManagedUser } from "../types.js";

const ROLE_OPTIONS = [
  { value: "DIRECTOR", label: "Руководитель", description: "Видит всю CRM и согласует документы" },
  { value: "MANAGER", label: "Менеджер", description: "Клиенты, отгрузки и свои черновики" },
  { value: "ACCOUNTANT", label: "Бухгалтер", description: "Финансы, документы и оплаты" },
  { value: "TECHNOLOGIST", label: "Технолог" },
  { value: "OPERATOR", label: "Оператор" },
  { value: "STOREKEEPER", label: "Кладовщик" },
  { value: "QUALITY_MANAGER", label: "Контроль качества" },
  { value: "LRT_RECEIVER", label: "Менеджер отгрузок" },
  { value: "VIEWER", label: "Только просмотр" },
  { value: "ADMIN", label: "Администратор", description: "Полный доступ" },
];

const roleLabel = (role: string): string => ROLE_OPTIONS.find((item) => item.value === role)?.label ?? role;

export function SettingsPage({ actorRole }: { actorRole: string | undefined }) {
  const users = useApi<{ items: ManagedUser[] }>("/admin/users");
  const company = useApi<CompanyProfile>("/admin/company-profile");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [companyDraft, setCompanyDraft] = useState<CompanyProfile | null>(null);
  const [companyBusy, setCompanyBusy] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  useEffect(() => {
    if (company.data !== null) setCompanyDraft(company.data);
  }, [company.data]);

  if (actorRole !== "ADMIN" && actorRole !== "DIRECTOR") return <ErrorState message="Этот раздел доступен администратору и руководителю." />;
  if (users.loading || company.loading || companyDraft === null) return <LoadingState />;
  if (users.error !== null) return <ErrorState message={users.error} retry={users.reload} />;
  if (company.error !== null) return <ErrorState message={company.error} retry={company.reload} />;

  async function saveCompany(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (companyDraft === null) return;
    setCompanyBusy(true);
    setCompanyError(null);
    try {
      await apiMutation("/admin/company-profile", {
        ...companyDraft,
        phone: companyDraft.phone === null || companyDraft.phone === "" ? undefined : normalizeKzPhone(companyDraft.phone),
      }, { method: "PUT", idempotent: true });
      await company.reload();
    } catch (cause) {
      setCompanyError(cause instanceof Error ? cause.message : "Не удалось сохранить реквизиты");
    } finally {
      setCompanyBusy(false);
    }
  }

  return <>
    <PageHeader
      eyebrow="Администрирование"
      title="Команда и реквизиты"
      description="Доступ сотрудников, роли и данные компании для накладных, счетов, актов и доверенностей."
      actions={<button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Сотрудник</button>}
    />

    <div className="settings-overview">
      <Panel><span><UsersRound size={19} /></span><div><strong>{users.data?.items.filter((user) => user.active).length ?? 0}</strong><small>активных сотрудников</small></div></Panel>
      <Panel><span className="blue"><ShieldCheck size={19} /></span><div><strong>{users.data?.items.filter((user) => ["ADMIN", "DIRECTOR", "ACCOUNTANT"].includes(user.role)).length ?? 0}</strong><small>финансовый контур</small></div></Panel>
      <Panel><span className="green"><Building2 size={19} /></span><div><strong>{companyDraft.legalName === null || companyDraft.legalName === "" ? "—" : "Готово"}</strong><small>реквизиты для PDF</small></div></Panel>
    </div>

    <div className="settings-grid">
      <Panel className="settings-users-panel">
        <div className="table-toolbar"><div><h2>Сотрудники и роли</h2><p>Роли применяются на сервере, а не только скрывают кнопки.</p></div></div>
        {users.data?.items.length === 0 ? <EmptyState title="Сотрудников пока нет" text="Добавьте первого сотрудника." /> : <div className="settings-user-list">
          {users.data?.items.map((user) => <div key={user.id} className="settings-user-row">
            <span className="settings-user-avatar">{initials(user.name)}</span>
            <div><strong>{user.name}</strong><small>{user.email}</small></div>
            <span className="settings-user-role">{roleLabel(user.role)}</span>
            <StatusBadge status={user.active ? "ISSUED" : "CANCELLED"} />
            <button type="button" className="row-action" aria-label={`Изменить ${user.name}`} onClick={() => setEditingUser(user)}><Pencil size={16} /></button>
          </div>)}
        </div>}
      </Panel>

      <Panel className="settings-company-panel">
        <div className="table-toolbar"><div><h2>Реквизиты компании</h2><p>Подставляются в печатные формы автоматически.</p></div></div>
        <form className="form-grid settings-company-form" onSubmit={(event) => void saveCompany(event)}>
          <label className="span-2"><span>Юридическое наименование</span><input value={companyDraft.legalName ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, legalName: event.target.value })} placeholder="ТОО «Miracle Chem»" /></label>
          <label><span>БИН / ИИН</span><input value={companyDraft.taxId ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, taxId: event.target.value })} /></label>
          <label><span>Телефон</span><input inputMode="tel" value={formatKzPhone(companyDraft.phone ?? "")} onChange={(event) => setCompanyDraft({ ...companyDraft, phone: event.target.value })} placeholder="+7 (___) ___-__-__" /></label>
          <label className="span-2"><span>Адрес</span><input value={companyDraft.address ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, address: event.target.value })} /></label>
          <label className="span-2"><span>Почта</span><input type="email" value={companyDraft.email ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, email: event.target.value })} /></label>
          <label className="span-2"><span>Банк</span><input value={companyDraft.bankName ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, bankName: event.target.value })} /></label>
          <label><span>ИИК</span><input value={companyDraft.iban ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, iban: event.target.value.toUpperCase() })} /></label>
          <label><span>БИК</span><input value={companyDraft.bic ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, bic: event.target.value.toUpperCase() })} /></label>
          <label><span>Руководитель</span><input value={companyDraft.directorName ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, directorName: event.target.value })} /></label>
          <label><span>Бухгалтер</span><input value={companyDraft.accountantName ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, accountantName: event.target.value })} /></label>
          <label><span>Подписант в документах</span><input value={companyDraft.signatoryName ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, signatoryName: event.target.value })} placeholder="Если отличается от руководителя" /></label>
          <label><span>Должность подписанта</span><input value={companyDraft.signatoryPosition ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, signatoryPosition: event.target.value })} /></label>
          <label className="span-2"><span>Подпись внизу документа</span><textarea rows={2} value={companyDraft.documentFooter ?? ""} onChange={(event) => setCompanyDraft({ ...companyDraft, documentFooter: event.target.value })} placeholder="Например, документ действителен без печати" /></label>
          {companyError === null ? null : <div className="form-error span-2">{companyError}</div>}
          <div className="modal-actions span-2"><button className="button primary" disabled={companyBusy}><Save size={16} /> {companyBusy ? "Сохраняем…" : "Сохранить реквизиты"}</button></div>
        </form>
      </Panel>
    </div>

    {createOpen ? <UserModal title="Новый сотрудник" onClose={() => setCreateOpen(false)} onSaved={async () => { setCreateOpen(false); await users.reload(); }} /> : null}
    {editingUser === null ? null : <UserModal title={`Доступ: ${editingUser.name}`} user={editingUser} onClose={() => setEditingUser(null)} onSaved={async () => { setEditingUser(null); await users.reload(); }} />}
  </>;
}

function UserModal({ title, user, onClose, onSaved }: { title: string; user?: ManagedUser; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: user?.name ?? "", email: user?.email ?? "", role: user?.role ?? "MANAGER", password: "", active: user?.active ?? true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = user !== undefined;
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!editing && form.password.length < 8) { setError("Пароль должен быть не короче 8 символов"); return; }
    setBusy(true); setError(null);
    try {
      if (editing) {
        await apiMutation(`/admin/users/${user.id}`, {
          name: form.name,
          role: form.role,
          active: form.active,
          ...(form.password === "" ? {} : { password: form.password }),
        }, { method: "PATCH" });
      } else {
        await apiMutation("/admin/users", { name: form.name, email: form.email, role: form.role, password: form.password });
      }
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить сотрудника");
    } finally { setBusy(false); }
  }
  return <Modal title={title} onClose={onClose}><form className="form-grid" onSubmit={(event) => void submit(event)}>
    <label className="span-2"><span>Ф.И.О. <b>*</b></span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
    {editing ? null : <label className="span-2"><span>Email <b>*</b></span><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>}
    <div className="form-field span-2"><span>Роль <b>*</b></span><CustomSelect required ariaLabel="Роль сотрудника" value={form.role} options={ROLE_OPTIONS} onChange={(role) => setForm({ ...form, role })} /></div>
    <label className="span-2"><span>{editing ? "Новый пароль" : "Пароль *"}</span><span className="password-input"><KeyRound size={16} /><input required={!editing} minLength={8} type="password" value={form.password} placeholder={editing ? "Оставьте пустым, чтобы не менять" : "Минимум 8 символов"} onChange={(event) => setForm({ ...form, password: event.target.value })} /></span></label>
    {editing ? <label className="settings-active-toggle span-2"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span>Учётная запись активна</span></label> : null}
    {error === null ? null : <div className="form-error span-2">{error}</div>}
    <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary" disabled={busy}><UserCog size={16} /> {busy ? "Сохраняем…" : editing ? "Сохранить" : "Создать сотрудника"}</button></div>
  </form></Modal>;
}

function initials(name: string): string {
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
