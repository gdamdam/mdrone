import type { PitchClass, ViewMode } from "../types";
import { APP_VERSION } from "../config";
import type { SavedSession } from "../session";

const LOGO = "█▀▄▀█ █▀▄ █▀█ █▀█ █▄ █ █▀▀\n█ ▀ █ █▄▀ █▀▄ █▄█ █ ▀█ ██▄";
const PITCH_CLASSES: PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const OCTAVES = [1, 2, 3, 4, 5, 6] as const;

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
  onChangeTonic: (tonic: PitchClass) => void;
  onChangeOctave: (octave: number) => void;
  onToggleHold: () => void;
  holding: boolean;
  onToggleRec: () => void;
  onRandomScene: () => void;
  isRec: boolean;
  recTimeMs: number;
  recordingSupported: boolean;
  recordingTitle: string;
  recordingBusy: boolean;
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
  onChangeTonic,
  onChangeOctave,
  onToggleHold,
  holding,
  onToggleRec,
  onRandomScene,
  isRec,
  recTimeMs,
  recordingSupported,
  recordingTitle,
  recordingBusy,
}: HeaderProps) {
  const freqHz = pitchToFreq(tonic, octave);

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-brand">
          <div className="title">
            <pre className="title-art">{LOGO}</pre>
            <span className="title-version">v{APP_VERSION}</span>
            <span className="title-badge">EXPERIMENTAL</span>
          </div>

          <div className="header-brand-actions">
            {/* View toggle — only two views in mdrone */}
            <div className="view-toggle">
              {(["drone", "mixer"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={viewMode === m ? "view-btn view-btn-active" : "view-btn"}
                  title={
                    m === "drone"
                      ? "DRONE — the instrument: tonic, mode, atmosphere"
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
          </div>
        </div>
      </div>

      <div className="header-center">
        <div className="header-display" title={displayText}>
          <div className="header-display-track">
            <span>{displayText}</span>
            <span aria-hidden="true">{displayText}</span>
          </div>
        </div>
        <div className="header-tonic">
          <span className="header-mini-label">TONIC</span>
          <select
            value={tonic}
            onChange={(e) => onChangeTonic(e.target.value as PitchClass)}
            className="header-select header-select-tonic"
            title={`Current tonic: ${tonic}${octave}`}
          >
            {PITCH_CLASSES.map((pc) => (
              <option key={pc} value={pc}>
                {pc}
              </option>
            ))}
          </select>
        </div>
        <button
          className={holding ? "header-hold-btn header-hold-btn-active" : "header-hold-btn"}
          onClick={onToggleHold}
          title={holding ? "Release the drone" : "Hold the current tonic"}
        >
          <span className="header-hold-label">{holding ? "■ HOLDING" : "▶ HOLD"}</span>
          <span className="header-hold-sub">{tonic}{octave}</span>
        </button>
        <div className="header-tonic">
          <span className="header-mini-label">OCT</span>
          <select
            value={octave}
            onChange={(e) => onChangeOctave(parseInt(e.target.value, 10))}
            className="header-select header-select-octave"
            title={`Current octave: ${octave}`}
          >
            {OCTAVES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <button
          className="header-btn header-btn-random"
          onClick={onRandomScene}
          title="Load a gentle random scene variation"
        >
          RANDOM
        </button>
        <div className="header-freq">
          <span className="header-mini-label">HZ</span>
          <span className="header-freq-value">{freqHz.toFixed(1)} Hz</span>
        </div>
      </div>

      <div className="header-right">
        <div className="header-session">
          <span className="header-session-name" title={`Current session: ${currentSessionName}`}>
            {currentSessionName}
          </span>
          <div className="header-session-controls">
            <select
              value={currentSessionId ?? ""}
              onChange={(e) => {
                if (e.target.value) onLoadSession(e.target.value);
              }}
              className="header-select header-select-session"
              title="Load a saved session"
              disabled={sessions.length === 0}
            >
              <option value="">
                {sessions.length === 0 ? "No sessions" : "Load..."}
              </option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
            <button className="header-btn" onClick={onSaveSession} title="Save the current session">
              SAVE
            </button>
            <button className="header-btn" onClick={onRenameSession} title="Rename the current session">
              RENAME
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
