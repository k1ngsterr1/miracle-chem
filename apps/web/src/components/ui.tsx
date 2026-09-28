import { useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, PropsWithChildren, ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

interface ModalRegistration {
  token: symbol;
  update: (index: number, isTop: boolean) => void;
}

const modalStack: ModalRegistration[] = [];
let bodyOverflowBeforeModal = "";

function updateModalStack(): void {
  modalStack.forEach((registration, index) => registration.update(index, index === modalStack.length - 1));
}

export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
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

export function PageSkeleton() {
  return (
    <div className="page-skeleton" role="status" aria-label="Загрузка раздела">
      <div className="skeleton-heading" aria-hidden="true">
        <div>
          <span className="skeleton-block skeleton-eyebrow" />
          <span className="skeleton-block skeleton-title" />
          <span className="skeleton-block skeleton-copy" />
        </div>
        <span className="skeleton-block skeleton-action" />
      </div>
      <div className="skeleton-cards" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <span className="skeleton-block skeleton-card" key={index} />)}
      </div>
      <div className="skeleton-panels" aria-hidden="true">
        <span className="skeleton-block skeleton-panel skeleton-panel-wide" />
        <span className="skeleton-block skeleton-panel" />
      </div>
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
  ISSUED: "Выставлен",
  PENDING_DIRECTOR_APPROVAL: "На согласовании у руководителя",
  PENDING_ACCOUNTANT_APPROVAL: "На проверке у бухгалтера",
  PAID: "Оплачен",
  APPROVED: "Согласована",
  APPLIED: "Применена",
};

export function StatusBadge({ status }: { status: string }) {
  const style = ["COMPLETED", "ACTIVE", "ACCEPTED", "AVAILABLE", "EMPTY", "AT_DESTINATION", "RECORDED", "PAID", "APPROVED", "APPLIED"].includes(status)
    ? "success"
    : ["IN_PROGRESS", "PARTIALLY_TRANSFERRED", "PARTIALLY_ACCEPTED", "SENT", "IN_TRANSIT", "RETURNING", "LOADING", "UNLOADING", "LOADED", "ISSUED", "PENDING_DIRECTOR_APPROVAL", "PENDING_ACCOUNTANT_APPROVAL"].includes(status)
      ? "progress"
      : ["REJECTED", "CANCELLED", "BLOCKED", "MAINTENANCE"].includes(status)
        ? "danger"
        : "neutral";
  return <span className={`status-badge ${style}`}><span />{STATUS_LABELS[status] ?? status}</span>;
}

export function LoadingState() {
  return (
    <div className="data-loading" role="status" aria-label="Загрузка данных">
      <div aria-hidden="true">
        <span className="skeleton-block data-loading-line long" />
        <span className="skeleton-block data-loading-line" />
        <span className="skeleton-block data-loading-line short" />
      </div>
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const registrationToken = useRef(Symbol("modal"));
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [layer, setLayer] = useState({ index: 0, isTop: true });
  const [validationError, setValidationError] = useState<string | null>(null);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;
    const token = registrationToken.current;
    const registration: ModalRegistration = { token, update: (index, isTop) => setLayer({ index, isTop }) };
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modalStack.length === 0) {
      bodyOverflowBeforeModal = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    modalStack.push(registration);
    updateModalStack();

    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const firstField = dialog?.querySelector<HTMLElement>("[data-autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [role=\"combobox\"]:not([aria-disabled=\"true\"])");
      (firstField ?? dialog)?.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1)?.token !== token) return;
      if (event.key === "Escape") {
        if (document.querySelector(".custom-select-menu, .date-picker-popover") !== null) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || document.activeElement?.closest(".custom-select-menu, .date-picker-popover") !== null) return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])") ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      const registrationIndex = modalStack.findIndex((item) => item.token === token);
      if (registrationIndex >= 0) modalStack.splice(registrationIndex, 1);
      updateModalStack();
      if (modalStack.length === 0) document.body.style.overflow = bodyOverflowBeforeModal;
      previouslyFocused.current?.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    dialogRef.current?.querySelectorAll("form").forEach((form) => { form.noValidate = true; });
  });

  function handleSubmitCapture(event: FormEvent<HTMLDivElement>): void {
    if (!(event.target instanceof HTMLFormElement) || !event.currentTarget.contains(event.target)) return;
    const invalidField = Array.from(event.target.elements).find((element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => (
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
    ) && !element.validity.valid);
    if (invalidField === undefined) {
      setValidationError(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    invalidField.setAttribute("aria-invalid", "true");
    const fieldName = invalidField.closest("label")?.querySelector("span")?.textContent?.trim() || invalidField.getAttribute("aria-label") || "обязательное поле";
    setValidationError(invalidField.validity.valueMissing ? `Заполните поле «${fieldName}».` : `Проверьте значение поля «${fieldName}».`);
    window.requestAnimationFrame(() => invalidField.focus({ preventScroll: false }));
  }

  const modal = (
    <div
      className={`modal-backdrop${layer.isTop ? "" : " underlay"}`}
      role="presentation"
      data-modal-root="true"
      style={{ zIndex: 100 + layer.index * 10 }}
      onMouseDown={() => { if (layer.isTop) onCloseRef.current(); }}
    >
      <div
        ref={dialogRef}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal={layer.isTop ? "true" : undefined}
        aria-labelledby={titleId}
        aria-hidden={layer.isTop ? undefined : "true"}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmitCapture={handleSubmitCapture}
        onInputCapture={(event) => {
          if (event.currentTarget.contains(event.target as Node) && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) {
            event.target.removeAttribute("aria-invalid");
            setValidationError(null);
          }
        }}
      >
        <div className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" aria-label="Закрыть" onClick={() => onCloseRef.current()}><X size={20} /></button></div>
        {validationError === null ? null : <div className="modal-validation-error" role="alert"><AlertTriangle size={16} /><span>{validationError}</span></div>}
        {children}
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(modal, document.body);
}

export function ProgressBar({ value, tone = "lime" }: { value: number; tone?: "lime" | "amber" | "red" }) {
  return <div className={`progress-track ${tone}`}><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}
