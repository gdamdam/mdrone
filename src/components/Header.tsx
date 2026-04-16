import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { PitchClass, ViewMode } from "../types";
import { APP_VERSION } from "../config";
import { resetAllLocalStorage, type SavedSession } from "../session";
import type { MidiDevice } from "../engine/midiInput";
import { midiNoteToPitch } from "../engine/midiInput";
import { DialogModal } from "./DialogModal";
import { DropdownSelect } from "./DropdownSelect";

const HelpModal = lazy(() =>
  import("./HelpModal").then((m) => ({ default: m.HelpModal })),
);

const LOGO = "█▀▄▀█ █▀▄ █▀█ █▀█ █▄ █ █▀▀\n█ ▀ █ █▄▀ █▀▄ █▄█ █ ▀█ ██▄";


interface HeaderProps {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  sessions: SavedSession[];
  currentSessionId: string | null;
  currentSessionName: string;
  onLoadSession: (id: string) => void;
  onSaveSession: (name: string) => void;
  onRenameSession: (name: string) => void;
  getDefaultSessionName: () => string;
  displayText: string;
  tonic: PitchClass;
  octave: number;
  onChangeTonic: (pc: PitchClass) => void;
  onChangeOctave: (octave: number) => void;
  onToggleHold: () => void;
  holding: boolean;
  onToggleRec: () => void;
  onPanic: () => void;
  onOpenShare: () => void;
  onRandomScene: () => void;
  onUndoScene: () => void;
  /** Pre-formatted "fine-tune active" hint string (e.g. "±7 ¢"),
   *  or null when no offsets are non-zero or microtuning isn't on. */
  tuneOffsetHint?: string | null;
  isRec: boolean;
  recTimeMs: number;
  recordingSupported: boolean;
  recordingTitle: string;
  recordingBusy: boolean;
  volume: number;
  onChangeVolume: (v: number) => void;
  midiSupported: boolean;
  midiEnabled: boolean;
  midiDevices: MidiDevice[];
  midiLastNote: number | null;
  midiError: string | null;
  onToggleMidi: (on: boolean) => void;
  midiCcMap: import("../engine/midiMapping").CcMap;
  midiLearnTarget: import("../engine/midiMapping").MidiTarget | null;
  onMidiLearn: (target: import("../engine/midiMapping").MidiTarget | null) => void;
  onMidiResetMap: () => void;
  weatherVisual: import("../config").WeatherVisual;
  onChangeWeatherVisual: (v: import("../config").WeatherVisual) => void;
  motionRecEnabled: boolean;
  onToggleMotionRec: (on: boolean) => void;
  analyser: AnalyserNode | null;
}

/**
 * Minimal header — logo + view toggle + REC button + version.
 * No BPM, no sync modes, no metronome — mdrone has no clock.
 */
