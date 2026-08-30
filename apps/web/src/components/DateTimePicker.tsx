import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { CustomSelect } from "./CustomSelect.js";

type PickerMode = "date" | "datetime";

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  mode?: PickerMode;
  ariaLabel: string;
  disabled?: boolean;
  required?: boolean;
  align?: "left" | "right";
  compact?: boolean;
}

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: pad(hour) }));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => ({ value: String(minute), label: pad(minute) }));

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/u.exec(value);
  if (match === null) return null;
  const [, year, month, day, hour = "0", minute = "0"] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeValue(value: Date, mode: PickerMode): string {
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return mode === "date" ? date : `${date}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function displayValue(value: string, mode: PickerMode): string {
  const parsed = parseValue(value);
  if (parsed === null) return mode === "date" ? "Выберите дату" : "Выберите дату и время";
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
  return mode === "date" ? date : `${date}, ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function dateAriaLabel(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value).replace(" г.", "");
}

export function DateTimePicker({
  value,
  onChange,
  mode = "datetime",
  ariaLabel,
  disabled = false,
  required = false,
  align = "left",
  compact = false,
}: DateTimePickerProps) {
  const initialDate = parseValue(value) ?? new Date();
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  const [position, setPosition] = useState({ top: 0, left: 0, width: 344 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const selected = parseValue(value);
  const today = new Date();

  const calendarDays = useMemo(() => {
    const firstWeekday = (viewMonth.getDay() + 6) % 7;
    const start = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, index) => new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
    ));
  }, [viewMonth]);

  useEffect(() => {
    const parsed = parseValue(value);
    if (parsed !== null) setViewMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      const insideDropdown = target instanceof Element && target.closest("[data-dropdown-layer=\"true\"]") !== null;
      if (!insideDropdown && !triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (document.activeElement?.closest("[data-dropdown-layer=\"true\"]") !== null) return;
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (trigger === null) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(344, window.innerWidth - 24);
      const height = popoverRef.current?.offsetHeight ?? (mode === "datetime" ? 432 : 370);
      const leftCandidate = align === "right" ? rect.right - width : rect.left;
      const left = Math.max(12, Math.min(leftCandidate, window.innerWidth - width - 12));
      const fitsBelow = rect.bottom + height + 12 <= window.innerHeight;
      const top = fitsBelow ? rect.bottom + 8 : Math.max(12, rect.top - height - 8);
      setPosition({ top, left, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, mode, open]);

  function chooseDay(day: Date): void {
    const current = selected ?? new Date();
    const next = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      current.getHours(),
      current.getMinutes(),
    );
    onChange(serializeValue(next, mode));
    setViewMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    if (mode === "date") setOpen(false);
  }

  function chooseToday(): void {
    const current = selected ?? today;
    const next = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      current.getHours(),
      current.getMinutes(),
    );
    onChange(serializeValue(next, mode));
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    if (mode === "date") setOpen(false);
  }

  function chooseTime(part: "hours" | "minutes", nextValue: number): void {
    const next = selected === null ? new Date() : new Date(selected);
    if (part === "hours") next.setHours(nextValue);
    else next.setMinutes(nextValue);
    onChange(serializeValue(next, mode));
  }

  const popover = open ? (
    <div
      ref={popoverRef}
      id={popoverId}
      className="date-picker-popover"
      role="dialog"
      aria-label={ariaLabel}
      style={{ top: position.top, left: position.left, width: position.width }}
    >
      <div className="date-picker-heading">
        <div>
          <small>{mode === "datetime" ? "Дата производства" : "Выбор даты"}</small>
          <strong>{MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}</strong>
        </div>
        <div className="date-picker-navigation">
          <button type="button" aria-label="Предыдущий месяц" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
          <button type="button" aria-label="Следующий месяц" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}><ChevronRight size={17} /></button>
        </div>
      </div>

      <div className="date-picker-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="date-picker-grid">
        {calendarDays.map((day) => {
          const isSelected = selected !== null && sameDay(day, selected);
          const isToday = sameDay(day, today);
          const outside = day.getMonth() !== viewMonth.getMonth();
          return (
            <button
              type="button"
              key={serializeValue(day, "date")}
              aria-label={dateAriaLabel(day)}
              aria-pressed={isSelected}
              className={`${outside ? "outside" : ""}${isToday ? " today" : ""}${isSelected ? " selected" : ""}`}
              onClick={() => chooseDay(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      {mode === "datetime" ? (
        <div className="date-picker-time">
          <span><Clock3 size={16} /> Время запуска</span>
          <div>
            <div className="time-field">
              <small>Часы</small>
              <CustomSelect compact ariaLabel="Часы" value={String(selected?.getHours() ?? today.getHours())} options={HOUR_OPTIONS} onChange={(hours) => chooseTime("hours", Number(hours))} />
            </div>
            <b>:</b>
            <div className="time-field">
              <small>Минуты</small>
              <CustomSelect compact align="right" ariaLabel="Минуты" value={String(selected?.getMinutes() ?? today.getMinutes())} options={MINUTE_OPTIONS} onChange={(minutes) => chooseTime("minutes", Number(minutes))} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="date-picker-actions">
        <button type="button" onClick={chooseToday}>Сегодня</button>
        {mode === "datetime" ? <button type="button" className="confirm" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><Check size={15} /> Готово</button> : null}
      </div>
    </div>
  ) : null;

  return (
    <div className={`date-picker${compact ? " compact" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="date-picker-trigger"
        aria-label={ariaLabel}
        aria-required={required || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{displayValue(value, mode)}</span>
        <CalendarDays size={compact ? 15 : 17} />
      </button>
      {typeof document === "undefined" ? null : createPortal(popover, document.body)}
    </div>
  );
}
