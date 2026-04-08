import type { ViewMode } from "../types";
import { APP_VERSION } from "../config";
import type { SavedSession } from "../session";

const LOGO = "█▀▄▀█ █▀▄ █▀█ █▀█ █▄ █ █▀▀\n█ ▀ █ █▄▀ █▀▄ █▄█ █ ▀█ ██▄";

interface HeaderProps {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  sessions: SavedSession[];
  currentSessionId: string | null;
  currentSessionName: string;
  onLoadSession: (id: string) => void;
  onSaveSession: () => void;
  onRenameSession: () => void;
  onToggleRec: () => void;
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
  onToggleRec,
  isRec,
  recTimeMs,
  recordingSupported,
  recordingTitle,
  recordingBusy,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="title">
        <pre className="title-art">{LOGO}</pre>
        <span className="title-version">v{APP_VERSION}</span>
        <span className="title-badge">EXPERIMENTAL</span>
      </div>

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
            className="header-select"
            title="Load a saved session"
            disabled={sessions.length === 0}
          >
            <option value="">
              {sessions.length === 0 ? "No saved sessions" : "Load session..."}
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

      {/* Master record — captures the drone output as a WAV */}
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
    </header>
  );
}
