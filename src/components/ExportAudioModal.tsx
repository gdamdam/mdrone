import { useEffect, useRef, useState } from "react";

/**
 * ExportAudioMenu — header dropdown that consolidates the three audio
 * export workflows: live REC, seamless loop bounce, and a fixed-
 * duration auto-stop TIMED REC. Anchored under the ⤓ header button
 * (matches the MIDI dropdown's outside-click + Esc behaviour).
 *
 * Reuses the existing recorder / loop-bouncer plumbing — nothing here
 * renders audio offline.
 */
export interface ExportAudioModalProps {
  /** Position-anchor element — used so click-outside ignores its own
   *  trigger button. The dropdown still renders inside this anchor. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  // REC LIVE — mirrors the existing REC WAV button.
  isRec: boolean;
  recordingBusy: boolean;
  recordingSupported: boolean;
  recordingTitle?: string;
  recTimeMs: number;
  onToggleRec: () => void;
  // BOUNCE LOOP — mirrors the existing LOOP control + length picker.
  loopLengthSec: number;
  onLoopLengthChange: (sec: number) => void;
  loopBusy: boolean;
  loopProgress: { elapsedSec: number; totalSec: number } | null;
  onBounceLoop: () => void;
  onCancelBounceLoop?: () => void;
  // EXPORT TAKE — fixed-duration realtime capture, auto-stops + downloads.
  takeBusy: boolean;
  takeProgress: { elapsedMs: number; totalMs: number } | null;
  onExportTake: (durationMs: number) => void;
  onCancelExportTake?: () => void;
}

const TAKE_DURATIONS: ReadonlyArray<{ label: string; ms: number }> = [
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "3m", ms: 180_000 },
  { label: "10m", ms: 600_000 },
];

function fmtMmSs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ExportAudioModal({
  anchorRef,
  onClose,
  isRec, recordingBusy, recordingSupported, recordingTitle, recTimeMs, onToggleRec,
  loopLengthSec, onLoopLengthChange, loopBusy, loopProgress, onBounceLoop, onCancelBounceLoop,
  takeBusy, takeProgress, onExportTake, onCancelExportTake,
}: ExportAudioModalProps) {
  const [takeMs, setTakeMs] = useState<number>(60_000);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef?.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, anchorRef]);

  const recDisabled = !recordingSupported || recordingBusy || loopBusy || takeBusy;
  const loopDisabled = loopBusy
    ? !onCancelBounceLoop
    : (isRec || recordingBusy || takeBusy || !recordingSupported);
  const takeDisabled = !recordingSupported || isRec || recordingBusy || loopBusy;

  return (
    <div ref={menuRef} className="export-menu" role="menu" aria-label="Export audio">
      {/* REC LIVE */}
      <div className="export-menu-section">
        <div className="export-menu-section-label">REC LIVE</div>
        <button
          type="button"
          className={isRec ? "export-menu-action export-menu-action-rec" : "export-menu-action"}
          onClick={onToggleRec}
          disabled={recDisabled && !isRec}
          title={recordingTitle ?? "Record master output to WAV"}
        >
          {!recordingSupported
            ? "WAV N/A"
            : recordingBusy
              ? "REC WAV…"
              : isRec
                ? `■ ${fmtMmSs(recTimeMs)}`
                : "● REC WAV"}
        </button>
      </div>

      <div className="export-menu-divider" />

      {/* BOUNCE LOOP */}
      <div className="export-menu-section">
        <div className="export-menu-section-label">BOUNCE LOOP</div>
        <div className="export-menu-row">
          <select
            className="preset-mut-select export-menu-select"
            value={loopLengthSec}
            onChange={(e) => onLoopLengthChange(parseInt(e.target.value, 10))}
            disabled={loopBusy || isRec || recordingBusy || takeBusy}
            aria-label="Loop length in seconds"
            title="Loop length — the output WAV's duration"
          >
            <option value={15}>15s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
          </select>
          <button
            type="button"
            className={loopBusy ? "export-menu-action export-menu-action-loop" : "export-menu-action"}
            onClick={loopBusy ? onCancelBounceLoop : onBounceLoop}
            disabled={loopDisabled}
            title={loopBusy
              ? "Stop — cancel the loop bounce (no WAV is saved)"
              : "Bounce a seamless loop at the selected length"}
          >
            {loopBusy && loopProgress
              ? `■ STOP ${Math.min(loopProgress.totalSec, Math.floor(loopProgress.elapsedSec))}/${Math.ceil(loopProgress.totalSec)}s`
              : "◌ LOOP"}
          </button>
        </div>
      </div>

      <div className="export-menu-divider" />

      {/* TIMED REC — fixed duration, auto-stop, downloads on completion. */}
      <div className="export-menu-section">
        <div className="export-menu-section-label">TIMED REC</div>
        <div className="export-menu-row" role="radiogroup" aria-label="Timed REC duration">
          {TAKE_DURATIONS.map((opt) => (
            <button
              key={opt.ms}
              type="button"
              role="radio"
              aria-checked={takeMs === opt.ms}
              className={takeMs === opt.ms ? "export-menu-pill export-menu-pill-active" : "export-menu-pill"}
              onClick={() => setTakeMs(opt.ms)}
              disabled={takeBusy}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={takeBusy ? "export-menu-action export-menu-action-rec" : "export-menu-action"}
          onClick={takeBusy ? onCancelExportTake : () => onExportTake(takeMs)}
          disabled={takeBusy ? !onCancelExportTake : takeDisabled}
          title={takeBusy
            ? "Stop and discard the in-progress timed REC"
            : `Record exactly ${fmtMmSs(takeMs)} of master output, then download as WAV`}
        >
          {takeBusy && takeProgress
            ? `■ STOP ${fmtMmSs(takeProgress.elapsedMs)} / ${fmtMmSs(takeProgress.totalMs)}`
            : `● REC ${fmtMmSs(takeMs)} ▸`}
        </button>
        <p className="export-menu-hint">
          Realtime — recorder runs for the full duration, then stops
          and downloads. Auto-starts HOLD.
        </p>
      </div>
    </div>
  );
}
