import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useMidiInput, midiNoteToPitch } from "../engine/midiInput";
import { loadCcMap, saveCcMap, assignCc, resetCcMap, MIDI_TARGETS_BY_ID, type CcMap } from "../engine/midiMapping";
import type { AudioEngine } from "../engine/AudioEngine";
import type { PitchClass, ViewMode } from "../types";
import { APP_VERSION, STORAGE_KEYS, type WeatherVisual } from "../config";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { NotificationTray } from "./NotificationTray";
import { showNotification } from "../notifications";
import { measureAllPresets } from "../devtools/measureLoudness";
import { auditArrival } from "../devtools/auditArrival";
import { DroneView, type DroneViewHandle } from "./DroneView";
import { MixerView } from "./MixerView";
import { MeditateView } from "./MeditateView";
import { trackEvent } from "../analytics";
import { TutorialFlow } from "./TutorialFlow";
import { TutorialOffer } from "./TutorialOffer";
import { addHoldTime, isFlowDone, requestOfferFlow } from "../tutorial/state";

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
  const setViewMode = useCallback((mode: ViewMode) => {
    // Track non-default mode switches — gives a sense of how many
    // sessions actually reach MEDITATE / MIXER vs never leave DRONE.
    if (mode !== "drone") trackEvent(`view/${mode}`);
    setViewModeRaw(mode);
  }, []);
  const [isRec, setIsRec] = useState(false);
  const [recTimeMs, setRecTimeMs] = useState(0);
  const [recBusy, setRecBusy] = useState(false);
  // Seamless-loop bounce — parallel to master record, separate state.
  const [loopLengthSec, setLoopLengthSec] = useState(30);
  const [loopBusy, setLoopBusy] = useState(false);
  const [loopProgress, setLoopProgress] = useState<{ elapsedSec: number; totalSec: number } | null>(null);
  const [mixerSyncToken, setMixerSyncToken] = useState(0);
  const [headerTonic, setHeaderTonic] = useState<PitchClass>("A");
  const [headerOctave, setHeaderOctave] = useState(2);
  const [headerHolding, setHeaderHolding] = useState(false);
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
  useEffect(() => {
    if (!isRec) return;
    recStartRef.current = Date.now();
    const id = window.setInterval(
      () => setRecTimeMs(Date.now() - recStartRef.current),
      200,
    );
    return () => {
      window.clearInterval(id);
      setRecTimeMs(0);
    };
  }, [isRec]);

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

  // ── Tutorial trigger ─────────────────────────────────────────
  // SHARE flow fires once the user has accumulated 2 minutes of
  // HOLD-on time — the only engagement signal worth auto-triggering
  // on. Gated on intro being done so it never stacks with first-run
  // chrome.
  const SHARE_HOLD_THRESHOLD_MS = 120_000;
  useEffect(() => {
    if (!headerHolding) return;
    const TICK_MS = 1000;
    const id = window.setInterval(() => {
      const total = addHoldTime(TICK_MS);
      if (
        total >= SHARE_HOLD_THRESHOLD_MS &&
        isFlowDone("intro") &&
        !isFlowDone("share")
      ) {
        // Offer as a pill — user chooses whether to take the tour.
        requestOfferFlow("share");
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [headerHolding]);

  // Dev tool — iterate every preset, sample the loudness worklet,
  // emit a markdown audit table + download file. Exposed on window
  // so the review can be triggered from the browser console:
  //   await __measureAllPresets()
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__measureAllPresets = () => measureAllPresets({
      engine,
      applyPresetById: (id) => droneViewRef.current?.applyPresetById(id),
      ensurePlaying: () => {
        if (!engine.isPlaying()) holdToggleRef.current?.();
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__auditArrival = (dwellMs?: number) => auditArrival({
      applyPresetById: (id) => droneViewRef.current?.applyPresetById(id),
      ensurePlaying: () => {
        if (!engine.isPlaying()) holdToggleRef.current?.();
      },
    }, dwellMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__auditArrival.stop = () => auditArrival.stop();
    // Console handle for the engine — useful for ad-hoc debugging
    // (e.g. `__engine.setRoomAmount(1)` to bypass the mixer slider
    // and sanity-check the master room path). Stays in production
    // because it's tiny and the audit hooks above already do the
    // same trick.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__engine = engine;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__measureAllPresets;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__auditArrival;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__engine;
    };
  }, [engine]);

  // MIDI input — external keyboard drives tonic + octave.
  const handleMidiNote = useCallback((note: number) => {
    const { pitchClass, octave } = midiNoteToPitch(note);
    const clamped = Math.max(1, Math.min(6, octave));
    droneViewRef.current?.setRoot(pitchClass);
    droneViewRef.current?.setOctave(clamped);
  }, []);

  // MIDI CC mapping — target registry + learn-mode overrides. The
  // registry lives in midiMapping.ts; the dispatch below knows how
  // to route each target id to the engine / drone view / scene
  // manager.
  const [ccMap, setCcMap] = useState<CcMap>(loadCcMap);
  const [midiLearnTarget, setMidiLearnTarget] = useState<string | null>(null);
  const ccMapRef = useRef(ccMap);
  const midiLearnRef = useRef(midiLearnTarget);
  useEffect(() => { ccMapRef.current = ccMap; }, [ccMap]);
  useEffect(() => { midiLearnRef.current = midiLearnTarget; }, [midiLearnTarget]);

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

      // Voice levels (0..1)
      case "voice.tanpura": eng?.setVoiceLevel?.("tanpura", norm); break;
      case "voice.reed":    eng?.setVoiceLevel?.("reed",    norm); break;
      case "voice.metal":   eng?.setVoiceLevel?.("metal",   norm); break;
      case "voice.air":     eng?.setVoiceLevel?.("air",     norm); break;
      case "voice.piano":   eng?.setVoiceLevel?.("piano",   norm); break;
      case "voice.fm":      eng?.setVoiceLevel?.("fm",      norm); break;
      case "voice.amp":     eng?.setVoiceLevel?.("amp",     norm); break;

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
        droneViewRef.current?.setRoot(pc);
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
  const recordingTitle = !recordingSupport.supported
    ? (recordingSupport.reason ?? "Recording is unavailable in this browser.")
    : isRec
      ? "Stop master recording and download the WAV"
      : "Record the full master output as a WAV file";

  const handleToggleRec = async () => {
    if (recBusy) return;
    setRecBusy(true);
    try {
      if (!isRec) {
        await engine.startMasterRecording();
        trackEvent("recording/wav");
        setIsRec(true);
      } else {
        await engine.stopMasterRecording();
        setIsRec(false);
      }
    } catch (error) {
      console.error("mdrone: recording failed", error);
      const message = error instanceof Error ? error.message : "Unknown recording error.";
      showNotification(`Recording failed — ${message}`, "error");
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
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `mdrone-loop-${loopLengthSec}s-${ts}.wav`;
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
   * First pointerdown anywhere in the layout resumes the AudioContext.
   * Because the engine is always non-null now, descendant click
   * handlers on the SAME interaction (e.g. HOLD button click after
   * pointerdown) fire against a live engine — no "first click unlocks,
   * second click acts" bug.
   */
  const handleUnlock = () => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    void engine.resume();
  };

  return (
    <div className="layout" onPointerDown={handleUnlock}>
      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        sessions={sceneManager.savedSessions}
        currentSessionId={sceneManager.currentSessionId}
        currentSessionName={sceneManager.currentSessionName}
        onLoadSession={sceneManager.handleLoadSession}
        onSaveSession={sceneManager.handleSaveSession}
        onRenameSession={sceneManager.handleRenameSession}
        getDefaultSessionName={sceneManager.getDefaultSessionName}
        displayText={sceneManager.displayText}
        isArrivalPreset={sceneManager.isArrivalPreset}
        rndArrivalRemaining={sceneManager.rndArrivalRemaining}
        tonic={headerTonic}
        octave={headerOctave}
        onChangeTonic={(pc) => droneViewRef.current?.setRoot(pc)}
        onChangeOctave={(o) => droneViewRef.current?.setOctave(Math.max(1, Math.min(6, o)))}
        onToggleHold={handleToggleHold}
        holding={headerHolding}
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
        onMidiResetMap={handleResetCcMap}
        weatherVisual={weatherVisual}
        onChangeWeatherVisual={setWeatherVisual}
        motionRecEnabled={motionRecEnabled}
        onToggleMotionRec={setMotionRecEnabled}
        meditatePreviewOn={visualPreviewOn}
        onToggleMeditatePreview={toggleVisualPreview}
        analyser={engine.getAnalyser()}
        loadMonitor={engine.getLoadMonitor()}
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
          <MeditateView
            engine={engine}
            active={viewMode === "meditate"}
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
