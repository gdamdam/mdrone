/**
 * DropdownSelect — a CSS-styled single-select dropdown.
 *
 * Replaces the native `<select>` element in places where we don't
 * want the OS-native wheel picker (iOS) or system combobox (Mac /
 * Windows) popping up. This component renders its own popup list
 * so the look is identical on every platform.
 *
 * The popup is portaled to `document.body` with `position: fixed`
 * so it escapes any ancestor overflow clipping or stacking context
 * (e.g. panels with `overflow: hidden`, sticky footers). Max-height
 * is clamped to the viewport space below the trigger and capped at
 * POPUP_CEILING so it never overflows the visible page.
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

interface PopupGeometry {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const POPUP_CEILING = 340;
const POPUP_FLOOR = 160;
const TRIGGER_GAP = 4;
const VIEWPORT_MARGIN = 12;

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
  const flat = useMemo<readonly DropdownOption<T>[]>(
    () => options ?? (groups?.flatMap((g) => g.items) ?? []),
    [groups, options],
  );

  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, flat.findIndex((o) => o.value === value));
  const [highlight, setHighlight] = useState(selectedIndex);
  // Geometry of the portaled popup — computed from the trigger's
  // bounding rect on open + viewport resize. When null the popup is
  // not positioned yet and is hidden.
  const [geometry, setGeometry] = useState<PopupGeometry | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLUListElement>(null);

  const current = flat.find((o) => o.value === value);
  const label = current?.label ?? String(value);

  // Close on outside pointer / Escape. With the portal, the popup is
  // outside rootRef, so check the popup element separately.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
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

  // Compute the popup's position + max-height from the trigger's
  // viewport rect. `visualViewport` tracks mobile browser chrome
  // (URL bar, keyboard) more accurately than window.innerHeight.
  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vpHeight = window.visualViewport?.height ?? window.innerHeight;
      const vpOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const availableBelow = vpHeight + vpOffsetTop - rect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
      const availableAbove = rect.top - vpOffsetTop - TRIGGER_GAP - VIEWPORT_MARGIN;
      // Flip the popup above the trigger when there's not enough room
      // below for a comfortable list AND there's more space above.
      // Keeps the default (open downward) for triggers high in the
      // viewport; auto-flips for triggers near the bottom edge.
      const placeAbove = availableBelow < POPUP_FLOOR && availableAbove > availableBelow;
      const maxHeight = Math.max(
        POPUP_FLOOR,
        Math.min(POPUP_CEILING, placeAbove ? availableAbove : availableBelow),
      );
      setGeometry({
        top: placeAbove
          ? rect.top - TRIGGER_GAP - maxHeight
          : rect.bottom + TRIGGER_GAP,
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    window.visualViewport?.addEventListener("resize", compute);
    window.visualViewport?.addEventListener("scroll", compute);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
      window.visualViewport?.removeEventListener("resize", compute);
      window.visualViewport?.removeEventListener("scroll", compute);
    };
  }, [open]);

  const commit = useCallback((next: T) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }, [onChange]);

  const openPopup = useCallback(() => {
    if (disabled) return;
    setHighlight(selectedIndex);
    setGeometry(null);
    setOpen(true);
  }, [disabled, selectedIndex]);

  const togglePopup = useCallback(() => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    setHighlight(selectedIndex);
    setGeometry(null);
    setOpen(true);
  }, [disabled, open, selectedIndex]);

  const handleTriggerKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      openPopup();
    }
  }, [openPopup]);

  const handleListKey = useCallback((e: React.KeyboardEvent) => {
    if (flat.length === 0) return;
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

  const popupNode = open && geometry && typeof document !== "undefined"
    ? createPortal(
        <ul
          ref={popupRef}
          className={`dropdown-select-popup ${popupClassName ?? ""}`}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleListKey}
          style={{
            position: "fixed",
            top: `${geometry.top}px`,
            left: `${geometry.left}px`,
            minWidth: `${geometry.width}px`,
            maxHeight: `${geometry.maxHeight}px`,
          }}
          // Autofocus for keyboard nav
          autoFocus
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
        </ul>,
        document.body,
      )
    : null;

  return (
    <div className="dropdown-select-root" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-select-trigger ${className ?? ""}`}
        onClick={togglePopup}
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
      {popupNode}
    </div>
  );
}
