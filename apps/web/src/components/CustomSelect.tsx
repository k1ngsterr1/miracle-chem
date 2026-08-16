import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  align?: "left" | "right";
}

export function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Выберите значение",
  disabled = false,
  compact = false,
  align = "left",
}: CustomSelectProps) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex < 0 ? null : options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => selectedIndex < 0 ? firstEnabled(options) : selectedIndex);
  const [position, setPosition] = useState({ top: 0, left: 0, width: compact ? 84 : 240 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => menuRef.current?.focus({ preventScroll: true }));
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (trigger === null) return;
      const rect = trigger.getBoundingClientRect();
      const availableWidth = window.innerWidth - 24;
      const preferredWidth = compact ? Math.max(84, rect.width) : Math.max(240, rect.width);
      const width = Math.min(preferredWidth, compact ? 120 : 520, availableWidth);
      const height = Math.min(menuRef.current?.offsetHeight ?? 290, window.innerHeight - 24);
      const leftCandidate = align === "right" ? rect.right - width : rect.left;
      const left = Math.max(12, Math.min(leftCandidate, window.innerWidth - width - 12));
      const fitsBelow = rect.bottom + height + 12 <= window.innerHeight;
      const top = fitsBelow ? rect.bottom + 7 : Math.max(12, rect.top - height - 7);
      setPosition({ top, left, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, compact, open]);

  function openMenu(direction = 0): void {
    if (disabled || options.length === 0) return;
    const start = selectedIndex < 0 ? firstEnabled(options) : selectedIndex;
    setActiveIndex(direction === 0 ? start : nextEnabled(options, start, direction));
    setOpen(true);
  }

  function choose(index: number): void {
    const option = options[index];
    if (option === undefined || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openMenu(event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0);
    }
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => nextEnabled(options, current, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? firstEnabled(options) : lastEnabled(options));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Tab") setOpen(false);
  }

  const menu = open ? (
    <div
      ref={menuRef}
      id={listboxId}
      className={`custom-select-menu${compact ? " compact" : ""}`}
      role="listbox"
      aria-label={`${ariaLabel}: варианты`}
      aria-activedescendant={activeIndex < 0 ? undefined : `${listboxId}-option-${activeIndex}`}
      tabIndex={-1}
      data-dropdown-layer="true"
      style={{ top: position.top, left: position.left, width: position.width }}
      onKeyDown={handleMenuKeyDown}
    >
      {options.length === 0 ? <div className="custom-select-empty">Нет доступных вариантов</div> : options.map((option, index) => (
        <div
          id={`${listboxId}-option-${index}`}
          key={option.value}
          role="option"
          aria-selected={index === selectedIndex}
          aria-disabled={option.disabled || undefined}
          data-option-index={index}
          className={`${index === activeIndex ? "active" : ""}${index === selectedIndex ? " selected" : ""}${option.disabled ? " disabled" : ""}`}
          onClick={() => choose(index)}
          onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }}
        >
          <span>
            <strong>{option.label}</strong>
            {option.description === undefined ? null : <small>{option.description}</small>}
          </span>
          {index === selectedIndex ? <Check size={15} /> : null}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className={`custom-select${compact ? " compact" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled || options.length === 0}
        onClick={() => { if (open) setOpen(false); else openMenu(); }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={selected === null ? "placeholder" : ""}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={compact ? 14 : 16} />
      </button>
      {typeof document === "undefined" ? null : createPortal(menu, document.body)}
    </div>
  );
}

function firstEnabled(options: CustomSelectOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

function lastEnabled(options: CustomSelectOption[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function nextEnabled(options: CustomSelectOption[], current: number, direction: number): number {
  if (options.length === 0) return -1;
  let index = current < 0 ? (direction > 0 ? -1 : 0) : current;
  for (let step = 0; step < options.length; step += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return current;
}
