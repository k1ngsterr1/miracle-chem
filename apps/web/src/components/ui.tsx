import type { PropsWithChildren, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, X } from "lucide-react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow === undefined ? null : <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions === undefined ? null : <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <div>
        <h2>{title}</h2>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "Запланирован",
  PREPARATION: "Подготовка",
  IN_PROGRESS: "В производстве",
  COMPLETED: "Завершён",
  PARTIALLY_TRANSFERRED: "Частично отгружен",
  FULLY_TRANSFERRED: "Полностью отгружен",
  CANCELLED: "Отменён",
  REJECTED: "Забракован",
  DRAFT: "Черновик",
  ACTIVE: "Активна",
  ARCHIVED: "Архив",
  PREPARED: "Подготовлена",
  SENT: "Отправлена",
  ACCEPTED: "Принята",
  PARTIALLY_ACCEPTED: "Частично принята",
  AVAILABLE: "Доступна",
  PARTIALLY_DISPATCHED: "Частично отгружена",
  DEPLETED: "Израсходована",
  BLOCKED: "Заблокирована",
  EMPTY: "Порожний",
  LOADING: "Под погрузкой",
  LOADED: "Загружен",
  IN_TRANSIT: "В пути",
  AT_DESTINATION: "На назначении",
  UNLOADING: "Под выгрузкой",
  RETURNING: "Возвращается",
  MAINTENANCE: "Обслуживание",
  RECORDED: "Учтён",
};

export function StatusBadge({ status }: { status: string }) {
  const style = ["COMPLETED", "ACTIVE", "ACCEPTED", "AVAILABLE", "EMPTY", "AT_DESTINATION", "RECORDED"].includes(status)
    ? "success"
    : ["IN_PROGRESS", "PARTIALLY_TRANSFERRED", "PARTIALLY_ACCEPTED", "SENT", "IN_TRANSIT", "RETURNING", "LOADING", "UNLOADING", "LOADED"].includes(status)
      ? "progress"
      : ["REJECTED", "CANCELLED", "BLOCKED", "MAINTENANCE"].includes(status)
        ? "danger"
        : "neutral";
  return <span className={`status-badge ${style}`}><span />{STATUS_LABELS[status] ?? status}</span>;
}

export function LoadingState() {
  return (
    <div className="state-card">
      <LoaderCircle className="spin" size={22} />
      <span>Загружаем производственные данные…</span>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="state-card error-state">
      <AlertTriangle size={22} />
      <div><strong>Не удалось получить данные</strong><p>{message}</p></div>
      {retry === undefined ? null : <button className="button ghost" onClick={retry}>Повторить</button>}
    </div>
  );
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <CheckCircle2 size={26} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: PropsWithChildren<{ title: string; onClose: () => void; wide?: boolean }>) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header"><h2>{title}</h2><button aria-label="Закрыть" onClick={onClose}><X size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}

export function ProgressBar({ value, tone = "lime" }: { value: number; tone?: "lime" | "amber" | "red" }) {
  return <div className={`progress-track ${tone}`}><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}
