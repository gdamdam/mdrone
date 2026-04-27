import { useEffect, useRef, useState } from "react";

interface DialogModalProps {
  /** Modal title */
  title: string;
  /** Description / warning text */
  description?: string;
  /** "prompt" shows a text input, "confirm" shows only buttons */
  mode: "prompt" | "confirm";
  /** Default value for the text input (prompt mode) */
  defaultValue?: string;
  /** Label for the confirm/submit button */
  confirmLabel?: string;
  /** Danger styling for the confirm button */
  danger?: boolean;
  /** Called with the input value (prompt) or true (confirm) */
  onConfirm: (value: string) => void;
  /** Called on cancel / backdrop click / Escape */
  onCancel: () => void;
}

export function DialogModal({
  title,
  description,
  mode,
  defaultValue = "",
  confirmLabel = "OK",
  danger = false,
  onConfirm,
  onCancel,
}: DialogModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "prompt") {
      // Focus + select all on mount
      const el = inputRef.current;
      if (el) { el.focus(); el.select(); }
    }
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleSubmit = () => {
    if (mode === "prompt") {
      const trimmed = value.trim();
      if (trimmed) onConfirm(trimmed);
    } else {
      onConfirm("");
    }
  };

  return (
    <div className="fx-modal-backdrop" onClick={onCancel}>
      <div className="fx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fx-modal-header">
          <div className="fx-modal-title">{title}</div>
          <button
            className="fx-modal-close"
            onClick={onCancel}
            title="Close (Esc)"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {description && <p className="fx-modal-desc">{description}</p>}
        {mode === "prompt" && (
          <div className="fx-modal-params">
            <input
              ref={inputRef}
              type="text"
              className="dialog-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
          </div>
        )}
        <div className="fx-modal-actions">
          <button className="header-btn" onClick={onCancel}>
            CANCEL
          </button>
          <button
            className={danger ? "header-btn header-btn-danger" : "header-btn header-btn-primary"}
            onClick={handleSubmit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
