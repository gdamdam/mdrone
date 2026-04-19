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
        <span className="start-gate-corner start-gate-corner-tl" aria-hidden="true" />
        <span className="start-gate-corner start-gate-corner-tr" aria-hidden="true" />
        <span className="start-gate-corner start-gate-corner-bl" aria-hidden="true" />
        <span className="start-gate-corner start-gate-corner-br" aria-hidden="true" />

        <div className="start-gate-supra">browser instrument · long tones · open source</div>

        <button
          type="button"
          className="start-gate-sigil"
          aria-label="Shuffle palette"
          onClick={handleLogoClick}
        >
          <svg viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="sg-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                <stop offset="60%" stopColor="currentColor" stopOpacity="0.05" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="200" cy="200" r="190" fill="url(#sg-glow)" />
            <g className="start-gate-sigil-ring" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.45">
              <circle cx="200" cy="200" r="190" />
              <circle cx="200" cy="200" r="172" strokeDasharray="2 6" />
              <circle cx="200" cy="200" r="150" />
            </g>
            <g stroke="currentColor" strokeWidth="0.7" opacity="0.55">
              <line x1="200" y1="10" x2="200" y2="24" />
              <line x1="200" y1="390" x2="200" y2="376" />
              <line x1="10" y1="200" x2="24" y2="200" />
              <line x1="390" y1="200" x2="376" y2="200" />
              <line x1="62" y1="62" x2="72" y2="72" />
              <line x1="338" y1="62" x2="328" y2="72" />
              <line x1="62" y1="338" x2="72" y2="328" />
              <line x1="338" y1="338" x2="328" y2="328" />
            </g>
            <g className="start-gate-sigil-mark" strokeWidth="1.8" strokeLinecap="round" fill="none">
              <path d="M200 70 Q 195 180 200 220 Q 205 260 200 330" />
              <path d="M200 110 Q 120 140 130 220 Q 140 280 200 300" />
              <path d="M200 110 Q 290 160 280 230 Q 268 296 200 320" />
              <path d="M140 200 Q 200 160 260 200" />
              <path d="M200 220 L 175 280" />
              <path d="M200 220 L 228 276" />
              <path d="M178 92 Q 200 78 222 92" />
            </g>
            <circle cx="200" cy="70" r="3.5" className="start-gate-sigil-dot" />
            <circle cx="200" cy="330" r="3" className="start-gate-sigil-dot" />
            <g stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.5">
              <path d="M86 112 L 96 108 L 92 122" />
              <path d="M306 106 L 318 112 L 310 124 L 318 130" />
              <path d="M90 292 L 100 300 L 94 310" />
              <path d="M302 298 L 314 290 L 308 308" />
            </g>
          </svg>
        </button>

        <div className="start-gate-brand" style={{ display: "flex", alignItems: "flex-start", gap: 8, justifyContent: "center" }}>
          <pre
            ref={logoRef}
            className="start-gate-title"
            onClick={handleLogoClick}
          >
            {LOGO}
          </pre>
          <span
            aria-label="Beta"
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1.2,
              color: "#1a0f08",
              background: "var(--preview)",
              padding: "2px 6px",
              borderRadius: 3,
              textTransform: "uppercase",
              marginTop: 4,
            }}
          >
            beta
          </span>
        </div>

        <p className="start-gate-sub">
          <em>A browser drone instrument.</em>
          <br />
          Hold a tone.
          <br />
          Let the room breathe.
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

        <ResetButton />

        <a href="./about.html" className="start-gate-landing-link">About</a>

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
