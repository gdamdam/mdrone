import { useEffect, useState } from "react";
import type { AudioLoadMonitor, AudioLoadState } from "../engine/AudioLoadMonitor";

interface CpuWarningProps {
  monitor: AudioLoadMonitor;
}

export function CpuWarning({ monitor }: CpuWarningProps) {
  const [state, setState] = useState<AudioLoadState>(() => monitor.getState());
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => monitor.subscribe(setState), [monitor]);

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetailOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailOpen]);

  if (!state.struggling) return null;

  return (
    <>
      <button
        type="button"
        className="cpu-warning"
        onClick={() => setDetailOpen(true)}
        aria-live="polite"
        aria-label="CPU under load — tap for details"
        title="Audio is struggling. Tap for details."
      >
        CPU
      </button>
      {detailOpen && (
        <div className="fx-modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div className="fx-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fx-modal-header">
              <div className="fx-modal-title">Audio Load</div>
              <button
                className="fx-modal-close"
                onClick={() => setDetailOpen(false)}
                title="Close (Esc)"
                aria-label="Close audio load details"
              >
                ×
              </button>
            </div>
            <p className="fx-modal-desc">
              The audio thread is falling behind wall-clock, which usually
              means crackling. Try closing other tabs or apps, or disable
              heavy effects (shimmer, granular, plate).
            </p>
            <div className="fx-modal-params">
              <div className="fx-modal-param">
                <span className="fx-modal-param-label">
                  DRIFT <span className="fx-modal-param-value">{state.driftMs.toFixed(1)} ms</span>
                </span>
              </div>
              <div className="fx-modal-param">
                <span className="fx-modal-param-label">
                  UNDERRUNS <span className="fx-modal-param-value">{state.underruns}</span>
                </span>
              </div>
              <div className="fx-modal-param">
                <span className="fx-modal-param-label">
                  BASE LATENCY <span className="fx-modal-param-value">{state.baseLatencyMs.toFixed(1)} ms</span>
                </span>
              </div>
              <div className="fx-modal-param">
                <span className="fx-modal-param-label">
                  OUTPUT LATENCY <span className="fx-modal-param-value">{state.outputLatencyMs.toFixed(1)} ms</span>
                </span>
              </div>
              <div className="fx-modal-param">
                <span className="fx-modal-param-label">
                  SAMPLE RATE <span className="fx-modal-param-value">{state.sampleRate} Hz</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
