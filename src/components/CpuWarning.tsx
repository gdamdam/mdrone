import { useEffect, useState } from "react";
import type { AudioLoadMonitor, AudioLoadState } from "../engine/AudioLoadMonitor";
import type { AdaptiveStabilityState } from "../engine/AdaptiveStabilityEngine";

interface CpuWarningProps {
  monitor: AudioLoadMonitor;
  adaptive?: {
    getState: () => AdaptiveStabilityState;
    subscribe: (l: (s: AdaptiveStabilityState) => void) => () => void;
  };
  /** Optional handler to copy the full audio diagnostics report.
   *  Shown as a button in the detail modal when present. */
  onCopyAudioReport?: () => void | Promise<void>;
}

export function CpuWarning({ monitor, adaptive, onCopyAudioReport }: CpuWarningProps) {
  const [state, setState] = useState<AudioLoadState>(() => monitor.getState());
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveStabilityState | null>(
    () => adaptive ? adaptive.getState() : null,
  );
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => monitor.subscribe(setState), [monitor]);
  useEffect(() => {
    if (!adaptive) return;
    return adaptive.subscribe(setAdaptiveState);
  }, [adaptive]);

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetailOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailOpen]);

  const stage = adaptiveState?.stage ?? 0;
  if (!state.struggling && stage === 0) return null;

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
              {adaptiveState && stage > 0 && (
                <div className="fx-modal-param">
                  <span className="fx-modal-param-label">
                    MITIGATION <span className="fx-modal-param-value">stage {stage}</span>
                  </span>
                </div>
              )}
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
            {onCopyAudioReport && (
              <div className="fx-modal-actions">
                <button
                  className="header-btn"
                  onClick={() => { void onCopyAudioReport(); }}
                  title="Copy a structured audio diagnostics report (no scene data) to your clipboard"
                >
                  COPY AUDIO REPORT
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
