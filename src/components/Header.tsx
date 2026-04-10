import { useEffect, useRef, useState } from "react";
import type { PitchClass, ViewMode } from "../types";
import { APP_VERSION } from "../config";
import { resetAllLocalStorage, type SavedSession } from "../session";
import type { MidiDevice } from "../engine/midiInput";
import { midiNoteToPitch } from "../engine/midiInput";

const LOGO = "█▀▄▀█ █▀▄ █▀█ █▀█ █▄ █ █▀▀\n█ ▀ █ █▄▀ █▀▄ █▄█ █ ▀█ ██▄";
const PITCH_CLASSES: PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function pitchToFreq(pc: PitchClass, octave: number): number {
  const idx = PITCH_CLASSES.indexOf(pc);
  const semitonesFromA4 = idx - 9 + (octave - 4) * 12;
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

interface HeaderProps {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  sessions: SavedSession[];
  currentSessionId: string | null;
  currentSessionName: string;
  onLoadSession: (id: string) => void;
  onSaveSession: () => void;
  onRenameSession: () => void;
  displayText: string;
  tonic: PitchClass;
  octave: number;
  onToggleHold: () => void;
  holding: boolean;
  onToggleRec: () => void;
  onPanic: () => void;
  onOpenShare: () => void;
  onRandomScene: () => void;
  onUndoScene: () => void;
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
    let smoothedRms = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3);
      smoothedRms += (rms - smoothedRms) * 0.25;
      const t = performance.now() / 1000;
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
    tick();
    return () => {
      cancelAnimationFrame(raf);
      if (el) {
        el.style.transform = "";
        el.style.textShadow = "";
      }
    };
  }, [analyser]);
  const freqHz = pitchToFreq(tonic, octave);
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
      </div>

      <div className="header-row header-row-main">
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

        <button
          className={isRec ? "header-btn header-btn-rec" : "header-btn"}
          onClick={onToggleRec}
          title={recordingTitle}
          disabled={!recordingSupported || recordingBusy}
        >
          {!recordingSupported
            ? "REC N/A"
            : recordingBusy
              ? "REC..."
              : isRec
            ? `■ ${Math.floor(recTimeMs / 60000)}:${String(
                Math.floor((recTimeMs / 1000) % 60)
              ).padStart(2, "0")}`
            : "● REC"}
        </button>
        <button
          className="header-btn header-btn-panic"
          onClick={onPanic}
          title="Panic — stop the drone and kill any lingering reverb/delay tails. Standard MIDI-style emergency silence."
        >
          P
        </button>
        <button
          className="header-btn header-btn-share"
          onClick={onOpenShare}
          title="Share the current drone landscape as a link"
        >
          ⤴ SHARE
        </button>

        <div className="header-center">
        <div className="header-display" title={displayText}>
          <div className="header-display-track">
            {displayText} <span className="header-display-sep">●</span> {displayText} <span className="header-display-sep">●</span> {displayText} <span className="header-display-sep">●</span>
          </div>
        </div>
        <button
          className="header-btn header-btn-random"
          onClick={onRandomScene}
          title="Load a gentle random scene variation"
        >
          RND
        </button>
        <button
          className="header-btn header-btn-undo"
          onClick={onUndoScene}
          title="Undo — restore the scene that was playing before the last RND"
          aria-label="Undo random scene"
        >
          ↶
        </button>
        <button
          className={holding ? "header-hold-btn header-hold-btn-active" : "header-hold-btn"}
          onClick={onToggleHold}
          title={holding ? "Release the drone" : "Hold the current tonic"}
        >
          <span className="header-hold-label">{holding ? "■ HOLDING" : "▶ HOLD"}</span>
          <span className="header-hold-sub">{tonic}{octave}</span>
        </button>
        <div className="header-freq">
          <span className="header-mini-label">HZ</span>
          <span className="header-freq-value">{freqHz.toFixed(1)} Hz</span>
        </div>
        <button
          className="header-btn header-btn-volume"
          onClick={() => setVolumeOpen(true)}
          title={`Master volume: ${volPct}% — click to adjust`}
        >
          VOL {volPct}
        </button>
        <button
          className="header-btn header-btn-menu"
          onClick={() => setSessionOpen(true)}
          title={`Settings — sessions, MIDI, reset`}
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
              <button
                className="fx-modal-close"
                onClick={() => setSessionOpen(false)}
                title="Close (Esc)"
              >
                ×
              </button>
            </div>
            <p className="fx-modal-desc">
              Current: <strong>{currentSessionName}</strong>
            </p>
            <div className="fx-modal-params">
              <div className="fx-modal-section-label">SESSION</div>
              <label className="fx-modal-param">
                <span className="fx-modal-param-label">LOAD</span>
                <select
                  value={currentSessionId ?? ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      onLoadSession(e.target.value);
                      setSessionOpen(false);
                    }
                  }}
                  className="header-select"
                  disabled={sessions.length === 0}
                >
                  <option value="">
                    {sessions.length === 0 ? "No sessions" : "Select…"}
                  </option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="fx-modal-actions">
                <button
                  className="header-btn"
                  onClick={() => { onSaveSession(); setSessionOpen(false); }}
                  title="Save the current session"
                >
                  SAVE
                </button>
                <button
                  className="header-btn"
                  onClick={() => { onRenameSession(); setSessionOpen(false); }}
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

              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">RESET</div>
              <p className="fx-modal-desc">
                Wipe all saved sessions, autosave, palette, and every mdrone setting from localStorage. Cannot be undone.
              </p>
              <div className="fx-modal-actions">
                <button
                  className="header-btn header-btn-danger"
                  onClick={() => {
                    if (window.confirm("Reset everything? This wipes all saved sessions, autosave, palette, and every mdrone-* key in localStorage. Cannot be undone.")) {
                      resetAllLocalStorage();
                      window.location.reload();
                    }
                  }}
                >
                  RESET EVERYTHING
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
