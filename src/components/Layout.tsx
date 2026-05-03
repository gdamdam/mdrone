import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useMidiInput, midiNoteToPitch } from "../engine/midiInput";
import { loadCcMap, saveCcMap, assignCc, resetCcMap, ccForTarget, MIDI_TARGETS_BY_ID, enumIndexFromCc, type CcMap } from "../engine/midiMapping";
import type { AudioEngine } from "../engine/AudioEngine";
import type { PitchClass, ViewMode } from "../types";
import { APP_VERSION, STORAGE_KEYS, type WeatherVisual } from "../config";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { NotificationTray } from "./NotificationTray";
import { showNotification } from "../notifications";
import { useDevGlobals } from "../devtools/useDevGlobals";
import {
  buildAudioDiagnostics,
  copyToClipboard,
  renderAudioDiagnosticsMarkdown,
  type DiagnosticsHooks,
} from "../devtools/audioDiagnostics";
import { isTraceEnabled, snapshotTrace } from "../engine/audioTrace";
import { readAudioDebugFlags } from "../engine/audioDebug";
import { PRESETS as ALL_PRESETS } from "../engine/presets";
import { DroneView, type DroneViewHandle } from "./DroneView";
import { MixerView } from "./MixerView";
// MeditateView pulls the `meditate` chunk (visualizers + meditate
// state). Lazy + gated on first-open so the chunk doesn't fetch
// until the user actually clicks ◉ MEDITATE. Once mounted it stays
// mounted (see hasOpenedMeditate below) so visualizer phase clocks
// and smoothing buffers don't reset on every toggle.
const MeditateView = lazy(() =>
  import("./MeditateView").then((m) => ({ default: m.MeditateView })),
);
import { trackEvent } from "../analytics";
import { buildWavFilename, buildTakeWavFilename, formatDurationMs } from "../engine/recordingFilename";
import { TutorialFlow } from "./TutorialFlow";
import { TutorialOffer } from "./TutorialOffer";
import { addHoldTime } from "../tutorial/state";

const ShareModal = lazy(() =>
  import("./ShareModal").then((m) => ({ default: m.ShareModal })),
);
import { useSceneManager } from "../scene/useSceneManager";
import { applyUpdateAndReload } from "../swRegister";
import {
  installMediaSession,
  setMediaSessionMetadata,
  setMediaSessionPlaying,
} from "../mediaSession";

interface LayoutProps {
  engine: AudioEngine;
  startupMode: "continue" | "new";
}

/**
 * Top-level app shell — header, view dispatch, footer.
 *
 * Engine lifecycle: `engine` is created eagerly in App so every
 * descendant receives it on first render. The AudioContext starts
 * suspended — we call `engine.resume()` on the first pointerdown
 * inside the layout so child click handlers on the same interaction
 * (e.g. HOLD button) get a live engine immediately.
 */
