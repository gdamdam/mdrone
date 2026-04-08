import type { ViewMode } from "../types";
import { APP_VERSION } from "../config";

const LOGO = "█▀▄▀█ █▀▄ █▀█ █▀█ █▄ █ █▀▀\n█ ▀ █ █▄▀ █▀▄ █▄█ █ ▀█ ██▄";

interface HeaderProps {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  onToggleRec: () => void;
  isRec: boolean;
  recTimeMs: number;
}

/**
 * Minimal header — logo + view toggle + REC button + version.
 * No BPM, no sync modes, no metronome — mdrone has no clock.
 */
export function Header({
  viewMode,
  setViewMode,
  onToggleRec,
  isRec,
  recTimeMs,
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

      {/* Master record — captures the drone output as a WAV */}
      <button
        className={isRec ? "header-btn header-btn-rec" : "header-btn"}
        onClick={onToggleRec}
        title={
          isRec
            ? "Stop master recording and download the WAV"
            : "Record the full master output as a WAV file"
        }
      >
        {isRec
          ? `■ ${Math.floor(recTimeMs / 60000)}:${String(
              Math.floor((recTimeMs / 1000) % 60)
            ).padStart(2, "0")}`
          : "● REC"}
      </button>
    </header>
  );
}
