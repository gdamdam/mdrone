import { useRef, useState } from "react";
import { APP_VERSION } from "../config";
import { PALETTES, applyPalette } from "../themes";

const LOGO = "█▀▄▀█ █▀▄ █▀█ █▀█ █▄ █ █▀▀\n█ ▀ █ █▄▀ █▀▄ █▄█ █ ▀█ ██▄";

interface StartGateProps {
  onStart: () => Promise<void> | void;
}

export function StartGate({ onStart }: StartGateProps) {
  const [starting, setStarting] = useState(false);
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

  const handleStart = () => {
    flashLogo();
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(async () => {
      setStarting(true);
      setError(null);
      try {
        await onStart();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start audio.");
        setStarting(false);
        flashLogo();
      }
    }, 380);
  };

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
          <button className="start-btn" onClick={handleStart} disabled={starting}>
            {starting ? "Starting..." : "Start mdrone"}
          </button>
        </div>

        {error && <p className="start-gate-error">{error}</p>}

        <div className="start-gate-intro">
          Opens straight into a gentle random drone.
        </div>

        <div className="start-gate-pills" aria-hidden="true">
          <span className="start-gate-pill">Instant sound</span>
          <span className="start-gate-pill">Saved sessions</span>
          <span className="start-gate-pill">Free + open source</span>
          <span className="start-gate-pill">Local only</span>
        </div>

        <div className="start-gate-meta">
          Session state stays in your browser.
          <br />
          Double-click the logo to reshuffle the palette.
        </div>

        <span className="start-gate-version">v{APP_VERSION}</span>
      </div>
    </div>
  );
}