export function Layout({ engine, startupMode }: LayoutProps) {
  const [viewMode, setViewModeRaw] = useState<ViewMode>("drone");
  // First-time-MEDITATE gate. The MeditateView chunk only fetches once
  // this flips to true; once mounted the component stays in the tree
  // (CSS hides it) so its rAF loop and visualizer state survive
  // toggles. Without this gate the chunk would still load, just under
  // a different React.lazy code-path.
  const [hasOpenedMeditate, setHasOpenedMeditate] = useState(false);
  const setViewMode = useCallback((mode: ViewMode) => {
    // Track non-default mode switches — gives a sense of how many
    // sessions actually reach MEDITATE / MIXER vs never leave DRONE.
    if (mode !== "drone") trackEvent(`view/${mode}`);
    if (mode === "meditate") setHasOpenedMeditate(true);
    setViewModeRaw(mode);
  }, []);
  const [isRec, setIsRec] = useState(false);
  const [recTimeMs, setRecTimeMs] = useState(0);
  const [recBusy, setRecBusy] = useState(false);
  // Seamless-loop bounce — parallel to master record, separate state.
  const [loopLengthSec, setLoopLengthSec] = useState(30);
  const [loopBusy, setLoopBusy] = useState(false);
  const [loopProgress, setLoopProgress] = useState<{ elapsedSec: number; totalSec: number } | null>(null);
  // EXPORT TAKE — fixed-duration realtime capture. Wraps the same
  // MasterRecorder path as REC LIVE; the auto-stop timer fires from
  // setTimeout, the progress UI ticks on a separate setInterval.
  const [takeBusy, setTakeBusy] = useState(false);
  const [takeProgress, setTakeProgress] = useState<{ elapsedMs: number; totalMs: number } | null>(null);
  const takeTimerRef = useRef<number | null>(null);
  const takeTickRef = useRef<number | null>(null);
  const takeAbortedRef = useRef<boolean>(false);
  const [mixerSyncToken, setMixerSyncToken] = useState(0);
  const [headerTonic, setHeaderTonic] = useState<PitchClass>("A");
  const [headerOctave, setHeaderOctave] = useState(2);
  const [headerHolding, setHeaderHolding] = useState(false);
  // iOS lifecycle diagnostic — when the tab returns to visible while
  // HOLD is on, sample the engine state before and after the resume
  // attempt and surface it as an info toast. This is a debug aid for
  // post-cert finding #1: without console access on the phone, this
  // is how we figure out which case we're in (ctx never reaches
  // running, ctx running but voices silent, etc.) so the next fix
  // targets the real failure mode. Auto-disables itself once we know
  // — toggle by adding `?ios-diag=1` to the URL.
  const iosDiagEnabled = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("ios-diag");
  useEffect(() => {
    if (!iosDiagEnabled) return;
    let mounted = true;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (!headerHolding) return;
      const pre = engine.probeAudioPresence();
      window.setTimeout(() => {
        if (!mounted) return;
        const post = engine.probeAudioPresence();
        const msg =
          `iOS-diag: ctx ${pre.ctxState}→${post.ctxState} · ` +
          `out ${post.hasOutput ? "live" : "silent"} ` +
          `(peak ${post.peakDb.toFixed(0)} dB)`;
        console.warn(`[mdrone:ios-diag] ${msg}`);
        showNotification(msg, post.hasOutput ? "info" : "warning");
      }, 600);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onVis);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onVis);
    };
  }, [iosDiagEnabled, engine, headerHolding]);

  // iOS recover-resume: if the audioStuck overlay just reloaded the
  // page, auto-trigger HOLD a moment after mount so the user lands
  // back in playing state with one tap (the StartGate "Continue"
  // they used to satisfy autoplay policy) instead of two. The flag
  // is one-shot — read + cleared on first effect run.
  // Delay strategy:
  //   - 800 ms gives useDroneScene time to apply the autosaved scene
  //     before HOLD fires; otherwise togglePlay would start with the
  //     default scene.
  //   - Inside the timeout we await ctx.resume() with a 1500 ms cap
  //     so we don't fire togglePlay against a suspended context (no
  //     audio would actually play even though the play state flips).
  //   - If resume never wins the race, togglePlay still fires and
  //     handleUnlock + audioStuck will pick up the slack.
  useEffect(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("mdrone-recover-resume"); } catch { /* ok */ }
    if (raw !== "1") return;
    try { sessionStorage.removeItem("mdrone-recover-resume"); } catch { /* ok */ }
    const t = window.setTimeout(async () => {
      await Promise.race([
        engine.resume().catch(() => undefined),
        new Promise<void>((r) => window.setTimeout(r, 1500)),
      ]);
      droneViewRef.current?.togglePlay();
    }, 800);
    return () => window.clearTimeout(t);
  }, [engine]);

  // iOS hard-recovery overlay. When the AudioContext is stuck in
  // a non-running state for >1 s while HOLD is on (typically after
  // an iOS audio session interruption that resume() can't recover
  // because the underlying audio hardware allocation was released),
  // surface a tappable banner that location.reload()s the page.
  // The autosave mechanism preserves the scene so the user lands
  // back on the same drone after the reload. Post-cert finding #1
  // — the only path that's actually guaranteed to work when iOS
  // refuses to resume the existing context.
  const [audioStuck, setAudioStuck] = useState(false);
  useEffect(() => {
    if (!headerHolding) {
      setAudioStuck(false);
      return;
    }
    const check = () => {
      if (engine.ctx.state === "running") {
        setAudioStuck(false);
      } else if (headerHolding) {
        setAudioStuck(true);
      }
    };
    // Re-check on visibility return + on a low-frequency timer so
    // the overlay appears within ~1.5 s of the user noticing audio
    // is dead, and clears within ~1.5 s of recovery.
    const onVis = () => {
      if (document.visibilityState === "visible") {
        window.setTimeout(check, 1200);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const interval = window.setInterval(check, 1500);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(interval);
    };
  }, [headerHolding, engine]);

  // Screen wake lock while playing — prevents iPhone (and any other
  // device that supports the Wake Lock API) from auto-locking during a
  // long listen. The OS releases the sentinel when the tab is
  // backgrounded, so re-acquire on visibilitychange whenever HOLD is
  // still on. Mirrors the pattern already used in MeditateView.tsx.
  // Post-cert finding #1 (partial — handles auto-lock; manual-lock
  // suspend/resume is a separate change).
  useEffect(() => {
    if (!headerHolding) return;
    type WakeLockNav = Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> };
    };
    const nav = navigator as WakeLockNav;
    if (!nav.wakeLock?.request) return;
    let sentinel: WakeLockSentinel | null = null;
    const acquire = () => {
      nav.wakeLock!
        .request("screen")
        .then((s) => { sentinel = s; })
        .catch(() => { /* denied / unsupported — ok */ });
    };
    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible" && !sentinel) acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      sentinel?.release().catch(() => { /* ok */ });
      sentinel = null;
    };
  }, [headerHolding]);

  // Engine state-convergence window. True for ~10s after HOLD turns on
  // so the HOLD button can pulse, signalling that delay lines + feedback
  // states are still settling. Post-cert finding #4 — pushing macros
  // fast inside this window produces audible artifacts; this is the
  // UX side of "engine settling," not a DSP fix.
  const [headerWarming, setHeaderWarming] = useState(false);
  const warmingTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    if (warmingTimeoutRef.current != null) {
      window.clearTimeout(warmingTimeoutRef.current);
      warmingTimeoutRef.current = null;
    }
    if (headerHolding) {
      setHeaderWarming(true);
      warmingTimeoutRef.current = window.setTimeout(() => {
        setHeaderWarming(false);
        warmingTimeoutRef.current = null;
      }, 10_000);
    } else {
      setHeaderWarming(false);
    }
    return () => {
      if (warmingTimeoutRef.current != null) {
        window.clearTimeout(warmingTimeoutRef.current);
        warmingTimeoutRef.current = null;
      }
    };
  }, [headerHolding]);
  const [headerTuneHint, setHeaderTuneHint] = useState<string | null>(null);
  const [headerVolume, setHeaderVolume] = useState<number>(() => engine.getMasterVolume());
  const [shareOpen, setShareOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  // Lifted pop-out state so Layout can keep the MEDITATE overlay
  // composited (visibility-visible) while DRONE is the active view
  // — otherwise the main canvas isn't rendered by the compositor
  // and captureStream feeding the popup goes stale.
  const [meditatePopOutActive, setMeditatePopOutActive] = useState(false);
  const [visualPreviewOn, setVisualPreviewOn] = useState<boolean>(() => {
    try { return window.localStorage?.getItem("mdrone.visualPreviewOn") === "1"; }
    catch { return false; }
  });
  const toggleVisualPreview = useCallback(() => {
    setVisualPreviewOn((v) => {
      const next = !v;
      try { window.localStorage?.setItem("mdrone.visualPreviewOn", next ? "1" : "0"); }
      catch { /* noop */ }
      return next;
    });
  }, []);
  const recStartRef = useRef(0);
  const resumedRef = useRef(false);
  const droneViewRef = useRef<DroneViewHandle | null>(null);
  const holdToggleRef = useRef<(() => void) | null>(null);
  const recMemUnsubRef = useRef<(() => void) | null>(null);

  const sceneManager = useSceneManager({
    engine,
    droneViewRef,
    onMixerSync: () => setMixerSyncToken((value) => value + 1),
    startupMode,
  });
  const handlePresetNameChange = sceneManager.handlePresetNameChange;

  // Memoize the onPresetChange wrapper so DroneView's effect that
  // watches it (useDroneScene:319) only re-fires when the preset
  // actually changes. Without this, the inline arrow was a fresh
  // reference every Layout render, re-firing the effect multiple
  // times per RND click and racing against the ignoreNextPresetNameRef
  // one-shot guard — which let preset.name overwrite a generated
  // drone name on the second fire.
  const handlePresetChange = useCallback(
    (presetId: string | null, presetName: string | null) => {
      handlePresetNameChange(presetId, presetName);
    },
    [handlePresetNameChange],
  );

  // REC timer tick — sync to external timer (Date.now). When isRec flips
  // off, the timer interval is cleared and we reset in the next frame via
  // a cleanup setter to avoid setState-in-effect lint warning.
  // Staged long-recording warnings (10/20/30 min) — Float32 stereo
  // chunks live in memory; the recommended max is ~30 min before
  // browser memory pressure becomes user-visible.
  useEffect(() => {
    if (!isRec) return;
    recStartRef.current = Date.now();
    const warnedAt = new Set<number>();
    const id = window.setInterval(() => {
      const ms = Date.now() - recStartRef.current;
      setRecTimeMs(ms);
      const minutes = ms / 60_000;
      const fire = (mark: number, message: string, kind: "info" | "warning") => {
        if (minutes >= mark && !warnedAt.has(mark)) {
          warnedAt.add(mark);
          showNotification(message, kind);
        }
      };
      fire(10, "Recording past 10 min — long takes consume browser memory. Consider segmenting.", "info");
      fire(20, "Recording past 20 min — approaching the recommended max. Prepare to stop.", "warning");
      fire(30, "Recording past 30 min — at the recommended max take length. Stop and start a new take to keep memory bounded.", "warning");
    }, 200);
    return () => {
      window.clearInterval(id);
      setRecTimeMs(0);
    };
  }, [isRec]);

  // beforeunload guard — warn the user only while a master recording
  // or loop bounce is in flight, so an accidental close/reload doesn't
  // discard the take. Idle pages stay quiet (no warning).
  useEffect(() => {
    if (!isRec && !loopBusy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the custom string and show a generic
      // confirm; preventDefault + a non-empty returnValue is the
      // portable way to trigger the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isRec, loopBusy]);

  // Check for a newer build every 5 minutes. vite.config.ts writes
  // public/version.json on build; if the fetched version doesn't match
  // APP_VERSION compiled into this bundle, a banner invites the user
  // to reload. cache: "no-store" so we see fresh deploys immediately.
  useEffect(() => {
    const check = () => {
      fetch("version.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { v?: string }) => {
          if (data.v && data.v !== APP_VERSION) setUpdateAvailable(true);
        })
        .catch(() => { /* offline or 404 — ignore */ });
    };
    check();
    const id = window.setInterval(check, 5 * 60 * 1000);
    const onSwUpdate = () => setUpdateAvailable(true);
    window.addEventListener("mdrone:update-available", onSwUpdate);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("mdrone:update-available", onSwUpdate);
    };
  }, []);

  // MediaSession — OS lock-screen / notification play-pause maps to
  // HOLD. Installed once; metadata + playbackState kept in sync with
  // transport + tonic state below.
  useEffect(() => {
    installMediaSession({
      onPlay: () => { if (!engine.isPlaying()) holdToggleRef.current?.(); },
      onPause: () => { if (engine.isPlaying()) holdToggleRef.current?.(); },
    });
  }, [engine]);

  useEffect(() => {
    setMediaSessionMetadata({
      title: "mdrone",
      artist: `${headerTonic} · ${headerOctave}`,
    });
  }, [headerTonic, headerOctave]);

  useEffect(() => {
    setMediaSessionPlaying(headerHolding);
  }, [headerHolding]);

  // ── HOLD-time accumulator ────────────────────────────────────
  // Tracks accumulated HOLD-on time in localStorage; future
  // tutorials / pills can gate on it. The share-tour that used
  // to live here was removed alongside the talisman-card cleanup.
  useEffect(() => {
    if (!headerHolding) return;
    const TICK_MS = 1000;
    const id = window.setInterval(() => {
      addHoldTime(TICK_MS);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [headerHolding]);

  // Audio diagnostics — single-call aggregator for crackle / frrrr
  // reports. Builds a structured payload, renders Markdown, attempts
  // clipboard copy, returns the JSON object. Stable callback so the
  // UI ("Copy Audio Report" button in the CpuWarning detail) and the
  // window devtool (__mdroneAudioReport) share one implementation.
  const copyAudioReport = useCallback(async () => {
    const snap = droneViewRef.current?.getSnapshot();
    const presetId = snap?.activePresetId ?? null;
    const presetName = presetId
      ? (ALL_PRESETS.find((p) => p.id === presetId)?.name ?? null)
      : null;
    const hooks: DiagnosticsHooks = {
      appVersion: APP_VERSION,
      engine,
      getPreset: () => ({ id: presetId, name: presetName }),
      getTrace: () => ({
        enabled: isTraceEnabled(),
        events: snapshotTrace(),
      }),
      getAudioDebugFlags: () => Array.from(readAudioDebugFlags()),
    };
    const report = buildAudioDiagnostics(hooks);
    const md = renderAudioDiagnosticsMarkdown(report);
    console.log(md);
    const ok = await copyToClipboard(md);
    showNotification(
      ok ? "Audio report copied to clipboard." : "Audio report logged to console (clipboard unavailable).",
      "info",
    );
    return report;
  }, [engine]);

  // Dev tools (engine + preset audit + certification) live in
  // useDevGlobals — registered on window only when the debug flag is
  // on. The always-on `__mdroneAudioReport` helper for the in-UI
  // audio diagnostics button is wired in the same hook.
  useDevGlobals({ engine, droneViewRef, holdToggleRef, copyAudioReport });

  // MIDI input — external keyboard drives tonic + octave.
  const handleMidiNote = useCallback((note: number) => {
    const { pitchClass, octave } = midiNoteToPitch(note);
    const clamped = Math.max(1, Math.min(6, octave));
    droneViewRef.current?.setRootFromUser(pitchClass);
    droneViewRef.current?.setOctave(clamped);
  }, []);

  // MIDI CC mapping — target registry + learn-mode overrides. The
  // registry lives in midiMapping.ts; the dispatch below knows how
  // to route each target id to the engine / drone view / scene
  // manager.
  const [ccMap, setCcMap] = useState<CcMap>(loadCcMap);
  const [midiLearnTarget, setMidiLearnTarget] = useState<string | null>(null);
  // Global "MIDI" toggle (Ableton-style): when on, click any control
  // with [data-midi-id] to arm it, wiggle a CC to assign. Coexists
  // with the per-target Settings flow — both write through midiLearnTarget.
  const [midiLearnMode, setMidiLearnMode] = useState(false);
  const ccMapRef = useRef(ccMap);
  const midiLearnRef = useRef(midiLearnTarget);
  useEffect(() => { ccMapRef.current = ccMap; }, [ccMap]);
  useEffect(() => { midiLearnRef.current = midiLearnTarget; }, [midiLearnTarget]);

  // Body class so CSS can highlight every [data-midi-id] while learn
  // mode is on. Cleaned up on toggle off / unmount.
  useEffect(() => {
    if (!midiLearnMode) return;
    document.body.classList.add("midi-learn-on");
    return () => { document.body.classList.remove("midi-learn-on"); };
  }, [midiLearnMode]);

  // Capture-phase click handler: in learn mode, intercept clicks on
  // any [data-midi-id], arm that target, swallow the click so the
  // underlying control doesn't change value. The next CC message will
  // be assigned by the existing handleMidiCc learn branch.
  useEffect(() => {
    if (!midiLearnMode) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-midi-id]") as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute("data-midi-id");
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      setMidiLearnTarget(id);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onClick, true);
    };
  }, [midiLearnMode]);

  // While learn mode is on, every [data-midi-id] node carries
  // data-midi-cc="<n>" if a CC is mapped to its id. Pure CSS draws
  // the small badge. A MutationObserver catches modals/lists that
  // mount controls after learn mode is enabled.
  useEffect(() => {
    if (!midiLearnMode) {
      document.querySelectorAll<HTMLElement>("[data-midi-cc]")
        .forEach((el) => el.removeAttribute("data-midi-cc"));
      return;
    }
    const apply = (el: HTMLElement) => {
      const id = el.getAttribute("data-midi-id");
      if (!id) return;
      const cc = ccForTarget(ccMap, id);
      if (cc != null) el.setAttribute("data-midi-cc", String(cc));
      else el.removeAttribute("data-midi-cc");
    };
    const sweep = () => {
      document.querySelectorAll<HTMLElement>("[data-midi-id]").forEach(apply);
    };
    sweep();
    const obs = new MutationObserver((muts) => {
      let dirty = false;
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n.matches?.("[data-midi-id]") || n.querySelector?.("[data-midi-id]")) dirty = true;
        });
        if (m.type === "attributes" && m.target instanceof HTMLElement
            && m.attributeName === "data-midi-id") dirty = true;
      }
      if (dirty) sweep();
    });
    obs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ["data-midi-id"],
    });
    return () => {
      obs.disconnect();
      document.querySelectorAll<HTMLElement>("[data-midi-cc]")
        .forEach((el) => el.removeAttribute("data-midi-cc"));
    };
  }, [midiLearnMode, ccMap]);

  // Mirror the armed target onto its DOM nodes so CSS can pulse them.
  // Cheap query — only runs on mode/target changes, not per render.
  useEffect(() => {
    if (!midiLearnMode || !midiLearnTarget) {
      document.querySelectorAll<HTMLElement>("[data-midi-armed]")
        .forEach((el) => el.removeAttribute("data-midi-armed"));
      return;
    }
    const sel = `[data-midi-id="${CSS.escape(midiLearnTarget)}"]`;
    document.querySelectorAll<HTMLElement>(sel)
      .forEach((el) => el.setAttribute("data-midi-armed", "true"));
    return () => {
      document.querySelectorAll<HTMLElement>(sel)
        .forEach((el) => el.removeAttribute("data-midi-armed"));
    };
  }, [midiLearnMode, midiLearnTarget]);

  // Esc exits learn mode first (before any modal Esc handlers).
  useEffect(() => {
    if (!midiLearnMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // stopImmediatePropagation prevents the modals' bubble-phase
        // Esc handlers from firing too — Esc exits learn mode FIRST,
        // and only a second Esc closes whatever modal is open.
        e.stopImmediatePropagation();
        e.preventDefault();
        setMidiLearnMode(false);
        setMidiLearnTarget(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [midiLearnMode]);

  // Refs so the dispatch doesn't close over stale handler identities.
  // sceneManager is re-created on every render; handlePanic is an
  // inline closure; without refs every MIDI message would rebuild
  // the CC handler.
  const panicRef = useRef<() => void>(() => {});
  const randomSceneRef = useRef<() => void>(() => {});
  const mutateSceneRef = useRef<(intensity: number) => void>(() => {});
  const cyclePresetAllRef = useRef<(dir: 1 | -1) => void>(() => {});
  const cyclePresetGroupRef = useRef<(dir: 1 | -1) => void>(() => {});

  // Track which trigger CCs are currently "on" so we fire once per
  // rising edge (value crosses from <64 to >=64) instead of repeating
  // while the controller sustains a held button.
  const triggerOnRef = useRef<Set<number>>(new Set());

  const handleMidiCc = useCallback((cc: number, value: number) => {
    // Learn mode: assign this CC to the pending target id.
    if (midiLearnRef.current) {
      const next = assignCc(ccMapRef.current, cc, midiLearnRef.current);
      setCcMap(next);
      saveCcMap(next);
      setMidiLearnTarget(null);
      return;
    }

    const targetId = ccMapRef.current[cc];
    if (!targetId) return;
    const target = MIDI_TARGETS_BY_ID.get(targetId);
    if (!target) return;

    // ── Triggers — fire on rising edge, except HOLD which behaves
    //    like a sustain pedal (tracks state, not edges). ──────────
    if (target.kind === "trigger") {
      const isOn = value >= 64;
      const wasOn = triggerOnRef.current.has(cc);
      if (isOn) triggerOnRef.current.add(cc);
      else triggerOnRef.current.delete(cc);

      if (targetId === "hold") {
        // Sustain-pedal semantics: on ⇒ ensure playing, off ⇒ ensure stopped.
        if (isOn && !engine?.isPlaying()) holdToggleRef.current?.();
        else if (!isOn && engine?.isPlaying()) holdToggleRef.current?.();
        return;
      }
      if (!isOn || wasOn) return; // one-shot on rising edge only
      switch (targetId) {
        case "panic":  panicRef.current(); break;
        case "rnd":    randomSceneRef.current(); break;
        case "mutate": mutateSceneRef.current(0.25); break;
        case "preset.prev":       cyclePresetAllRef.current(-1); break;
        case "preset.next":       cyclePresetAllRef.current(1);  break;
        case "preset.group.prev": cyclePresetGroupRef.current(-1); break;
        case "preset.group.next": cyclePresetGroupRef.current(1);  break;
      }
      return;
    }

    // ── Enum — band-split CC value into N option indices and dispatch. ──
    if (target.kind === "enum") {
      const opts = target.options ?? [];
      if (!opts.length) return;
      const idx = enumIndexFromCc(value, opts.length);
      switch (targetId) {
        case "fx.formant.vowel": engine?.getFxChain?.().setFormantVowel(idx); break;
      }
      return;
    }

    // ── Continuous dispatch — `norm` is 0..1. Most targets are
    //    nominally 0..1; those that aren't remap inside the case. ─
    const norm = value / 127;
    const dv = droneViewRef.current;
    const eng = engine;
    switch (targetId) {
      // Macros (voice + motion)
      case "drift":  dv?.applyLivePatch?.({ drift:  norm }, { record: true }); break;
      case "air":    dv?.applyLivePatch?.({ air:    norm }, { record: true }); break;
      case "time":   dv?.applyLivePatch?.({ time:   norm }, { record: true }); break;
      case "sub":    dv?.applyLivePatch?.({ sub:    norm }, { record: true }); break;
      case "bloom":  dv?.applyLivePatch?.({ bloom:  norm }, { record: true }); break;
      case "glide":  dv?.applyLivePatch?.({ glide:  norm }, { record: true }); break;
      case "morph":  dv?.applyLivePatch?.({ presetMorph: norm }, { record: true }); break;
      case "evolve": dv?.applyLivePatch?.({ evolve: norm }, { record: true }); break;
      case "pluck":  dv?.applyLivePatch?.({ pluckRate: norm * 2 }, { record: true }); break;

      // Weather + LFO
      case "weatherX":  dv?.applyLivePatch?.({ climateX: norm }, { record: true }); break;
      case "weatherY":  dv?.applyLivePatch?.({ climateY: norm }, { record: true }); break;
      // LFO rate log-scaled 0.05..8 Hz to match the SHAPE panel's RATE macro.
      case "lfoRate":   dv?.applyLivePatch?.({ lfoRate: 0.05 * Math.pow(160, norm) }, { record: true }); break;
      case "lfoAmount": dv?.applyLivePatch?.({ lfoAmount: norm }, { record: true }); break;

      // Mixer
      case "volume":  eng?.setMasterVolume?.(norm * 1.5); break;
      case "hpf":     eng?.setHpfFreq?.(norm * 60); break;            // 0..60 Hz
      case "eqLow":   { const g = eng?.getEqLow();  if (g) g.gain.value = (norm - 0.5) * 24; } break; // ±12 dB
      case "eqMid":   { const g = eng?.getEqMid();  if (g) g.gain.value = (norm - 0.5) * 24; } break;
      case "eqHigh":  { const g = eng?.getEqHigh(); if (g) g.gain.value = (norm - 0.5) * 24; } break;
      case "glue":    eng?.setGlueAmount?.(norm); break;
      case "drive":   eng?.setDrive?.(1 + norm * 3); break;           // 1..4×
      case "ceiling": eng?.setLimiterCeiling?.(-6 + norm * 6); break; // -6..0 dBFS

      // Voice levels (0..1) — must go through DroneView so React
      // scene state stays in sync; calling engine.setVoiceLevel
      // directly was overwritten by the next scene resync, so the
      // CC produced no audible (or visible) change.
      case "voice.tanpura": dv?.setVoiceLevel?.("tanpura", norm); break;
      case "voice.reed":    dv?.setVoiceLevel?.("reed",    norm); break;
      case "voice.metal":   dv?.setVoiceLevel?.("metal",   norm); break;
      case "voice.air":     dv?.setVoiceLevel?.("air",     norm); break;
      case "voice.piano":   dv?.setVoiceLevel?.("piano",   norm); break;
      case "voice.fm":      dv?.setVoiceLevel?.("fm",      norm); break;
      case "voice.amp":     dv?.setVoiceLevel?.("amp",     norm); break;

      // Effect levels (0..1). The SHAPE effect toggles are still the
      // authority on whether an effect is in-chain; this CC just
      // scales the wet-return gain of whichever effects are active.
      case "fx.tape":       eng?.getFxChain?.().setEffectLevel("tape",       norm); break;
      case "fx.wow":        eng?.getFxChain?.().setEffectLevel("wow",        norm); break;
      case "fx.sub":        eng?.getFxChain?.().setEffectLevel("sub",        norm); break;
      case "fx.comb":       eng?.getFxChain?.().setEffectLevel("comb",       norm); break;
      case "fx.delay":      eng?.getFxChain?.().setEffectLevel("delay",      norm); break;
      case "fx.plate":      eng?.getFxChain?.().setEffectLevel("plate",      norm); break;
      case "fx.hall":       eng?.getFxChain?.().setEffectLevel("hall",       norm); break;
      case "fx.shimmer":    eng?.getFxChain?.().setEffectLevel("shimmer",    norm); break;
      case "fx.freeze":     eng?.getFxChain?.().setEffectLevel("freeze",     norm); break;
      case "fx.cistern":    eng?.getFxChain?.().setEffectLevel("cistern",    norm); break;
      case "fx.granular":   eng?.getFxChain?.().setEffectLevel("granular",   norm); break;
      case "fx.graincloud": eng?.getFxChain?.().setEffectLevel("graincloud", norm); break;
      case "fx.ringmod":    eng?.getFxChain?.().setEffectLevel("ringmod",    norm); break;
      case "fx.formant":    eng?.getFxChain?.().setEffectLevel("formant",    norm); break;
      case "fx.halo":       eng?.getFxChain?.().setEffectLevel("halo",       norm); break;
    }
  }, [engine]);

  // Ref sync for handlers referenced by handleMidiCc's trigger branch.
  // Done after the handlers are declared (see below) to avoid TDZ.
  randomSceneRef.current = sceneManager.handleRandomScene;
  mutateSceneRef.current = sceneManager.handleMutateScene;
  cyclePresetAllRef.current = sceneManager.handleCyclePresetAll;
  cyclePresetGroupRef.current = sceneManager.handleCyclePresetInGroup;

  // Exposed for the Settings modal's MIDI section
  const handleResetCcMap = useCallback(() => { setCcMap(resetCcMap()); }, []);

  const midi = useMidiInput(handleMidiNote, handleMidiCc);

  // QWERTY keyboard → tonic. Same layout as mpump: A=C, W=C#, S=D,
  // E=D#, D=E, F=F, T=F#, G=G, Y=G#, H=A, U=A#, J=B.
  // Z/X shift octave down/up.
  const [kbdActive, setKbdActive] = useState(false);
  // Motion-recording feature flag — hidden by default, opt-in via
  // the Settings modal. Persisted in localStorage.
  const [motionRecEnabled, setMotionRecEnabledState] = useState<boolean>(
    () => {
      try { return localStorage.getItem(STORAGE_KEYS.motionRecEnabled) === "1"; }
      catch { return false; }
    },
  );
  const [weatherVisual, setWeatherVisualState] = useState<WeatherVisual>(() => {
    try { return (localStorage.getItem(STORAGE_KEYS.weatherVisual) as WeatherVisual) || "waveform"; }
    catch { return "flow"; }
  });
  const setWeatherVisual = useCallback((v: WeatherVisual) => {
    setWeatherVisualState(v);
    try { localStorage.setItem(STORAGE_KEYS.weatherVisual, v); } catch { /* noop */ }
  }, []);

  const setMotionRecEnabled = useCallback((on: boolean) => {
    setMotionRecEnabledState(on);
    try { localStorage.setItem(STORAGE_KEYS.motionRecEnabled, on ? "1" : "0"); }
    catch { /* noop */ }
    // If the user disables it while a recording is in progress, stop it.
    if (!on && sceneManager.isRecordingMotion) sceneManager.handleToggleMotionRecord();
  }, [sceneManager]);

  // Low-power mode — opt-in toggle in Settings. When on: MEDITATE
  // clamps to 15 fps, the LUFS meter publishes at ~5 Hz instead of
  // ~30 Hz, and the master-bus duck on preset change is skipped.
  const [lowPowerMode, setLowPowerModeState] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.lowPowerMode) === "1"; }
    catch { return false; }
  });
  // Push the persisted value into the engine once it's available.
  useEffect(() => {
    engine?.setLowPowerMode?.(lowPowerMode);
  }, [engine, lowPowerMode]);
  const setLowPowerMode = useCallback((on: boolean) => {
    setLowPowerModeState(on);
    try { localStorage.setItem(STORAGE_KEYS.lowPowerMode, on ? "1" : "0"); }
    catch { /* noop */ }
  }, []);

  // LIVE SAFE — explicit user-facing stability mode. Persisted; pushed
  // to the engine on hydrate and on every toggle. The engine controller
  // is idempotent so re-pushing the same value is a no-op.
  const [liveSafeMode, setLiveSafeModeState] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.liveSafeMode) === "1"; }
    catch { return false; }
  });
  useEffect(() => {
    engine?.setLiveSafeMode?.(liveSafeMode);
  }, [engine, liveSafeMode]);
  const setLiveSafeMode = useCallback((on: boolean) => {
    setLiveSafeModeState(on);
    try { localStorage.setItem(STORAGE_KEYS.liveSafeMode, on ? "1" : "0"); }
    catch { /* noop */ }
  }, []);
  // Surface the engine's suppressed-FX count to the header pill so the
  // tooltip can read at a glance how much LIVE SAFE is doing.
  const [liveSafeSuppressedFxCount, setLiveSafeSuppressedFxCount] = useState(0);
  useEffect(() => {
    if (!engine) return;
    const unsub = engine.subscribeLiveSafe?.((s) => {
      setLiveSafeSuppressedFxCount(s.suppressedFx.length);
    });
    return () => { unsub?.(); };
  }, [engine]);
  // Global keyboard shortcuts (always active)
  useEffect(() => {
    const globalHandler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "<") { e.preventDefault(); sceneManager.handleCyclePresetAll(-1); return; }
      if (e.key === ">") { e.preventDefault(); sceneManager.handleCyclePresetAll(1); return; }
    };
    window.addEventListener("keydown", globalHandler);
    return () => window.removeEventListener("keydown", globalHandler);
  }, [sceneManager]);

  // Escape dismisses MEDITATE overlay or MIXER drawer back to DRONE.
  // Skipped when viewMode is already "drone" so Esc remains available
  // for modals (ShareModal, FxModal, etc.) that manage their own close.
  useEffect(() => {
    if (viewMode === "drone") return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") setViewMode("drone");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, setViewMode]);

  // QWERTY tonic keyboard (only when ⌨ enabled)
  useEffect(() => {
    if (!kbdActive) return;
    const QWERTY: Record<string, PitchClass> = {
      KeyA: "C", KeyW: "C#", KeyS: "D", KeyE: "D#", KeyD: "E",
      KeyF: "F", KeyT: "F#", KeyG: "G", KeyY: "G#", KeyH: "A",
      KeyU: "A#", KeyJ: "B",
    };
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey) return;
      const pc = QWERTY[e.code];
      if (pc) {
        e.preventDefault();
        droneViewRef.current?.setRootFromUser(pc);
        return;
      }
      if (e.code === "KeyZ") {
        e.preventDefault();
        droneViewRef.current?.setOctave(Math.max(1, headerOctave - 1));
      } else if (e.code === "KeyX") {
        e.preventDefault();
        droneViewRef.current?.setOctave(Math.min(6, headerOctave + 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [kbdActive, headerOctave]);

  const handleToggleHold = () => {
    droneViewRef.current?.togglePlay();
  };
  holdToggleRef.current = handleToggleHold;

  /** Panic — stop the drone and kill any lingering effect tails
   *  (convolver IRs, delay buffers, granular ring buffer). Standard
   *  MIDI-style emergency silence: ramp out, flush, ramp back in. */
  const handlePanic = () => {
    engine.panic();
    // Brief delay so the ramp-out completes before reload kills the context
    setTimeout(() => window.location.reload(), 300);
  };
  panicRef.current = handlePanic;

  const recordingSupport = engine.getRecordingSupport();
  // Float32 stereo at 48 kHz ≈ 22 MB / 5 min in-memory. Surfaced in the
  // tooltip so a performer can read live cost without opening devtools.
  const recApproxMb = ((recTimeMs / 1000) * 48000 * 2 * 4) / (1024 * 1024);
  const recordingTitle = !recordingSupport.supported
    ? (recordingSupport.reason ?? "WAV recording is unavailable in this browser.")
    : isRec
      ? `Stop and download the WAV — ${formatDurationMs(recTimeMs)} captured (~${recApproxMb.toFixed(0)} MB in memory). Recommended max take: 30 min.`
      : "Record the full master output as a 24-bit WAV file. Starts the drone if it isn't already playing. Recommended max take: 30 min — long sessions are best done as separate takes.";

  const handleToggleRec = async () => {
    if (recBusy) return;
    setRecBusy(true);
    try {
      if (!isRec) {
        await engine.resume();
        // Auto-HOLD on REC start so REC WAV never produces a silent
        // file by default. Mirrors loop-bounce behavior.
        if (!engine.isPlaying()) holdToggleRef.current?.();
        // One-shot long-recording memory nudge (~15 min) — Float32
        // chunks live in memory; warn once per take.
        const unsubscribe = engine.setMasterRecordingMemoryWarning(
          15 * 60 * 1000,
          () => showNotification(
            "Long recording — browser memory may grow. Consider stopping and starting a new take.",
            "warning",
          ),
        );
        await engine.startMasterRecording();
        trackEvent("recording/wav");
        setIsRec(true);
        // Park the unsubscribe so we clean up on stop.
        recMemUnsubRef.current = unsubscribe;
      } else {
        const result = await engine.stopMasterRecording();
        recMemUnsubRef.current?.();
        recMemUnsubRef.current = null;
        setIsRec(false);
        if (result) {
          const filename = buildWavFilename(sceneManager.shareInitialName);
          const blob = new Blob([result.wav], { type: "audio/wav" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          showNotification(
            `WAV saved — ${formatDurationMs(result.durationMs)}`,
            "info",
          );
        }
      }
    } catch (error) {
      console.error("mdrone: recording failed", error);
      const message = error instanceof Error ? error.message : "Unknown recording error.";
      showNotification(`Recording failed — ${message}`, "error");
      recMemUnsubRef.current?.();
      recMemUnsubRef.current = null;
      setIsRec(false);
    } finally {
      setRecBusy(false);
    }
  };

  const handleBounceLoop = async () => {
    if (loopBusy) return;
    setLoopBusy(true);
    setLoopProgress({ elapsedSec: 0, totalSec: loopLengthSec + 1.5 });
    try {
      await engine.resume();
      // Make sure the drone is actually playing — a silent bounce is
      // a near-silent WAV which is never what the user wants.
      if (!engine.isPlaying()) holdToggleRef.current?.();
      const result = await engine.bounceLoop({
        lengthSec: loopLengthSec,
        onProgress: (p) => {
          if (p.phase === "capturing" || p.phase === "encoding") {
            setLoopProgress({ elapsedSec: p.elapsedSec, totalSec: p.totalSec });
          }
        },
      });
      trackEvent("recording/loop");
      const blob = new Blob([result.wav], { type: "audio/wav" });
      const baseName = buildWavFilename(sceneManager.shareInitialName).replace(/\.wav$/, "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${baseName}-loop-${loopLengthSec}s.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      showNotification(`Loop saved (${loopLengthSec}s)`, "info");
    } catch (error) {
      if (error instanceof Error && error.name === "BounceCancelledError") {
        showNotification("Loop bounce cancelled", "info");
      } else {
        console.error("mdrone: loop bounce failed", error);
        const message = error instanceof Error ? error.message : "Unknown error.";
        showNotification(`Loop bounce failed — ${message}`, "error");
      }
    } finally {
      setLoopBusy(false);
      setLoopProgress(null);
    }
  };

  const handleCancelBounceLoop = () => {
    engine.cancelBounceLoop();
  };

  /**
   * EXPORT TAKE — fixed-duration realtime capture. Identical recorder
   * path as REC LIVE, but a setTimeout owns the stop trigger so the
   * file is exactly the chosen length. Realtime, not offline render.
   *
   * Cancellation: the "Stop" button sets `takeAbortedRef` and stops
   * the recorder without downloading. The recorder still resolves so
   * the audio thread doesn't leak.
   */
  const clearTakeTimers = () => {
    if (takeTimerRef.current !== null) {
      window.clearTimeout(takeTimerRef.current);
      takeTimerRef.current = null;
    }
    if (takeTickRef.current !== null) {
      window.clearInterval(takeTickRef.current);
      takeTickRef.current = null;
    }
  };

  const handleExportTake = useCallback((durationMs: number) => {
    if (takeBusy || isRec || recBusy || loopBusy) return;
    if (!recordingSupport.supported) {
      showNotification(
        recordingSupport.reason ?? "WAV recording is unavailable in this browser.",
        "error",
      );
      return;
    }
    const total = Math.max(1000, Math.floor(durationMs));
    const durationLabel = total >= 60_000
      ? `${Math.round(total / 60_000)}m`
      : `${Math.round(total / 1000)}s`;
    takeAbortedRef.current = false;
    setTakeBusy(true);
    setTakeProgress({ elapsedMs: 0, totalMs: total });

    let started = false;
    (async () => {
      try {
        await engine.resume();
        if (!engine.isPlaying()) holdToggleRef.current?.();
        await engine.startMasterRecording();
        started = true;
        trackEvent(`recording/take-${durationLabel}`);
        const t0 = performance.now();
        takeTickRef.current = window.setInterval(() => {
          const elapsed = Math.min(total, Math.floor(performance.now() - t0));
          setTakeProgress({ elapsedMs: elapsed, totalMs: total });
        }, 250);
        takeTimerRef.current = window.setTimeout(async () => {
          clearTakeTimers();
          try {
            const result = await engine.stopMasterRecording();
            if (takeAbortedRef.current) {
              showNotification("Take cancelled — no WAV saved.", "info");
              return;
            }
            if (!result) {
              showNotification("Take produced no audio.", "warning");
              return;
            }
            const sceneName = sceneManager.shareInitialName ?? "Drone Landscape";
            const filename = buildTakeWavFilename(sceneName, durationLabel);
            const blob = new Blob([result.wav], { type: "audio/wav" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            const sr = engine.ctx?.sampleRate ?? 0;
            showNotification(
              `WAV saved — ${formatDurationMs(result.durationMs)} · ${sr ? `${Math.round(sr)} Hz / 24-bit` : "24-bit"}`,
              "info",
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown recording error.";
            showNotification(`Take failed — ${msg}`, "error");
          } finally {
            setTakeBusy(false);
            setTakeProgress(null);
          }
        }, total);
      } catch (err) {
        clearTakeTimers();
        if (started) {
          try { await engine.stopMasterRecording(); } catch { /* swallow */ }
        }
        const msg = err instanceof Error ? err.message : "Unknown recording error.";
        showNotification(`Take failed — ${msg}`, "error");
        setTakeBusy(false);
        setTakeProgress(null);
      }
    })();
  }, [engine, isRec, loopBusy, recBusy, recordingSupport.supported, recordingSupport.reason, sceneManager.shareInitialName, takeBusy]);

  const handleCancelExportTake = useCallback(() => {
    if (!takeBusy) return;
    takeAbortedRef.current = true;
    clearTakeTimers();
    // Force the timeout's stop path to run now so the recorder is
    // released cleanly. Mirrors the regular auto-stop, but keys off
    // takeAbortedRef so no file is downloaded.
    (async () => {
      try { await engine.stopMasterRecording(); } catch { /* swallow */ }
      showNotification("Take cancelled — no WAV saved.", "info");
      setTakeBusy(false);
      setTakeProgress(null);
    })();
  }, [engine, takeBusy]);

  // Cancel any in-progress take if the layout unmounts.
  useEffect(() => () => clearTakeTimers(), []);

  /**
   * First pointerdown anywhere in the layout resumes the AudioContext.
   * Because the engine is always non-null now, descendant click
   * handlers on the SAME interaction (e.g. HOLD button click after
   * pointerdown) fire against a live engine — no "first click unlocks,
   * second click acts" bug.
   */
  const handleUnlock = () => {
    // First-touch unlock: ensures the AudioContext starts running on
    // initial page load (browsers require a user gesture before
    // audio plays). Idempotent — fires once.
    if (!resumedRef.current) {
      resumedRef.current = true;
      void engine.resume();
    }
    // iOS suspend/resume recovery: if HOLD is on but the context
    // isn't running (suspended/interrupted after lock screen or
    // backgrounding), this pointerdown is the user gesture iOS
    // requires to resume the audio session. Resume the context, then
    // force-rebuild the voice graph since AudioWorklet voices can
    // end up in a zombie state where the context is "running" but
    // no samples reach the speakers. Post-cert finding #1 — see
    // probeAudioPresence diagnostics in 1.20.23.
    if (headerHolding && engine.ctx.state !== "running") {
      void engine.resume().then(() => {
        droneViewRef.current?.restartDrone();
      });
    }
  };

  return (
    <div className="layout" onPointerDown={handleUnlock}>
      {audioStuck && (
        <button
          type="button"
          onClick={() => {
            // Carry the "we were playing" intent across the reload so
            // App.tsx + Layout can auto-start HOLD once the user clicks
            // "Continue" on StartGate (the unavoidable post-reload
            // gesture browsers require for autoplay). Cuts recovery
            // from 3 taps (overlay → continue → HOLD) to 2.
            try { sessionStorage.setItem("mdrone-recover-resume", "1"); } catch { /* ok */ }
            window.location.reload();
          }}
          aria-label="Audio interrupted — tap to restart"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: "32px 24px",
            background: "rgba(8, 5, 3, 0.92)",
            color: "var(--preview, #f5b97a)",
            border: "none",
            font: "inherit",
            fontSize: 20,
            lineHeight: 1.4,
            textAlign: "center",
            cursor: "pointer",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <span style={{ fontSize: 48, lineHeight: 1, opacity: 0.85 }}>↻</span>
          <span>Audio was interrupted.</span>
          <span style={{ opacity: 0.7, fontSize: 16 }}>
            Tap anywhere to restart — your scene will reload.
          </span>
        </button>
      )}
      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        sessions={sceneManager.savedSessions}
        currentSessionId={sceneManager.currentSessionId}
        currentSessionName={sceneManager.currentSessionName}
        onLoadSession={sceneManager.handleLoadSession}
        onSaveSession={sceneManager.handleSaveSession}
        onRenameSession={sceneManager.handleRenameSession}
        onExportSessionJson={sceneManager.handleExportSessionJson}
        onImportSessionJson={sceneManager.handleImportSessionJson}
        getDefaultSessionName={sceneManager.getDefaultSessionName}
        displayText={sceneManager.displayText}
        isArrivalPreset={sceneManager.isArrivalPreset}
        rndArrivalRemaining={sceneManager.rndArrivalRemaining}
        tonic={headerTonic}
        octave={headerOctave}
        onChangeTonic={(pc) => droneViewRef.current?.setRootFromUser(pc)}
        onChangeOctave={(o) => droneViewRef.current?.setOctave(Math.max(1, Math.min(6, o)))}
        onToggleHold={handleToggleHold}
        holding={headerHolding}
        warming={headerWarming}
        onOpenShare={() => setShareOpen(true)}
        onRandomScene={sceneManager.handleRandomScene}
        onOpenPresets={() => droneViewRef.current?.openPresets()}
        tuneOffsetHint={headerTuneHint}
        volume={headerVolume}
        onChangeVolume={(v) => {
          setHeaderVolume(v);
          engine.setMasterVolume(v);
        }}
        midiSupported={midi.supported}
        midiEnabled={midi.enabled}
        midiDevices={midi.devices}
        midiLastNote={midi.lastNote}
        midiError={midi.error}
        onToggleMidi={(on) => midi.setEnabled(on)}
        midiCcMap={ccMap}
        midiLearnTarget={midiLearnTarget}
        onMidiLearn={setMidiLearnTarget}
        onMidiSetMap={(m) => { setCcMap(m); saveCcMap(m); }}
        midiLearnMode={midiLearnMode}
        onToggleMidiLearnMode={() => {
          setMidiLearnMode((on) => {
            const next = !on;
            if (!next) setMidiLearnTarget(null);
            return next;
          });
        }}
        onMidiResetMap={handleResetCcMap}
        weatherVisual={weatherVisual}
        onChangeWeatherVisual={setWeatherVisual}
        motionRecEnabled={motionRecEnabled}
        onToggleMotionRec={setMotionRecEnabled}
        lowPowerMode={lowPowerMode}
        onToggleLowPower={setLowPowerMode}
        liveSafeMode={liveSafeMode}
        onToggleLiveSafeMode={setLiveSafeMode}
        liveSafeSuppressedFxCount={liveSafeSuppressedFxCount}
        meditatePreviewOn={visualPreviewOn}
        onToggleMeditatePreview={toggleVisualPreview}
        analyser={engine.getAnalyser()}
        loadMonitor={engine.getLoadMonitor()}
        adaptive={{
          getState: () => engine.getAdaptiveStabilityState(),
          subscribe: (l) => engine.subscribeAdaptiveStability(l),
        }}
        onCopyAudioReport={() => { void copyAudioReport(); }}
      />

      {updateAvailable && (
        <div className="update-banner">
          <span onClick={() => applyUpdateAndReload()}>
            New version available — tap to update
          </span>
          <button
            className="update-banner-close"
            onClick={(e) => { e.stopPropagation(); setUpdateAvailable(false); }}
            aria-label="Dismiss update banner"
          >
            ✕
          </button>
        </div>
      )}

      {/* Mobile close affordance for MEDITATE / MIXER — the header
          button is covered by the fullscreen overlay / dim backdrop,
          and there's no Esc key on phones. Desktop relies on Esc or
          clicking the header button again (CSS hides this there). */}
      {viewMode !== "drone" && (
        <button
          type="button"
          className="view-close-mobile"
          onClick={() => setViewMode("drone")}
          aria-label={`Close ${viewMode} — back to DRONE`}
          title={`Close ${viewMode}`}
        >
          ✕
        </button>
      )}

      <main className={`view view-mode-${viewMode}`}>
        {/* DRONE is the base layer — always mounted and interactive.
            MEDITATE overlays it fullscreen; MIXER slides up as a
            bottom drawer. Neither replaces the drone view anymore. */}
        <section className="view-panel view-panel-active">
          <DroneView
            ref={droneViewRef}
            engine={engine}
            onTransportChange={setHeaderHolding}
            onTonicChange={(root, octave) => {
              setHeaderTonic(root);
              setHeaderOctave(octave);
            }}
            onPresetChange={handlePresetChange}
            onMutateScene={sceneManager.handleMutateScene}
            onTuneOffsetChange={setHeaderTuneHint}
            onParamRecord={sceneManager.recordParam}
            isRecordingMotion={sceneManager.isRecordingMotion}
            onToggleMotionRecord={sceneManager.handleToggleMotionRecord}
            motionRecEnabled={motionRecEnabled}
            weatherVisual={weatherVisual}
            kbdActive={kbdActive}
            onToggleKbd={() => setKbdActive((v) => !v)}
            isRec={isRec}
            onToggleRec={handleToggleRec}
            recTimeMs={recTimeMs}
            recordingSupported={recordingSupport.supported}
            recordingTitle={recordingTitle}
            recordingBusy={recBusy}
            loopLengthSec={loopLengthSec}
            onLoopLengthChange={setLoopLengthSec}
            onBounceLoop={handleBounceLoop}
            onCancelBounceLoop={handleCancelBounceLoop}
            loopBusy={loopBusy}
            loopProgress={loopProgress}
            onExportTake={handleExportTake}
            onCancelExportTake={handleCancelExportTake}
            takeBusy={takeBusy}
            takeProgress={takeProgress}
            meditateVisualizer={sceneManager.meditateVisualizer}
            onChangeMeditateVisualizer={(v) => {
              trackEvent(`visualizer/${v}`);
              sceneManager.setMeditateVisualizer(v);
            }}
            onOpenMeditate={() => setViewMode("meditate")}
            meditatePreviewPaused={viewMode === "meditate" || meditatePopOutActive}
            visualPreviewOn={visualPreviewOn}
          />
        </section>
        <section
          className={
            viewMode === "meditate"
              ? "view-overlay view-overlay-active"
              // Pop-out needs the canvas to stay composited even while
              // the overlay is "hidden"; otherwise captureStream
              // captures a stale frame and paint ops keep accumulating
              // without the destination-out fade being applied.
              : (meditatePopOutActive
                ? "view-overlay view-overlay-popping"
                : "view-overlay")
          }
          aria-hidden={viewMode !== "meditate"}
        >
          {hasOpenedMeditate && (
          <Suspense fallback={null}>
          <MeditateView
            engine={engine}
            active={viewMode === "meditate"}
            lowPowerMode={lowPowerMode}
            visualizer={sceneManager.meditateVisualizer}
            onChangeVisualizer={(v) => {
              trackEvent(`visualizer/${v}`);
              sceneManager.setMeditateVisualizer(v);
            }}
            onRandomScene={sceneManager.handleRandomScene}
            onPopOutChange={setMeditatePopOutActive}
            onClose={() => setViewMode("drone")}
            onWeather={(x01, y01) => {
              // The MEDITATE canvas IS an expanded WEATHER pad —
              // single click and drag both write climateX/climateY.
              droneViewRef.current?.applyLivePatch?.({ climateX: x01, climateY: y01 }, { record: true });
            }}
          />
          </Suspense>
          )}
        </section>
        <section
          className={viewMode === "mixer" ? "view-drawer view-drawer-active" : "view-drawer"}
          aria-hidden={viewMode !== "mixer"}
          onClick={(e) => {
            // Backdrop click (outside the inner drawer content) dismisses.
            if (e.target === e.currentTarget) setViewMode("drone");
          }}
        >
          <MixerView
            key={mixerSyncToken}
            engine={engine}
            volume={headerVolume}
            onVolumeChange={(v) => {
              setHeaderVolume(v);
              engine.setMasterVolume(v);
            }}
          />
        </section>
      </main>

      {shareOpen && (
        <Suspense fallback={null}>
          <ShareModal
            initialName={sceneManager.shareInitialName}
            onBuildShareData={sceneManager.buildShareSceneData}
            onClose={() => setShareOpen(false)}
          />
        </Suspense>
      )}

      <NotificationTray />
      <TutorialOffer />
      <TutorialFlow />
      <Footer />
    </div>
  );
}
