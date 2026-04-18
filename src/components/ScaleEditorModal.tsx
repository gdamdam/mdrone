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

import { useMemo, useState } from "react";
import {
  BUILTIN_TUNINGS,
  DEGREE_LABELS,
  deleteCustomTuning,
  getAllTunings,
  getCustomTunings,
  saveCustomTuning,
  type TuningId,
  type TuningTable,
} from "../microtuning";

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

  const handleSaveAndApply = () => {
    const table = saveCustomTuning(name || "Untitled", degrees);
    refreshRegistry();
    onApply(table);
    onClose();
  };

  const handleDelete = (id: TuningId) => {
    deleteCustomTuning(id);
    refreshRegistry();
  };

  const handleLoadExisting = (t: TuningTable) => {
    setBaseId(t.id);
    setName(t.label);
    setDegrees([...t.degrees]);
  };

  const customs = getCustomTunings();

  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div className="fx-modal scale-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fx-modal-header">
          <div className="fx-modal-title">Scale Editor · custom tuning</div>
          <button className="fx-modal-close" onClick={onClose} title="Close (Esc)">×</button>
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

        <div className="scale-editor-actions">
          <button
            className="scale-editor-primary-btn"
            onClick={handleSaveAndApply}
            disabled={!name.trim()}
            title={!name.trim() ? "Name required" : "Save to localStorage and apply as active tuning"}
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
