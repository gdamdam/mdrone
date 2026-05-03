import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { PitchClass, ViewMode } from "../types";
import { resetAllLocalStorage, type SavedSession } from "../session";
import type { MidiDevice } from "../engine/midiInput";
import { midiNoteToPitch } from "../engine/midiInput";
import { DialogModal } from "./DialogModal";
import { DropdownSelect } from "./DropdownSelect";
import {
  MIDI_TARGETS, MIDI_TARGETS_BY_ID, MIDI_TARGET_GROUPS,
  removeCc,
  loadTemplates, saveTemplate, deleteTemplate,
  exportCcMap, parseImportedCcMap,
  type MidiTemplates,
} from "../engine/midiMapping";
import { PALETTES, applyPalette, loadPaletteId, savePaletteId, type PaletteId } from "../themes";
import { enableLinkBridge, onLinkState, getLinkState, type LinkState } from "../engine/linkBridge";
import type { AudioLoadMonitor } from "../engine/AudioLoadMonitor";
import { CpuWarning } from "./CpuWarning";
import { hasAudioDebugFlag } from "../engine/audioDebug";
import { STORAGE_KEYS } from "../config";
import { showNotification } from "../notifications";
import { trackEvent } from "../analytics";
import { onCloseSettingsRequested } from "../tutorial/state";

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
  /** Serialize the current scene as JSON for download. Returns null
   *  if the engine isn't ready to capture (no DroneView mounted yet). */
  onExportSessionJson: () => { json: string; filename: string } | null;
  /** Apply a JSON-encoded portable scene from a user-selected file.
   *  Returns true on success, false on parse / validation failure. */
  onImportSessionJson: (text: string) => boolean;
  getDefaultSessionName: () => string;
  displayText: string;
  isArrivalPreset?: boolean;
  rndArrivalRemaining?: number;
  tonic: PitchClass;
  octave: number;
  onChangeTonic: (pc: PitchClass) => void;
  onChangeOctave: (octave: number) => void;
  onToggleHold: () => void;
  holding: boolean;
  /** True while the engine is in its first ~10s after pressing HOLD —
   *  delay lines, feedback states, and oversamplers are still settling.
   *  Surface as a subtle pulse on the HOLD button so users know not to
   *  push macros fast yet (post-cert finding #4). */
  warming?: boolean;
  onOpenShare: () => void;
  onRandomScene: () => void;
  /** Tapping the scene marquee (preset name display) expands the
   *  preset list — matches the behaviour of clicking the preset-strip
   *  meta button in the DRONE view. */
  onOpenPresets?: () => void;
  /** Pre-formatted "fine-tune active" hint string (e.g. "±7 ¢"),
   *  or null when no offsets are non-zero or microtuning isn't on. */
  tuneOffsetHint?: string | null;
  volume: number;
  onChangeVolume: (v: number) => void;
  midiSupported: boolean;
  midiEnabled: boolean;
  midiDevices: MidiDevice[];
  midiLastNote: number | null;
  midiError: string | null;
  onToggleMidi: (on: boolean) => void;
  midiCcMap: import("../engine/midiMapping").CcMap;
  midiLearnTarget: string | null;
  onMidiLearn: (target: string | null) => void;
  /** Replace the entire CC map (used by template load + import). */
  onMidiSetMap: (map: import("../engine/midiMapping").CcMap) => void;
  /** Global Ableton-style MIDI learn mode — when on, clicking any
   *  control with [data-midi-id] arms it for assignment. */
  midiLearnMode: boolean;
  onToggleMidiLearnMode: () => void;
  onMidiResetMap: () => void;
  weatherVisual: import("../config").WeatherVisual;
  onChangeWeatherVisual: (v: import("../config").WeatherVisual) => void;
  motionRecEnabled: boolean;
  onToggleMotionRec: (on: boolean) => void;
  lowPowerMode: boolean;
  onToggleLowPower: (on: boolean) => void;
  liveSafeMode: boolean;
  onToggleLiveSafeMode: (on: boolean) => void;
  /** Count of heavy FX currently bypassed by LIVE SAFE — surfaced in
   *  the header pill's tooltip so performers can read at a glance how
   *  much the mode is doing. 0 when LIVE SAFE is off. */
  liveSafeSuppressedFxCount?: number;
  analyser: AnalyserNode | null;
  loadMonitor: AudioLoadMonitor;
  adaptive?: {
    getState: () => import("../engine/AdaptiveStabilityEngine").AdaptiveStabilityState;
    subscribe: (l: (s: import("../engine/AdaptiveStabilityEngine").AdaptiveStabilityState) => void) => () => void;
  };
  /** Optional handler — copy a structured audio diagnostics report to
   *  the clipboard. Surfaced inside the CpuWarning detail modal. */
  onCopyAudioReport?: () => void | Promise<void>;
  /** Inline MEDITATE preview tile toggle. Lives next to HOLD so the
   *  performance row owns transport + visualizer in one place. */
  meditatePreviewOn: boolean;
  onToggleMeditatePreview: () => void;
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
  onExportSessionJson,
  onImportSessionJson,
  getDefaultSessionName,
  displayText,
  isArrivalPreset,
  rndArrivalRemaining,
  tonic,
  octave,
  onToggleHold,
  holding,
  warming = false,
  onOpenShare,
  onRandomScene,
  onOpenPresets,
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
  onMidiSetMap,
  midiLearnMode,
  onToggleMidiLearnMode,
  onMidiResetMap,
  weatherVisual,
  onChangeWeatherVisual,
  motionRecEnabled,
  onToggleMotionRec,
  lowPowerMode,
  onToggleLowPower,
  liveSafeMode,
  onToggleLiveSafeMode,
  liveSafeSuppressedFxCount = 0,
  analyser,
  loadMonitor,
  adaptive,
  onCopyAudioReport,
  meditatePreviewOn,
  onToggleMeditatePreview,
}: HeaderProps) {
  // Brand animation — rAF loop reads the master analyser's RMS and
  // writes a tiny translate transform plus a brightness filter onto
  // the `.title-brand` wrapper, so the wordmark vibrates and lights
  // up with the sound. Purely imperative: no React state, no
  // re-renders.
  //
  // When sound plays the cluster sits at its full static CSS look
  // (palette-aware --preview colour + the multi-layer halo defined
  // in globals.css `.title-art`, matching the splash page wordmark).
  // When silent, the brightness filter dims it.
  // text-shadow is intentionally NOT overridden inline — earlier
  // attempts to JS-write a warm rgb halo tinted the wordmark and
  // bloomed it on peaks; the static CSS halo is palette-aware and
  // already correct.
  const titleArtRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!analyser) return;
    const el = titleArtRef.current;
    if (!el) return;
    // The wordmark's direct parent is `.title-brand`. Transform +
    // filter live on this element; CpuWarning sits one level up
    // under `.title` and is not affected.
    const brand = el.parentElement;
    if (!brand) return;
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
      // Two-axis jitter — fast micro-sine on top of the rms amplitude.
      // Max amp 1.0 px (was 1.8 px) — keeps the cluster legible while
      // still reading as "alive" on peaks.
      const amp = smoothedRms * 1.0;
      const dx = Math.sin(t * 23.1) * amp;
      const dy = Math.cos(t * 29.7) * amp;
      // Brightness curve: 0.55 floor at true silence (45 % darker than
      // playing). Noise-floor gate at 0.025 RMS keeps convolver-tail
      // and analyser quantisation leakage from lifting the silent
      // state above the floor; sqrt(× 12) brings the curve to 1.0 by
      // RMS ≈ 0.108, so typical playback reads full-bright.
      //   true silence    (rms 0)     : 0.55
      //   noise floor     (rms 0.014) : 0.55 (gated)
      //   quiet play      (rms 0.05)  : 0.80
      //   moderate play   (rms 0.10)  : 0.98
      //   any louder                  : 1.00
      const NOISE_FLOOR = 0.025;
      const above = Math.max(0, smoothedRms - NOISE_FLOOR);
      const lit = Math.min(1, Math.sqrt(above * 12));
      const brightness = 0.55 + 0.45 * lit;
      brand.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      brand.style.filter = `brightness(${brightness.toFixed(3)})`;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (brand) {
        brand.style.transform = "";
        brand.style.filter = "";
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
  const [settingsTab, setSettingsTab] = useState<"session" | "appearance" | "tempo">("session");
  // Header-MIDI dropdown menu + dedicated MIDI modal. The Settings →
  // MIDI tab is gone; the modal is the single source of truth.
  const [midiMenuOpen, setMidiMenuOpen] = useState(false);
  const [midiModalOpen, setMidiModalOpen] = useState(false);
  const midiBtnRef = useRef<HTMLButtonElement>(null);
  const midiMenuRef = useRef<HTMLDivElement>(null);
  // Close popover on outside-click / Esc.
  useEffect(() => {
    if (!midiMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (midiBtnRef.current?.contains(t)) return;
      if (midiMenuRef.current?.contains(t)) return;
      setMidiMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMidiMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [midiMenuOpen]);
  useEffect(() => {
    if (!midiModalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMidiModalOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [midiModalOpen]);
  const [helpOpen, setHelpOpen] = useState(false);
  // MIDI mapping templates (saved CcMaps the user can swap between).
  const [midiTemplates, setMidiTemplates] = useState<MidiTemplates>(() => loadTemplates());
  const [midiTemplateName, setMidiTemplateName] = useState("");
  const midiImportRef = useRef<HTMLInputElement>(null);
  const [dialogMode, setDialogMode] = useState<"save" | "rename" | "reset" | null>(null);
  // Dedicated session sheet (◆ button) — popover for save / load /
  // rename / export-import JSON. Lives apart from the ⚙ settings sheet
  // so the most common pro workflow is one tap from the header.
  const [sessionSheetOpen, setSessionSheetOpen] = useState(false);
  const sessionImportInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!sessionSheetOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSessionSheetOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionSheetOpen]);

  // Marquee click arbitration: single-click opens the preset list,
  // double-click opens the rename dialog. The click fires twice on a
  // dblclick in every browser, so we defer the single-click action
  // by ~250 ms and cancel it when dblclick arrives.
  const marqueeClickTimerRef = useRef<number | null>(null);
  const [paletteId, setPaletteId] = useState<PaletteId>(() => loadPaletteId());
  const handlePickPalette = (id: PaletteId) => {
    const palette = PALETTES.find((p) => p.id === id);
    if (!palette) return;
    applyPalette(palette);
    savePaletteId(id);
    setPaletteId(id);
  };

  // Ableton Link (via the mpump Link Bridge companion app). Auto-
  // detect runs once on page load; this toggle forces explicit
  // enable with retries so the user can start the bridge at any
  // point and have mdrone attach when it appears.
  const [linkEnabled, setLinkEnabled] = useState<boolean>(() => {
    try { return window.localStorage?.getItem(STORAGE_KEYS.linkEnabled) === "1"; }
    catch { return false; }
  });
  const [linkState, setLinkState] = useState<LinkState>(() => getLinkState());
  const prevLinkConnectedRef = useRef(linkState.connected);
  useEffect(() => {
    const unsub = onLinkState((s) => setLinkState(s));
    return unsub;
  }, []);
  // Surface an explicit notification when the Link Bridge drops
  // mid-set — the user has opted in and is probably watching the
  // tempo-driven LFO, so silent disconnection would look like a
  // glitch rather than a missing companion app.
  useEffect(() => {
    const wasConnected = prevLinkConnectedRef.current;
    prevLinkConnectedRef.current = linkState.connected;
    if (!linkEnabled) return;
    if (wasConnected && !linkState.connected) {
      showNotification(
        "Link Bridge disconnected — tempo-synced controls fall back to free rate until it returns.",
        "warning",
      );
    }
  }, [linkState.connected, linkEnabled]);
  useEffect(() => {
    enableLinkBridge(linkEnabled);
    try { window.localStorage?.setItem(STORAGE_KEYS.linkEnabled, linkEnabled ? "1" : "0"); }
    catch { /* noop */ }
  }, [linkEnabled]);
  useEffect(() => {
    if (!sessionOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSessionOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionOpen]);

  // Tutorial flows may need the Settings modal out of the way so the
  // spotlight can target header / DroneView elements underneath.
  useEffect(() => {
    return onCloseSettingsRequested(() => setSessionOpen(false));
  }, []);

  const lastNoteLabel = midiLastNote !== null
    ? (() => { const p = midiNoteToPitch(midiLastNote); return `${p.pitchClass}${p.octave} (${midiLastNote})`; })()
    : "—";

  return (
    <header className={holding ? "header header-holding" : "header"}>
      <div className="header-row header-row-main">
        <div className="title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Brand cluster — just the wordmark now. The rAF loop in
              Header.tsx (vibration + brightness filter) targets the
              .title-brand wrapper so the wordmark animates as one
              unit. CpuWarning sits outside as a separate status
              indicator that should not vibrate with the brand. */}
          <div className="title-brand" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <pre ref={titleArtRef} className="title-art">{LOGO}</pre>
          </div>
          <CpuWarning
            monitor={loadMonitor}
            adaptive={adaptive}
            onCopyAudioReport={onCopyAudioReport}
          />
          {hasAudioDebugFlag("trace") && (
            <button
              type="button"
              onClick={() => {
                const w = window as unknown as { __mdroneDumpTrace?: (r?: string) => void };
                if (w.__mdroneDumpTrace) {
                  w.__mdroneDumpTrace("manual");
                  showNotification("Trace dumped to DevTools console (open it with ⌥⌘I / F12).", "info");
                } else {
                  showNotification("Trace not initialized yet — wait for audio to start.", "warning");
                }
              }}
              title="Dump audio trace ring buffer to DevTools console. Open DevTools (⌥⌘I / F12) before clicking — JS can't open it for you."
              style={{
                marginLeft: 6,
                padding: "2px 8px",
                fontSize: 10,
                fontFamily: "monospace",
                background: "rgba(255, 80, 80, 0.15)",
                border: "1px solid rgba(255, 80, 80, 0.5)",
                color: "var(--ink, #fff)",
                borderRadius: 3,
                cursor: "pointer",
                letterSpacing: "0.5px",
              }}
            >
              ⏺ DUMP TRACE
            </button>
          )}
        </div>
        {/* Center — scene marquee. Clickable so tapping the current
            preset name pops open the preset list (tab auto-switches
            to DRONE if the user is on MIDI / MIXER). */}
        <button
          type="button"
          className="header-display"
          title={`${displayText} — tap to browse presets · double-tap to rename the session`}
          onClick={() => {
            if (marqueeClickTimerRef.current !== null) {
              window.clearTimeout(marqueeClickTimerRef.current);
            }
            marqueeClickTimerRef.current = window.setTimeout(() => {
              marqueeClickTimerRef.current = null;
              setViewMode("drone");
              onOpenPresets?.();
            }, 250);
          }}
          onDoubleClick={() => {
            if (marqueeClickTimerRef.current !== null) {
              window.clearTimeout(marqueeClickTimerRef.current);
              marqueeClickTimerRef.current = null;
            }
            setDialogMode("rename");
          }}
        >
          <div className="header-display-track">
            {isArrivalPreset && <span className="header-display-arrival" aria-label="curated arrival preset" title="Curated arrival preset">✦</span>}
            {displayText} <span className="header-display-sep">●</span> {displayText} <span className="header-display-sep">●</span> {displayText} <span className="header-display-sep">●</span>
          </div>
        </button>

        {/* Right — primary play controls */}
        <div className="header-center">
        <span className="header-rnd-wrap">
        <button
          className="header-btn header-btn-random"
          onClick={onRandomScene}
          data-midi-id="rnd"
          title={
            rndArrivalRemaining && rndArrivalRemaining > 0
              ? `Load a random scene — curated arrival pool for the next ${rndArrivalRemaining} roll${rndArrivalRemaining === 1 ? "" : "s"}, then full library variety`
              : "Load a random scene from the full library"
          }
        >
          <span className="header-btn-label-full">RND</span>
          <span className="header-btn-label-glyph" aria-hidden="true">RND</span>
        </button>
        {rndArrivalRemaining && rndArrivalRemaining > 0 ? (
          <span
            className="header-rnd-pips"
            aria-hidden="true"
            title={`${rndArrivalRemaining} curated roll${rndArrivalRemaining === 1 ? "" : "s"} left`}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={i < rndArrivalRemaining ? "header-rnd-pip header-rnd-pip-on" : "header-rnd-pip"}
              >
                ✦
              </span>
            ))}
          </span>
        ) : null}
        </span>
        <button
          data-tutor="hold"
          data-midi-id="hold"
          className={[
            "header-hold-btn",
            holding ? "header-hold-btn-active" : "",
            warming && holding ? "header-hold-btn-warming" : "",
          ].filter(Boolean).join(" ")}
          onClick={onToggleHold}
          title={holding ? (warming ? "Engine warming up — let it settle for ~10s before pushing macros" : "Release the drone") : "Hold the current tonic"}
          aria-label={holding ? `Release drone (tonic ${tonic}${octave})` : `Hold drone (tonic ${tonic}${octave})`}
          aria-pressed={holding}
        >
          <span className="header-hold-label">{holding ? "■ HOLDING" : "▶ HOLD"}</span>
          <span className="header-hold-sub">{tonic}{octave}</span>
          <span className="header-hold-glyph" aria-hidden="true">
            {holding ? "■" : "▶"}
          </span>
        </button>
        <button
          type="button"
          className="header-btn header-btn-random"
          onClick={onToggleMeditatePreview}
          title={meditatePreviewOn ? "Hide MEDITATE preview" : "Show MEDITATE preview"}
          aria-label="Toggle MEDITATE preview"
          aria-pressed={meditatePreviewOn}
        >
          <span className="header-btn-label-full">◉ MEDITATE</span>
          <span className="header-btn-label-glyph" aria-hidden="true">◉</span>
        </button>
        </div>

        {/* MIXER — primary action (lives outside .header-secondary
            so it doesn't get dimmed with the admin cluster). Sits
            next to MEDITATE in the performance row. */}
        <button
          className={
            viewMode === "mixer"
              ? "header-btn header-btn-mixer header-btn-mixer-active"
              : "header-btn header-btn-mixer"
          }
          onClick={() => setViewMode(viewMode === "mixer" ? "drone" : "mixer")}
          title="MIXER — master bus drawer (HPF · 3-band EQ · glue · drive · limiter). Click again or tap outside to close."
          aria-label="Open mixer"
          aria-pressed={viewMode === "mixer"}
        >
          <span className="header-btn-label-full">MIXER</span>
          <span className="header-btn-label-glyph" aria-hidden="true">▤</span>
        </button>

        {/* LIVE SAFE — explicit stage-readiness pill. Lives in the
            performance row so the active state is impossible to miss
            during a set, distinct from the auto CPU-warning blink and
            from the gradient creative-active idiom of HOLD/MEDITATE.
            The same toggle still lives in Settings for discoverability. */}
        <button
          type="button"
          className={liveSafeMode ? "header-btn header-btn-livesafe header-btn-livesafe-active" : "header-btn header-btn-livesafe"}
          onClick={() => onToggleLiveSafeMode(!liveSafeMode)}
          aria-pressed={liveSafeMode}
          aria-label={liveSafeMode ? "LIVE SAFE on, press to disable" : "LIVE SAFE off, press to enable stage-stable mode"}
          title={
            liveSafeMode
              ? `LIVE SAFE on — voice cap 4, ${liveSafeSuppressedFxCount} heavy FX bypassed, low-power visuals. Click to disable.`
              : "LIVE SAFE — prioritize stable audio for stage / pro use. Caps voice density and bypasses heavy FX without touching your scene."
          }
        >
          <span aria-hidden="true">{liveSafeMode ? "●" : "◌"}</span>
        </button>

        {/* Admin cluster — VOL readout, help, settings. Quietest
            tier; dimmed via .header-secondary opacity until hover. */}
        <div className="header-secondary">
        <button
          className="header-btn header-btn-volume"
          onClick={() => setVolumeOpen(true)}
          title={`Master volume: ${volPct}% — click to adjust`}
          data-midi-id="volume"
        >
          <span className="header-btn-label-full">VOL {volPct}</span>
          <span className="header-btn-label-glyph" aria-hidden="true">VOL</span>
        </button>
        <span className="midi-menu-anchor">
          <button
            ref={midiBtnRef}
            className={
              midiLearnMode
                ? "header-btn header-btn-midi-learn header-btn-midi-learn-active"
                : midiEnabled
                  ? "header-btn header-btn-midi-learn header-btn-midi-learn-on"
                  : "header-btn header-btn-midi-learn"
            }
            onClick={() => setMidiMenuOpen((o) => !o)}
            disabled={!midiSupported}
            title={
              !midiSupported
                ? "Web MIDI is not available in this browser"
                : "MIDI — input + learn mode + mapping"
            }
            aria-haspopup="menu"
            aria-expanded={midiMenuOpen}
          >
            {midiLearnMode ? "● LEARN ▾" : midiEnabled ? "● MIDI ▾" : "MIDI ▾"}
          </button>
          {midiMenuOpen && (
            <div ref={midiMenuRef} className="midi-menu" role="menu">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={midiEnabled}
                className={midiEnabled ? "midi-menu-item midi-menu-item-on" : "midi-menu-item"}
                onClick={() => {
                  onToggleMidi(!midiEnabled);
                  if (midiEnabled && midiLearnMode) onToggleMidiLearnMode();
                }}
                disabled={!midiSupported}
                title="Connect to your MIDI controller — notes drive the tonic, CCs drive whatever you've mapped."
              >
                <span className="midi-menu-check">{midiEnabled ? "●" : "○"}</span>
                <span className="midi-menu-label">MIDI INPUT</span>
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={midiLearnMode}
                className={midiLearnMode ? "midi-menu-item midi-menu-item-on midi-menu-item-learn" : "midi-menu-item"}
                onClick={() => {
                  if (!midiEnabled) onToggleMidi(true);
                  onToggleMidiLearnMode();
                  setMidiMenuOpen(false);
                }}
                disabled={!midiSupported}
                title="Click any glowing control then move a knob/fader on your controller to map it."
              >
                <span className="midi-menu-check">{midiLearnMode ? "●" : "○"}</span>
                <span className="midi-menu-label">LEARN MODE</span>
              </button>
              <div className="midi-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="midi-menu-item"
                onClick={() => {
                  setMidiModalOpen(true);
                  setMidiMenuOpen(false);
                }}
                title="See the full mapping table, save / load templates, and import or export JSON."
              >
                <span className="midi-menu-check" aria-hidden="true">⌘</span>
                <span className="midi-menu-label">MAPPING</span>
              </button>
            </div>
          )}
        </span>
        <button
          className="header-btn"
          onClick={onOpenShare}
          title="Copy a self-contained URL of this scene — opens to the same drone landscape on any device."
          aria-label="Copy scene link"
        >
          LINK
        </button>
        <button
          data-tutor="session-btn"
          className="header-btn header-btn-session"
          onClick={() => setSessionSheetOpen(true)}
          title="Session — save, load, rename, export / import JSON"
          aria-label="Open session sheet"
        >
          ◆
        </button>
        <button
          className="header-btn header-btn-help"
          onClick={() => setHelpOpen(true)}
          title="Help — reference card + replay any tutorial"
          aria-label="Open help"
        >
          ?
        </button>
        <button
          data-tutor="settings-btn"
          className="header-btn header-btn-menu"
          onClick={() => setSessionOpen(true)}
          title={`Settings — MIDI, motion-rec, low-power, LIVE SAFE, reset`}
          aria-label="Open settings"
        >
          ⚙
        </button>
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
              <label className="fx-modal-param" data-midi-id="volume">
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
              <div className="settings-tabs" role="tablist" aria-label="Settings sections">
                {([
                  ["session", "GENERAL"],
                  ["appearance", "APPEARANCE"],
                  ["tempo", "TEMPO"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={settingsTab === id}
                    className={settingsTab === id ? "settings-tab settings-tab-active" : "settings-tab"}
                    onClick={() => setSettingsTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {settingsTab === "session" && (<>
              <p className="fx-modal-desc">
                Save, load, and rename sessions live on the <strong>\u25c6</strong> button
                in the header \u2014 left of the help (?) button. This panel keeps the
                rest of the device-wide preferences.
              </p>

              <div className="fx-modal-section-label">MOTION RECORDING</div>
              <p className="fx-modal-desc">
                Capture meaningful gesture events (60 s / 200 max) into
                the next share URL so the recipient hears the same sweep
                you made. Off by default — toggle on to reveal the REC
                MOTION button in the drone view.
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
              <div className="fx-modal-section-label">LOW-POWER MODE</div>
              <p className="fx-modal-desc">
                For older laptops, low-end Windows machines, and weak
                tablets. Clamps the MEDITATE visualizer to 15 fps,
                throttles the loudness meter, and skips a tiny
                preset-change duck. Off by default.
              </p>
              <div className="fx-modal-actions">
                <button
                  className={lowPowerMode ? "header-btn header-btn-midi-on" : "header-btn"}
                  onClick={() => onToggleLowPower(!lowPowerMode)}
                  aria-pressed={lowPowerMode}
                  aria-label={lowPowerMode ? "Low-power mode on, press to disable" : "Low-power mode off, press to enable"}
                  title={lowPowerMode
                    ? "Disable low-power mode"
                    : "Enable low-power mode for weaker hardware"}
                >
                  {lowPowerMode ? "● LOW-POWER MODE" : "LOW-POWER MODE"}
                </button>
              </div>

              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">LIVE SAFE</div>
              <p className="fx-modal-desc">
                Stage / pro use. Trades a bit of richness for solid
                audio: clamps the voice cap to 4, suppresses the
                heaviest FX (halo, granular, graincloud, shimmer,
                freeze), and engages low-power visuals. Saved scenes
                and share URLs are not changed — your settings are
                restored when LIVE SAFE is turned off.
              </p>
              <div className="fx-modal-actions">
                <button
                  className={liveSafeMode ? "header-btn header-btn-midi-on" : "header-btn"}
                  onClick={() => onToggleLiveSafeMode(!liveSafeMode)}
                  aria-pressed={liveSafeMode}
                  aria-label={liveSafeMode ? "LIVE SAFE on, press to disable" : "LIVE SAFE off, press to enable"}
                  title={liveSafeMode
                    ? "Disable LIVE SAFE — restore voice cap, heavy FX, and visuals"
                    : "Enable LIVE SAFE — prioritize stable audio for stage / pro use"}
                >
                  {liveSafeMode ? "● LIVE SAFE" : "LIVE SAFE"}
                </button>
              </div>

              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">RESET</div>
              <p className="fx-modal-desc">
                Wipe all saved sessions, autosave, palette, and every
                mdrone setting from localStorage. Cannot be undone.
              </p>
              <div className="fx-modal-actions">
                <button
                  className="header-btn header-btn-danger"
                  onClick={() => { setSessionOpen(false); setDialogMode("reset"); }}
                >
                  RESET EVERYTHING
                </button>
              </div>
              </>)}


              {settingsTab === "appearance" && (<>
              <div className="fx-modal-section-label">PALETTE</div>
              <div className="share-style-row" role="radiogroup" aria-label="Palette">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={paletteId === p.id}
                    className={paletteId === p.id ? "share-style-btn share-style-btn-active" : "share-style-btn"}
                    onClick={() => handlePickPalette(p.id)}
                    title={p.dark ? "Dark palette" : "Light palette — for bright rooms / stages"}
                  >
                    {p.name.toUpperCase()}
                  </button>
                ))}
              </div>

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

              </>)}

              {settingsTab === "tempo" && (<>
              <div className="fx-modal-section-label">ABLETON LINK</div>
              <p className="fx-modal-desc">
                Sync the LFO rate (and future rate controls) to
                Ableton Link tempo from Live, Logic, Bitwig, or any
                Link-enabled app. Requires the mpump Link Bridge
                companion — a tiny local app that translates Link's
                UDP multicast into a localhost WebSocket mdrone can
                read. Download:{" "}
                <a
                  href="https://github.com/gdamdam/mpump/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/gdamdam/mpump/releases
                </a>.
              </p>
              <div className="fx-modal-actions">
                <button
                  className={linkEnabled ? "header-btn header-btn-midi-on" : "header-btn"}
                  onClick={() => setLinkEnabled((v) => {
                    if (!v) trackEvent("feature/link");
                    return !v;
                  })}
                  title={linkEnabled
                    ? "Disable Ableton Link — stops retrying the bridge connection"
                    : "Enable Ableton Link — retries every 5 s until the bridge is running"}
                >
                  {linkEnabled ? "● LINK ON" : "LINK OFF"}
                </button>
                <span className="fx-modal-param-value">
                  {linkState.connected
                    ? `${linkState.tempo.toFixed(1)} BPM · ${linkState.peers} peer${linkState.peers === 1 ? "" : "s"}`
                    : linkEnabled
                      ? "Searching for Link Bridge…"
                      : "Bridge not connected"}
                </span>
              </div>

              </>)}
            </div>
          </div>
        </div>
      )}

      {midiModalOpen && (
        <div className="fx-modal-backdrop" onClick={() => setMidiModalOpen(false)}>
          <div className="fx-modal fx-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="fx-modal-header">
              <div className="fx-modal-title">MIDI Mapping</div>
              <button
                className="fx-modal-close"
                onClick={() => setMidiModalOpen(false)}
                title="Close (Esc)"
              >
                ×
              </button>
            </div>
            <div className="fx-modal-params">
              <div className="fx-modal-section-label">DEVICES</div>
              <p className="fx-modal-desc">
                External keyboard → tonic + octave. Use the <strong>MIDI</strong>
                {" "}button in the header to enable input + enter learn mode.
                {!midiSupported && " (Web MIDI is not available in this browser.)"}
              </p>
              <div className="fx-modal-param">
                <span className="fx-modal-param-label">
                  CONNECTED <span className="fx-modal-param-value">{midiDevices.length}</span>
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
              <div className="fx-modal-section-label">CC MAPPING</div>
              <p className="fx-modal-desc">
                {midiLearnTarget
                  ? `Move a knob or fader to assign it to ${(MIDI_TARGETS_BY_ID.get(midiLearnTarget)?.label ?? midiLearnTarget).toUpperCase()}. The new CC is added — multiple CCs can drive the same parameter.`
                  : "Click a target to add (or replace) a CC. A target can have multiple CCs — each chip is one. Click the × on a chip to remove just that CC."}
              </p>
              {(() => {
                const ccsByTarget = new Map<string, number[]>();
                for (const [k, v] of Object.entries(midiCcMap)) {
                  const cc = parseInt(k, 10);
                  if (!isNaN(cc)) {
                    if (!ccsByTarget.has(v)) ccsByTarget.set(v, []);
                    ccsByTarget.get(v)!.push(cc);
                  }
                }
                for (const ccs of ccsByTarget.values()) ccs.sort((a, b) => a - b);
                return (
                  <table className="midi-cc-table">
                    <thead>
                      <tr>
                        <th className="midi-cc-th-target">Target</th>
                        <th className="midi-cc-th-group">Group</th>
                        <th className="midi-cc-th-ccs">CCs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MIDI_TARGET_GROUPS.flatMap((groupName) =>
                        MIDI_TARGETS.filter((t) => t.group === groupName).map((target) => {
                          const ccs = ccsByTarget.get(target.id) ?? [];
                          const isLearning = midiLearnTarget === target.id;
                          return (
                            <tr
                              key={target.id}
                              className={
                                "midi-cc-row" +
                                (isLearning ? " midi-cc-row-learning" : "") +
                                (ccs.length ? " midi-cc-row-mapped" : "")
                              }
                            >
                              <td className="midi-cc-cell-target">
                                <button
                                  type="button"
                                  className="midi-cc-row-learn"
                                  onClick={() => onMidiLearn(isLearning ? null : target.id)}
                                  title={
                                    isLearning
                                      ? "Cancel — waiting for a CC"
                                      : ccs.length
                                        ? `Click then move a knob to ADD another CC for ${target.label}.`
                                        : `Click then move a knob to learn a CC for ${target.label}.`
                                  }
                                >
                                  {target.label}
                                </button>
                              </td>
                              <td className="midi-cc-cell-group">{target.group}</td>
                              <td className="midi-cc-cell-ccs">
                                {ccs.length === 0 && !isLearning && (
                                  <span className="midi-cc-empty">—</span>
                                )}
                                {ccs.map((cc) => (
                                  <span key={cc} className="midi-cc-chip">
                                    <span className="midi-cc-chip-num">CC{cc}</span>
                                    <button
                                      type="button"
                                      className="midi-cc-chip-x"
                                      onClick={() => onMidiSetMap(removeCc(midiCcMap, cc))}
                                      title={`Remove CC${cc}`}
                                      aria-label={`Remove CC${cc} from ${target.label}`}
                                    >×</button>
                                  </span>
                                ))}
                                {isLearning && (
                                  <span className="midi-cc-chip midi-cc-chip-armed">
                                    <span className="midi-cc-chip-num">…waiting</span>
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                );
              })()}

              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">TEMPLATES</div>
              <p className="fx-modal-desc">
                Save the current mapping as a named template, swap between
                controllers, or share by exporting JSON.
              </p>
              <div className="fx-modal-actions midi-template-row">
                <input
                  type="text"
                  className="midi-template-name"
                  placeholder="template name"
                  value={midiTemplateName}
                  maxLength={48}
                  onChange={(e) => setMidiTemplateName(e.target.value)}
                />
                <button
                  className="header-btn"
                  disabled={!midiTemplateName.trim()}
                  onClick={() => {
                    const name = midiTemplateName.trim();
                    if (!name) return;
                    setMidiTemplates(saveTemplate(name, midiCcMap));
                    setMidiTemplateName("");
                  }}
                  title="Save the current mapping under this name"
                >
                  SAVE
                </button>
                <button
                  className="header-btn"
                  onClick={() => {
                    const name = (midiTemplateName.trim() || "mdrone-midi").replace(/[^a-z0-9._-]+/gi, "-");
                    const json = exportCcMap(midiCcMap, name);
                    const blob = new Blob([json], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${name}.json`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                  }}
                  title="Download the current mapping as a JSON file"
                >
                  EXPORT
                </button>
                <button
                  className="header-btn"
                  onClick={() => midiImportRef.current?.click()}
                  title="Load a mapping from a JSON file"
                >
                  IMPORT
                </button>
                <input
                  ref={midiImportRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const map = parseImportedCcMap(text);
                      if (!map) {
                        showNotification("Import failed: no valid CC entries found.");
                        return;
                      }
                      onMidiSetMap(map);
                      showNotification(`Imported ${Object.keys(map).length} CC mappings from ${file.name}`);
                    } catch {
                      showNotification("Import failed: file could not be read.");
                    }
                  }}
                />
              </div>
              {Object.keys(midiTemplates).length === 0 ? (
                <div className="midi-device-empty">No saved templates yet.</div>
              ) : (
                <ul className="midi-template-list">
                  {Object.keys(midiTemplates).sort().map((name) => (
                    <li key={name} className="midi-template-item">
                      <span className="midi-template-item-name">{name}</span>
                      <span className="midi-template-item-meta">
                        {Object.keys(midiTemplates[name]).length} CCs
                      </span>
                      <button
                        className="header-btn"
                        onClick={() => {
                          onMidiSetMap(midiTemplates[name]);
                          showNotification(`Loaded MIDI template "${name}"`);
                        }}
                        title={`Replace the current mapping with "${name}"`}
                      >
                        LOAD
                      </button>
                      <button
                        className="header-btn header-btn-danger"
                        onClick={() => setMidiTemplates(deleteTemplate(name))}
                        title={`Delete "${name}"`}
                      >
                        DEL
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="fx-modal-divider" />
              <div className="fx-modal-actions">
                <button className="header-btn" onClick={onMidiResetMap}>
                  RESET TO DEFAULTS
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <Suspense fallback={null}>
          <HelpModal
            onClose={() => setHelpOpen(false)}
            onBeforeTutorialReveal={() => setSessionOpen(false)}
          />
        </Suspense>
      )}

      {sessionSheetOpen && (
        <div className="fx-modal-backdrop" onClick={() => setSessionSheetOpen(false)}>
          <div
            className="fx-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Session"
          >
            <div className="fx-modal-header">
              <div className="fx-modal-title">SESSION</div>
              <div className="fx-modal-actions">
                <button
                  type="button"
                  className="header-btn"
                  onClick={() => setSessionSheetOpen(false)}
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
              <label className="fx-modal-param">
                <span className="fx-modal-param-label">LOAD</span>
                <DropdownSelect
                  value={currentSessionId ?? ""}
                  options={[
                    { value: "", label: sessions.length === 0 ? "No sessions" : "Select…" },
                    ...sessions.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  onChange={(v) => {
                    if (v) {
                      onLoadSession(v);
                      setSessionSheetOpen(false);
                    }
                  }}
                  className="header-select"
                  disabled={sessions.length === 0}
                />
              </label>
              <div className="fx-modal-actions">
                <button
                  className="header-btn"
                  onClick={() => { setSessionSheetOpen(false); setDialogMode("save"); }}
                  title="Save the current session"
                >
                  SAVE
                </button>
                <button
                  className="header-btn"
                  onClick={() => { setSessionSheetOpen(false); setDialogMode("rename"); }}
                  title="Rename the current session"
                >
                  RENAME
                </button>
              </div>

              <div className="fx-modal-divider" />
              <div className="fx-modal-section-label">JSON</div>
              <p className="fx-modal-desc">
                Export the current scene to a portable JSON file, or
                load one back. Same payload as a share URL — voices,
                FX, microtuning, mixer, visuals.
              </p>
              <div className="fx-modal-actions">
                <button
                  className="header-btn"
                  onClick={() => {
                    const out = onExportSessionJson();
                    if (!out) {
                      showNotification("Could not capture the current scene.", "error");
                      return;
                    }
                    try {
                      const blob = new Blob([out.json], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = out.filename;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                      showNotification(`Exported — ${out.filename}`, "info");
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : "Unknown error";
                      showNotification(`Export failed — ${msg}`, "error");
                    }
                  }}
                  title="Download the current scene as JSON"
                >
                  EXPORT JSON
                </button>
                <button
                  className="header-btn"
                  onClick={() => sessionImportInputRef.current?.click()}
                  title="Load a scene from a JSON file"
                >
                  IMPORT JSON
                </button>
                <input
                  ref={sessionImportInputRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const ok = onImportSessionJson(text);
                      if (ok) {
                        showNotification(`Loaded — ${file.name}`, "info");
                        setSessionSheetOpen(false);
                      } else {
                        showNotification("Import failed — file is not a valid mdrone scene.", "error");
                      }
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : "Unknown error";
                      showNotification(`Import failed — ${msg}`, "error");
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
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
