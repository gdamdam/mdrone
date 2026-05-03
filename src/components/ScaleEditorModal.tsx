/**
 * ScaleEditorModal — custom tuning table editor.
 *
 * Reached from the ✎ button beside the tuning picker in the SHAPE
 * panel. Lets the user author a 13-degree tuning table (P1..P8 in
 * cents above the root), save it to localStorage, and apply it as
 * the active tuning. The SHAPE tuning dropdown will automatically
 * list saved tables alongside the builtin scales because microtuning
 * exposes them through the same TUNINGS proxy.
 *
 * Storage: `mdrone.customTunings` — registry persistence lives in
 * `src/microtuning.ts` (loadCustomTuningsFromStorage /
 * saveCustomTuning / deleteCustomTuning). This component never
 * writes localStorage directly.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BUILTIN_TUNINGS,
  DEGREE_LABELS,
  customTuningIdForName,
  deleteCustomTuning,
  getAllTunings,
  getCustomTunings,
  saveCustomTuning,
  type TuningId,
  type TuningTable,
} from "../microtuning";
import { loadSessions } from "../session";

interface ScaleEditorModalProps {
  /** Currently active tuning id — shown pre-selected in "COPY FROM".
   *  null means the user is in non-microtuning mode (legacy scale). */
  currentTuningId: TuningId | null;
  /** Called when the user hits SAVE & APPLY. Modal closes after. */
  onApply: (tuning: TuningTable) => void;
  onClose: () => void;
}

const DEGREE_CLAMP_MIN = -100;  // allow pulling below 0 cents for exotic tunings
const DEGREE_CLAMP_MAX = 1300;

function formatCents(v: number): string {
  return v.toFixed(2);
}

