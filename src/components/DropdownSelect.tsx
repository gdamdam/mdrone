/**
 * DropdownSelect — a CSS-styled single-select dropdown.
 *
 * Replaces the native `<select>` element in places where we don't
 * want the OS-native wheel picker (iOS) or system combobox (Mac /
 * Windows) popping up. This component renders its own popup list
 * so the look is identical on every platform.
 *
 * Minimal API:
 *
 *   <DropdownSelect
 *     value={value}
 *     options={[{ value: "A", label: "Alpha" }, ...]}
 *     onChange={setValue}
 *     className="header-select"        // optional — style the trigger
 *     popupClassName="my-popup"        // optional — style the menu
 *     title="tooltip on the trigger"
 *   />
 *
 * Keyboard: Enter / Space / ArrowDown opens the popup, Arrow keys
 * move the highlight, Enter commits, Escape closes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

export interface DropdownGroup<T extends string> {
  label: string;
  items: readonly DropdownOption<T>[];
}

interface DropdownSelectProps<T extends string> {
  value: T;
  /** Flat option list. Mutually exclusive with `groups`. */
  options?: readonly DropdownOption<T>[];
  /** Grouped option list — renders a section header per group.
   *  Mutually exclusive with `options`. */
  groups?: readonly DropdownGroup<T>[];
  onChange: (next: T) => void;
  className?: string;
  popupClassName?: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export function DropdownSelect<T extends string>({
  value,
  options,
  groups,
  onChange,
  className,
  popupClassName,
  title,
  ariaLabel,
  disabled,
}: DropdownSelectProps<T>) {
  // Build a flat option list (for keyboard nav + label lookup) out of
  // whichever prop was supplied. When using groups, we still need a
  // flat index for highlight/arrow-key nav.
  const flat: readonly DropdownOption<T>[] = options
    ?? (groups?.flatMap((g) => g.items) ?? []);

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(() =>
    Math.max(0, flat.findIndex((o) => o.value === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const current = flat.find((o) => o.value === value);
  const label = current?.label ?? String(value);

  // Keep highlight in sync with value when the popup opens
  useEffect(() => {
    if (open) {
      setHighlight(Math.max(0, flat.findIndex((o) => o.value === value)));
    }
  }, [open, flat, value]);

  // Close on outside pointer / Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commit = useCallback((next: T) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }, [onChange]);

  const handleTriggerKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  }, []);

  const handleListKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = flat[highlight];
      if (opt) commit(opt.value);
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(flat.length - 1);
    }
  }, [commit, highlight, flat]);

  return (
    <div className="dropdown-select-root" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-select-trigger ${className ?? ""}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleTriggerKey}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className="dropdown-select-label">{label}</span>
        <span className="dropdown-select-chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          className={`dropdown-select-popup ${popupClassName ?? ""}`}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleListKey}
          ref={(el) => el?.focus()}
        >
          {groups
            ? (() => {
                // Render grouped: emit a non-interactive header <li>
                // before each group. Track the running flat index so
                // option highlights stay in sync with keyboard nav.
                const rendered: React.ReactNode[] = [];
                let idx = 0;
                for (const g of groups) {
                  rendered.push(
                    <li
                      key={`__group_${g.label}`}
                      className="dropdown-select-group-label"
                      role="presentation"
                    >
                      {g.label}
                    </li>,
                  );
                  for (const opt of g.items) {
                    const i = idx++;
                    rendered.push(
                      <li
                        key={opt.value}
                        role="option"
                        aria-selected={opt.value === value}
                        className={`dropdown-select-option${
                          i === highlight ? " dropdown-select-option-highlight" : ""
                        }${opt.value === value ? " dropdown-select-option-selected" : ""}`}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => commit(opt.value)}
                      >
                        {opt.label}
                      </li>,
                    );
                  }
                }
                return rendered;
              })()
            : flat.map((opt, i) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  className={`dropdown-select-option${
                    i === highlight ? " dropdown-select-option-highlight" : ""
                  }${opt.value === value ? " dropdown-select-option-selected" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => commit(opt.value)}
                >
                  {opt.label}
                </li>
              ))}
        </ul>
      )}
    </div>
  );
}
