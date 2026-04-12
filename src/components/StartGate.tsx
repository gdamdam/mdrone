import { useRef, useState } from "react";
import { APP_VERSION } from "../config";
import { PALETTES, applyPalette } from "../themes";
import { type AutosavedScene, resetAllLocalStorage } from "../session";
import { DialogModal } from "./DialogModal";

const LOGO = "█▀▄▀█ █▀▄ █▀█ █▀█ █▄ █ █▀▀\n█ ▀ █ █▄▀ █▀▄ █▄█ █ ▀█ ██▄";

interface StartGateProps {
  onStart: (mode: "continue" | "new") => Promise<void> | void;
  lastScene?: AutosavedScene | null;
}

export function StartGate({ onStart, lastScene = null }: StartGateProps) {
  const [startingMode, setStartingMode] = useState<"continue" | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logoRef = useRef<HTMLPreElement>(null);
  const flashTimer = useRef(0);
  const logoClickCount = useRef(0);
  const logoClickTimer = useRef(0);

  const flashLogo = () => {
    const el = logoRef.current;
    if (!el) return;
    el.classList.remove("logo-flash");
    void el.offsetWidth;
    el.classList.add("logo-flash");
  };

  const handleLogoClick = () => {
    logoClickCount.current++;
    flashLogo();
    clearTimeout(logoClickTimer.current);
    logoClickTimer.current = window.setTimeout(() => {
      if (logoClickCount.current >= 2) {
        const randomPalette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
        applyPalette(randomPalette);
      }
      logoClickCount.current = 0;
    }, 400);
  };

  const handleStart = (mode: "continue" | "new") => {
    flashLogo();
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(async () => {
      setStartingMode(mode);
      setError(null);
      try {
        await onStart(mode);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start audio.");
        setStartingMode(null);
        flashLogo();
      }
    }, 380);
  };

  const lastSceneTimestamp = lastScene
    ? new Date(lastScene.savedAt).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="start-gate">
      <div className="start-gate-inner">
        <div className="start-gate-brand">
          <pre
            ref={logoRef}
            className="start-gate-title"
            onClick={handleLogoClick}
          >
            {LOGO}
          </pre>
          <span className="start-gate-badge">EXPERIMENTAL</span>
        </div>

        <p className="start-gate-sub">
          Browser drone instrument
          <br />
          Start a gentle scene, shape the tone,
          <br />
          and let the room breathe.
        </p>

        <div className="start-gate-actions">
          {lastScene ? (
            <div className="start-gate-actions start-gate-actions-split">
              <button
                className="start-btn"
                onClick={() => handleStart("continue")}
                disabled={startingMode !== null}
              >
                {startingMode === "continue" ? "Restoring..." : "Continue Last Scene"}
              </button>
              <button
                className="start-btn start-btn-secondary"
                onClick={() => handleStart("new")}
                disabled={startingMode !== null}
              >
                {startingMode === "new" ? "Starting..." : "Start New"}
              </button>
            </div>
          ) : (
            <button
              className="start-btn"
              onClick={() => handleStart("new")}
              disabled={startingMode !== null}
            >
              {startingMode ? "Starting..." : "Start mdrone"}
            </button>
          )}
        </div>

        {error && <p className="start-gate-error">{error}</p>}

        {lastScene && (
          <div className="start-gate-restore">
            <strong className="start-gate-restore-name">{lastScene.scene.name}</strong>
            <span>Last scene saved {lastSceneTimestamp}</span>
          </div>
        )}

        <div className="start-gate-intro">
          {lastScene
            ? "Reopen the last room exactly as you left it, or begin a fresh drone."
            : "Opens straight into a gentle random drone."}
        </div>

        <div className="start-gate-pills" aria-hidden="true">
          <span className="start-gate-pill">Instant sound</span>
          <span className="start-gate-pill">Saved sessions</span>
          <span className="start-gate-pill">Free + open source</span>
        </div>

        <div className="start-gate-meta">
          Session state stays in your browser.
          <br />
          Double-click the logo to reshuffle the palette.
        </div>

        <ResetButton />

        <span className="start-gate-version">v{APP_VERSION}</span>
      </div>
    </div>
  );
}

function ResetButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="start-gate-reset"
        onClick={() => setOpen(true)}
        title="Factory reset — clears saved sessions, autosave, palette, and all local settings"
      >
        Reset everything
      </button>
      {open && (
        <DialogModal
          title="Reset Everything"
          description="This wipes all saved sessions, the autosaved scene, palette choice, and every mdrone setting from localStorage. Cannot be undone."
          mode="confirm"
          confirmLabel="RESET"
          danger
          onConfirm={() => { resetAllLocalStorage(); window.location.reload(); }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}