export function ScaleEditorModal({ currentTuningId, onApply, onClose }: ScaleEditorModalProps) {
  const [allTunings, setAllTunings] = useState<readonly TuningTable[]>(() => getAllTunings());

  // "COPY FROM" seed. Defaults to the currently active tuning if it
  // exists, else the first builtin. Changing it loads that table's
  // degrees into the editor grid (overwriting any in-progress edits,
  // so warn the user via a dedicated button rather than auto-applying).
  const initialBase = useMemo(() => {
    if (currentTuningId) {
      const match = allTunings.find((t) => t.id === currentTuningId);
      if (match) return match;
    }
    return BUILTIN_TUNINGS[0];
  }, [allTunings, currentTuningId]);

  const [baseId, setBaseId] = useState<TuningId>(initialBase.id);
  const [name, setName] = useState<string>(() => {
    // If editing an existing custom tuning, pre-fill the name so
    // Save replaces instead of creating a sibling.
    if (currentTuningId?.startsWith("custom:")) {
      const existing = allTunings.find((t) => t.id === currentTuningId);
      if (existing) return existing.label;
    }
    return "";
  });
  const [degrees, setDegrees] = useState<number[]>(() => [...initialBase.degrees]);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && typeof opener.focus === "function") {
        try { opener.focus(); } catch { /* ok */ }
      }
    };
  }, [onClose]);

  const refreshRegistry = () => setAllTunings(getAllTunings());

  const handleBaseChange = (nextBaseId: TuningId) => {
    setBaseId(nextBaseId);
    const base = allTunings.find((t) => t.id === nextBaseId);
    if (base) setDegrees([...base.degrees]);
  };

  const handleCentsChange = (index: number, raw: string) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(DEGREE_CLAMP_MIN, Math.min(DEGREE_CLAMP_MAX, n));
    setDegrees((prev) => {
      const next = [...prev];
      next[index] = clamped;
      return next;
    });
  };

  const customs = getCustomTunings();

  // Collision detection — the slug derived from `name` becomes the
  // tuning id. If a different existing custom tuning already owns
  // that slug, saving would silently overwrite it. Block the save and
  // surface the conflict so the user picks a fresh name. Saving on
  // top of the *same* tuning the editor was opened on is fine — that
  // is "edit in place" and the expected update flow.
  const wouldBeId = customTuningIdForName(name);
  const collidingTuning = customs.find(
    (t) => t.id === wouldBeId && t.id !== currentTuningId,
  );
  const hasCollision = Boolean(collidingTuning);
  const saveDisabled = hasCollision;

  const handleSaveAndApply = () => {
    if (saveDisabled) return;
    const table = saveCustomTuning(name || "Untitled", degrees);
    refreshRegistry();
    onApply(table);
    onClose();
  };

  const handleDelete = (id: TuningId) => {
    // Cascade check — if any saved session or the current scene
    // references this tuning, deletion would silently break those
    // round-trips (load falls back to equal temperament). Surface a
    // confirm with the count so the user can back out.
    const sessionRefs = loadSessions().filter(
      (s) => s.scene.drone.tuningId === id,
    );
    const usedByCurrent = currentTuningId === id;
    const refCount = sessionRefs.length + (usedByCurrent ? 1 : 0);
    if (refCount > 0) {
      const sessionLabels = sessionRefs.slice(0, 3).map((s) => `“${s.name}”`).join(", ");
      const more = sessionRefs.length > 3 ? ` and ${sessionRefs.length - 3} more` : "";
      const lines = [
        `This tuning is in use by ${refCount} place${refCount === 1 ? "" : "s"}.`,
        usedByCurrent ? "• the current scene" : null,
        sessionRefs.length > 0 ? `• saved session${sessionRefs.length === 1 ? "" : "s"}: ${sessionLabels}${more}` : null,
        "",
        "Deleting will fall those scenes back to equal temperament when reloaded.",
        "",
        "Delete anyway?",
      ].filter(Boolean).join("\n");
      const ok = window.confirm(lines);
      if (!ok) return;
    }
    deleteCustomTuning(id);
    refreshRegistry();
  };

  const handleLoadExisting = (t: TuningTable) => {
    setBaseId(t.id);
    setName(t.label);
    setDegrees([...t.degrees]);
  };

  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div
        className="fx-modal scale-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fx-modal-header">
          <div className="fx-modal-title" id={titleId}>Scale Editor · custom tuning</div>
          <button ref={closeRef} className="fx-modal-close" onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
        </div>
        <p className="fx-modal-desc">
          Author a 13-degree tuning table. Cents are measured above the
          root (P1 = 0, P8 = 1200 in equal temperament). Saved tables
          appear in the SHAPE tuning picker alongside the builtins.
        </p>

        <div className="scale-editor-row">
          <label className="scale-editor-label">COPY FROM</label>
          <select
            className="scale-editor-select"
            value={baseId}
            onChange={(e) => handleBaseChange(e.target.value as TuningId)}
          >
            <optgroup label="Builtin">
              {BUILTIN_TUNINGS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </optgroup>
            {customs.length > 0 && (
              <optgroup label="Custom">
                {customs.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div className="scale-editor-row">
          <label className="scale-editor-label">NAME</label>
          <input
            type="text"
            className="scale-editor-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. my-pythagorean"
            maxLength={40}
          />
        </div>

        <div className="scale-editor-grid">
          {DEGREE_LABELS.map((lbl, i) => (
            <div key={lbl} className="scale-editor-degree">
              <span className="scale-editor-degree-label">{lbl}</span>
              <input
                type="number"
                className="scale-editor-cents"
                step="0.01"
                value={formatCents(degrees[i] ?? 0)}
                onChange={(e) => handleCentsChange(i, e.target.value)}
              />
              <span className="scale-editor-cents-unit">¢</span>
            </div>
          ))}
        </div>

        {customs.length > 0 && (
          <>
            <div className="fx-modal-section-label">SAVED TUNINGS</div>
            <div className="scale-editor-saved-list">
              {customs.map((t) => (
                <div key={t.id} className="scale-editor-saved-row">
                  <span className="scale-editor-saved-name">{t.label}</span>
                  <button
                    className="scale-editor-small-btn"
                    onClick={() => handleLoadExisting(t)}
                    title="Load this tuning into the editor"
                  >
                    LOAD
                  </button>
                  <button
                    className="scale-editor-small-btn scale-editor-danger-btn"
                    onClick={() => handleDelete(t.id)}
                    title="Delete this tuning permanently"
                  >
                    DEL
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {hasCollision && (
          <p className="scale-editor-warning" role="alert">
            A custom tuning called{" "}
            <strong>{collidingTuning?.label ?? "this name"}</strong>{" "}
            already exists. Pick a different name to avoid overwriting it.
          </p>
        )}
        <div className="scale-editor-actions">
          <button
            className="scale-editor-primary-btn"
            onClick={handleSaveAndApply}
            disabled={!name.trim() || saveDisabled}
            title={
              !name.trim()
                ? "Name required"
                : hasCollision
                  ? "Name collides with an existing custom tuning — rename to save"
                  : "Save to localStorage and apply as active tuning"
            }
          >
            SAVE &amp; APPLY
          </button>
          <button className="scale-editor-secondary-btn" onClick={onClose}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
