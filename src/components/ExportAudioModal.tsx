import { useEffect, useState } from "react";

/**
 * ExportAudioModal — single popover that consolidates the three audio
 * export workflows: live REC, seamless loop bounce, and a fixed-
 * duration auto-stop "EXPORT TAKE". Reuses the existing recorder /
 * loop-bouncer plumbing — nothing here renders audio offline.
 */
export interface ExportAudioModalProps {
  onClose: () => void;
  // REC LIVE — mirrors the inline REC WAV button.
  isRec: boolean;
  recordingBusy: boolean;
  recordingSupported: boolean;
  recordingTitle?: string;
  recTimeMs: number;
  onToggleRec: () => void;
  // BOUNCE LOOP — mirrors the inline LOOP control + length picker.
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
  onClose,
  isRec, recordingBusy, recordingSupported, recordingTitle, recTimeMs, onToggleRec,
  loopLengthSec, onLoopLengthChange, loopBusy, loopProgress, onBounceLoop, onCancelBounceLoop,
  takeBusy, takeProgress, onExportTake, onCancelExportTake,
}: ExportAudioModalProps) {
  const [takeMs, setTakeMs] = useState<number>(60_000);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const recDisabled = !recordingSupported || recordingBusy || loopBusy || takeBusy;
  const loopDisabled = loopBusy
    ? !onCancelBounceLoop
    : (isRec || recordingBusy || takeBusy || !recordingSupported);
  const takeDisabled = !recordingSupported || isRec || recordingBusy || loopBusy;

  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div
        className="fx-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Export audio"
      >
        <div className="fx-modal-header">
          <div className="fx-modal-title">EXPORT AUDIO</div>
          <div className="fx-modal-actions">
            <button
              type="button"
              className="header-btn"
              onClick={onClose}
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
        </div>
        <p className="fx-modal-desc">
          All three workflows are realtime captures of the live master
          output — there is no offline render. Long takes consume browser
          memory; recommended max ≈ 30 min.
        </p>

        <div className="fx-modal-params">

          {/* REC LIVE */}
          <div className="fx-modal-section-label">REC LIVE</div>
          <p className="fx-modal-desc">
            Capture the live performance — every gesture you make while
            recording lands in the WAV. Auto-starts HOLD if it isn't already on.
          </p>
          <div className="fx-modal-actions">
            <button
              type="button"
              className={isRec ? "preset-mut-btn preset-mut-btn-rec" : "preset-mut-btn"}
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

          <div className="fx-modal-divider" />

          {/* BOUNCE LOOP */}
          <div className="fx-modal-section-label">BOUNCE LOOP</div>
          <p className="fx-modal-desc">
            Sampler / DAW-ready loop WAV — fixed length with a
            crossfade seam and RIFF <code>smpl</code> loop points so
            samplers auto-detect the loop region.
          </p>
          <div className="fx-modal-actions">
            <select
              className="preset-mut-select loop-bounce-length"
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
              className={loopBusy ? "preset-mut-btn preset-mut-btn-loop" : "preset-mut-btn"}
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

          <div className="fx-modal-divider" />

          {/* EXPORT TAKE */}
          <div className="fx-modal-section-label">EXPORT TAKE</div>
          <p className="fx-modal-desc">
            Pick a duration — recording starts immediately, stops
            automatically, and downloads. Realtime capture (not offline
            render). Auto-starts HOLD.
          </p>
          <div className="share-style-row" role="radiogroup" aria-label="Take duration">
            {TAKE_DURATIONS.map((opt) => (
              <button
                key={opt.ms}
                type="button"
                role="radio"
                aria-checked={takeMs === opt.ms}
                className={takeMs === opt.ms ? "share-style-btn share-style-btn-active" : "share-style-btn"}
                onClick={() => setTakeMs(opt.ms)}
                disabled={takeBusy}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="fx-modal-actions">
            <button
              type="button"
              className={takeBusy ? "preset-mut-btn preset-mut-btn-rec" : "preset-mut-btn"}
              onClick={takeBusy ? onCancelExportTake : () => onExportTake(takeMs)}
              disabled={takeBusy ? !onCancelExportTake : takeDisabled}
              title={takeBusy
                ? "Stop and discard the in-progress take"
                : `Record exactly ${fmtMmSs(takeMs)} of master output, then download as WAV`}
            >
              {takeBusy && takeProgress
                ? `■ STOP ${fmtMmSs(takeProgress.elapsedMs)} / ${fmtMmSs(takeProgress.totalMs)}`
                : `⤓ EXPORT ${fmtMmSs(takeMs)} TAKE`}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