export function Header({
  viewMode,
  setViewMode,
  sessions,
  currentSessionId,
  currentSessionName,
  onLoadSession,
  onSaveSession,
  onRenameSession,
  getDefaultSessionName,
  displayText,
  tonic,
  octave,
  onToggleHold,
  holding,
  onToggleRec,
  onPanic,
  onOpenShare,
  onRandomScene,
  onUndoScene,
  isRec,
  recTimeMs,
  recordingSupported,
  recordingTitle,
  recordingBusy,
  volume,
  onChangeVolume,
  midiSupported,
  midiEnabled,
  midiDevices,
  midiLastNote,
  midiError,
  onToggleMidi,
  midiCcMap,
  midiLearnTarget,
  onMidiLearn,
  onMidiResetMap,
  weatherVisual,
  onChangeWeatherVisual,
  motionRecEnabled,
  onToggleMotionRec,
  analyser,
}: HeaderProps) {
  // Drone logo vibration — rAF loop reads the master analyser's RMS
  // and writes a tiny translate transform on the title-art element.
  // Purely imperative: no React state, so no re-renders.
  const titleArtRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!analyser) return;
    const el = titleArtRef.current;
    if (!el) return;
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let lastPaint = -Infinity;
    let smoothedRms = 0;
    const FRAME_MS = 1000 / 30;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (now - lastPaint < FRAME_MS) return;
      lastPaint = now;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3);
      smoothedRms += (rms - smoothedRms) * 0.25;
      const t = now / 1000;
      // Two-axis jitter — fast micro-sine on top of the rms amplitude
      const amp = smoothedRms * 1.8;
      const dx = Math.sin(t * 23.1) * amp;
      const dy = Math.cos(t * 29.7) * amp;
      el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      // Glow that tracks the level — ember text-shadow that grows
      // with rms. Two stacked shadows for a soft + tight halo.
      const glowR = 4 + smoothedRms * 16;
      const glowA = 0.35 + smoothedRms * 0.5;
      el.style.textShadow =
        `0 0 ${glowR.toFixed(1)}px rgba(255, 160, 60, ${glowA.toFixed(2)}),` +
        ` 0 0 ${(glowR * 0.35).toFixed(1)}px rgba(255, 220, 120, ${(glowA * 1.1).toFixed(2)})`;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (el) {
        el.style.transform = "";
        el.style.textShadow = "";
      }
    };
  }, [analyser]);
  const [volumeOpen, setVolumeOpen] = useState(false);
  useEffect(() => {
    if (!volumeOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVolumeOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [volumeOpen]);
  // Volume shares the mixer VOL strip range (0..1.5). % is of the 0..1.5 span.
  const volPct = Math.round((volume / 1.5) * 100);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"save" | "rename" | "reset" | null>(null);
  useEffect(() => {
    if (!sessionOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSessionOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionOpen]);

  const lastNoteLabel = midiLastNote !== null
    ? (() => { const p = midiNoteToPitch(midiLastNote); return `${p.pitchClass}${p.octave} (${midiLastNote})`; })()
    : "—";

  return (
    <header className="header">
      <div className="header-row header-row-brand">
        <div className="title">
          <pre ref={titleArtRef} className="title-art">{LOGO}</pre>
          <span className="title-version">v{APP_VERSION}</span>
          <span className="title-badge">EXPERIMENTAL</span>
        </div>
        <a
          className="title-sigil"
          href="./about.html"
          aria-label="About mdrone"
          title="About mdrone"
        >
          <svg viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="title-sigil-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
                <stop offset="60%" stopColor="currentColor" stopOpacity="0.06" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="200" cy="200" r="190" fill="url(#title-sigil-glow)" />
            <g stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.45">
              <circle cx="200" cy="200" r="190" />
              <circle cx="200" cy="200" r="172" strokeDasharray="3 9" />
            </g>
            <g stroke="currentColor" strokeWidth="1.2" opacity="0.55">
              <line x1="200" y1="10" x2="200" y2="26" />
              <line x1="200" y1="390" x2="200" y2="374" />
              <line x1="10" y1="200" x2="26" y2="200" />
              <line x1="390" y1="200" x2="374" y2="200" />
            </g>
            <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" fill="none">
              <path d="M200 70 Q 195 180 200 220 Q 205 260 200 330" />
              <path d="M200 110 Q 120 140 130 220 Q 140 280 200 300" />
              <path d="M200 110 Q 290 160 280 230 Q 268 296 200 320" />
              <path d="M140 200 Q 200 160 260 200" />
              <path d="M200 220 L 175 280" />
              <path d="M200 220 L 228 276" />
              <path d="M178 92 Q 200 78 222 92" />
            </g>
            <circle cx="200" cy="70" r="8" fill="currentColor" />
            <circle cx="200" cy="330" r="6" fill="currentColor" opacity="0.8" />
          </svg>
        </a>
      </div>

      <div className="header-row header-row-main">
        {/* Left — surface tabs */}
        <div className="view-toggle">
          {(["drone", "meditate", "mixer"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={viewMode === m ? "view-btn view-btn-active" : "view-btn"}
              title={
                m === "drone"
                  ? "DRONE — the instrument: tonic, mode, atmosphere"
                  : m === "meditate"
                    ? "MEDITATE — visualizer that breathes with the drone"
                    : "MIXER — master bus: HPF · 3-band EQ · glue · drive · limiter"
              }
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Center — scene marquee */}
        <div className="header-display" title={displayText}>
          <div className="header-display-track">
            {displayText} <span className="header-display-sep">●</span> {displayText} <span className="header-display-sep">●</span> {displayText} <span className="header-display-sep">●</span>
          </div>
        </div>

        {/* Right — primary play controls */}
        <div className="header-center">
        <button
          className="header-btn header-btn-random"
          onClick={onRandomScene}
          title="Load a gentle random scene variation"
        >
          <span className="header-btn-label-full">RND</span>
          <span className="header-btn-label-glyph" aria-hidden="true">RND</span>
        </button>
        <button
          className="header-btn header-btn-share"
          onClick={onOpenShare}
          title="Share the current drone landscape as a link"
        >
          <span className="header-btn-label-full">SHARE</span>
          <span className="header-btn-label-glyph" aria-hidden="true">SHARE</span>
        </button>
        <button
          className={holding ? "header-hold-btn header-hold-btn-active" : "header-hold-btn"}
          onClick={onToggleHold}
          title={holding ? "Release the drone" : "Hold the current tonic"}
        >
          <span className="header-hold-label">{holding ? "■ HOLDING" : "▶ HOLD"}</span>
          <span className="header-hold-sub">{tonic}{octave}</span>
          <span className="header-hold-glyph" aria-hidden="true">
            {holding ? "■" : "▶"}
          </span>
        </button>
        </div>

        {/* Secondary — quieter controls */}
        <div className="header-secondary">
        <button
          className="header-btn header-btn-undo"
          onClick={onUndoScene}
          title="Undo — restore the scene that was playing before the last RND or MUT"
          aria-label="Undo random scene"
        >
          ↶
        </button>
        <button
          className={`header-btn header-btn-record${isRec ? " header-btn-rec" : ""}`}
          onClick={onToggleRec}
          title={recordingTitle}
          disabled={!recordingSupported || recordingBusy}
        >
          <span className="header-btn-label-full">
            {!recordingSupported
              ? "REC N/A"
              : recordingBusy
                ? "REC..."
                : isRec
              ? `■ ${Math.floor(recTimeMs / 60000)}:${String(
                  Math.floor((recTimeMs / 1000) % 60)
                ).padStart(2, "0")}`
              : "● REC"}
          </span>
          <span className="header-btn-label-glyph" aria-hidden="true">
            {!recordingSupported ? "●" : recordingBusy ? "…" : isRec ? "■" : "●"}
          </span>
        </button>
        <button
          className="header-btn header-btn-volume"
          onClick={() => setVolumeOpen(true)}
          title={`Master volume: ${volPct}% — click to adjust`}
        >
          <span className="header-btn-label-full">VOL {volPct}</span>
          <span className="header-btn-label-glyph" aria-hidden="true">VOL</span>
        </button>
        <button
          className="header-btn header-btn-menu"
          onClick={() => setSessionOpen(true)}
          title={`Settings — sessions, MIDI, panic, reset`}
          aria-label="Open settings"
        >
          ⚙
        </button>
        </div>
      </div>

      {volumeOpen && (
        <div className="fx-modal-backdrop" onClick={() => setVolumeOpen(false)}>
          <div className="fx-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fx-modal-header">
              <div className="fx-modal-title">Master Volume</div>
              <button
                className="fx-modal-close"
                onClick={() => setVolumeOpen(false)}
                title="Close (Esc)"
              >
                ×
              </button>
            </div>
            <p className="fx-modal-desc">
              Final output trim applied after the master chain. Smoothly ramped.
            </p>
            <div className="fx-modal-params">
              <label className="fx-modal-param">
                <span className="fx-modal-param-label">
                  VOLUME <span className="fx-modal-param-value">{volPct}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={volume}
                  onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
                  aria-label="Master volume"
                />
              </label>
            </div>
          </div>
        </div>
      )}


      {sessionOpen && (
        <div className="fx-modal-backdrop" onClick={() => setSessionOpen(false)}>
          <div className="fx-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fx-modal-header">
              <div className="fx-modal-title">Settings</div>
              <div className="fx-modal-header-actions">
                <button
                  className="fx-modal-help"
                  onClick={() => setHelpOpen(true)}
                  title="Open help"
                  aria-label="Open help"
                >
                  ?
                </button>
                <button
                  className="fx-modal-close"
                  onClick={() => setSessionOpen(false)}
                  title="Close (Esc)"
                >
                  ×
                </button>
              </div>
            </div>
            <p className="fx-modal-desc">
              Current: <strong>{currentSessionName}</strong>
            </p>
            <div className="fx-modal-params">
              <div className="fx-modal-section-label">SESSION</div>
              <label className="fx-modal-param">
                <span className="fx-modal-param-label">LOAD</span>
                <DropdownSelect
                  value={currentSessionId ?? ""}
                  options={[
                    { value: "", label: sessions.length === 0 ? "No sessions" : "Select\u2026" },
                    ...sessions.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  onChange={(v) => {
                    if (v) {
                      onLoadSession(v);
                      setSessionOpen(false);
                    }
                  }}
                  className="header-select"
                  disabled={sessions.length === 0}
                />
              </label>
              <div className="fx-modal-actions">
                <button
                  className="header-btn"
                  onClick={() => { setSessionOpen(false); setDialogMode("save"); }}
                  title="Save the current session"
                >
                  SAVE
                </button>
                <button
                  className="header-btn"
                  onClick={() => { setSessionOpen(false); setDialogMode("rename"); }}
                  title="Rename the current session"
                >
                  RENAME
                </button>
              </div>

              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">MIDI INPUT</div>
              <p className="fx-modal-desc">
                External keyboard → tonic + octave. Any note-on maps to the drone root.
              </p>
              <div className="fx-modal-actions">
                <button
                  className={midiEnabled ? "header-btn header-btn-midi-on" : "header-btn"}
                  onClick={() => onToggleMidi(!midiEnabled)}
                  disabled={!midiSupported}
                  title={!midiSupported ? "Web MIDI unavailable" : midiEnabled ? "Disable MIDI input" : "Enable MIDI input"}
                >
                  {!midiSupported ? "UNSUPPORTED" : midiEnabled ? "● ENABLED" : "ENABLE"}
                </button>
              </div>
              <div className="fx-modal-param">
                <span className="fx-modal-param-label">
                  DEVICES <span className="fx-modal-param-value">{midiDevices.length}</span>
                </span>
                {midiDevices.length === 0 ? (
                  <div className="midi-device-empty">
                    {midiEnabled ? "No MIDI inputs detected." : "Enable MIDI to scan for devices."}
                  </div>
                ) : (
                  <ul className="midi-device-list">
                    {midiDevices.map((d) => (
                      <li key={d.id} className={`midi-device midi-device-${d.state}`}>
                        <span className="midi-device-name">{d.name}</span>
                        {d.manufacturer && <span className="midi-device-mfr"> · {d.manufacturer}</span>}
                        <span className="midi-device-state"> · {d.state}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="fx-modal-param">
                <span className="fx-modal-param-label">
                  LAST NOTE <span className="fx-modal-param-value">{lastNoteLabel}</span>
                </span>
              </div>
              {midiError && <div className="midi-error">{midiError}</div>}

              {midiEnabled && (<>
              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">MIDI CC MAPPING</div>
              <p className="fx-modal-desc">
                {midiLearnTarget
                  ? `Move a knob or fader to assign it to ${midiLearnTarget.toUpperCase()}...`
                  : "Click a parameter to learn a CC, or use the defaults."}
              </p>
              <div className="midi-cc-grid">
                {(["weatherX", "weatherY", "drift", "air", "time", "bloom", "glide", "sub", "volume", "hold"] as const).map((target) => {
                  const cc = Object.entries(midiCcMap).find(([, v]) => v === target)?.[0] ?? "—";
                  const isLearning = midiLearnTarget === target;
                  return (
                    <button
                      key={target}
                      className={`midi-cc-btn${isLearning ? " midi-cc-btn-learn" : ""}`}
                      onClick={() => onMidiLearn(isLearning ? null : target)}
                      title={isLearning ? "Cancel learn" : `CC${cc} → ${target}. Click to re-learn.`}
                    >
                      <span className="midi-cc-target">{target.toUpperCase()}</span>
                      <span className="midi-cc-num">{isLearning ? "..." : `CC${cc}`}</span>
                    </button>
                  );
                })}
              </div>
              <div className="fx-modal-actions">
                <button className="header-btn" onClick={onMidiResetMap}>
                  RESET TO DEFAULTS
                </button>
              </div>
              </>)}

              <div className="fx-modal-divider" />
              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">WEATHER VISUAL</div>
              <div className="share-style-row" role="radiogroup" aria-label="Weather visual style">
                {(["waveform", "flow", "minimal"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={weatherVisual === v}
                    className={weatherVisual === v ? "share-style-btn share-style-btn-active" : "share-style-btn"}
                    onClick={() => onChangeWeatherVisual(v)}
                  >
                    {v === "waveform" ? "WAVEFORM" : v === "flow" ? "FLOW FIELD" : "MINIMAL"}
                  </button>
                ))}
              </div>

              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">ADVANCED</div>
              <p className="fx-modal-desc">
                Motion recording captures meaningful gesture events
                (60 s / 200 max) into the next share URL so the
                recipient hears the same sweep you made. Off by
                default — toggle on to reveal the REC MOTION button
                in the drone view.
              </p>
              <div className="fx-modal-actions">
                <button
                  className={motionRecEnabled ? "header-btn header-btn-midi-on" : "header-btn"}
                  onClick={() => onToggleMotionRec(!motionRecEnabled)}
                  title={motionRecEnabled
                    ? "Hide the REC MOTION button"
                    : "Show the REC MOTION button in the drone view"}
                >
                  {motionRecEnabled ? "● MOTION RECORDING" : "MOTION RECORDING"}
                </button>
              </div>

              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">PANIC</div>
              <p className="fx-modal-desc">
                Stop the drone and kill any lingering reverb/delay tails. Standard MIDI-style emergency silence.
              </p>
              <div className="fx-modal-actions">
                <button
                  className="header-btn"
                  onClick={() => { onPanic(); setSessionOpen(false); }}
                  title="Panic — silence everything immediately"
                >
                  PANIC
                </button>
              </div>

              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">RESET</div>
              <p className="fx-modal-desc">
                Wipe all saved sessions, autosave, palette, and every mdrone setting from localStorage. Cannot be undone.
              </p>
              <div className="fx-modal-actions">
                <button
                  className="header-btn header-btn-danger"
                  onClick={() => { setSessionOpen(false); setDialogMode("reset"); }}
                >
                  RESET EVERYTHING
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <Suspense fallback={null}>
          <HelpModal onClose={() => setHelpOpen(false)} />
        </Suspense>
      )}

      {dialogMode === "save" && (
        <DialogModal
          title="Save Session"
          description="Name for the new session."
          mode="prompt"
          defaultValue={getDefaultSessionName()}
          confirmLabel="SAVE"
          onConfirm={(name) => { onSaveSession(name); setDialogMode(null); }}
          onCancel={() => setDialogMode(null)}
        />
      )}
      {dialogMode === "rename" && (
        <DialogModal
          title="Rename Session"
          description={`Current: ${currentSessionName}`}
          mode="prompt"
          defaultValue={currentSessionName}
          confirmLabel="RENAME"
          onConfirm={(name) => { onRenameSession(name); setDialogMode(null); }}
          onCancel={() => setDialogMode(null)}
        />
      )}
      {dialogMode === "reset" && (
        <DialogModal
          title="Reset Everything"
          description="This wipes all saved sessions, autosave, palette, and every mdrone setting from localStorage. Cannot be undone."
          mode="confirm"
          confirmLabel="RESET"
          danger
          onConfirm={() => { resetAllLocalStorage(); window.location.reload(); }}
          onCancel={() => setDialogMode(null)}
        />
      )}
    </header>
  );
}
