import { useEffect, type RefObject } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import { measureAllPresets } from "./measureLoudness";
import { auditArrival } from "./auditArrival";
import {
  createPresetCertController,
  captureBrowserEnv,
  type PresetCertHooks,
} from "./presetCertification";
import { isDebugEnabled } from "./debugFlag";
import { PRESETS as ALL_PRESETS } from "../engine/presets";

/**
 * Public surface for the dev tools that the hook needs to drive the
 * engine + UI. Kept narrow so Layout doesn't have to leak refs to
 * arbitrary internals.
 */
export interface DevGlobalsHandle {
  applyPresetById: (id: string) => void;
}

export interface UseDevGlobalsOpts {
  engine: AudioEngine;
  /** DroneView ref — used to apply presets imperatively. */
  droneViewRef: RefObject<DevGlobalsHandle | null>;
  /** HOLD-toggle ref — used to ensure playback for audits. */
  holdToggleRef: RefObject<(() => void) | null>;
  /** Audio diagnostics report callback (always-on). */
  copyAudioReport: () => void;
}

/**
 * Registers dev-only window globals (`__engine`, `__measureAllPresets`,
 * `__auditArrival`, `__presetCert`) when the debug flag is enabled,
 * plus the always-on `__mdroneAudioReport` helper backing the in-UI
 * diagnostics button.
 *
 * Production users see no globals unless they opt in via `?debug=1`
 * or `localStorage["mdrone-debug"]` — see {@link isDebugEnabled}.
 */
export function useDevGlobals(opts: UseDevGlobalsOpts): void {
  const { engine, droneViewRef, holdToggleRef, copyAudioReport } = opts;

  useEffect(() => {
    const debugEnabled = isDebugEnabled();
    // Always-available diagnostic — backs the in-UI audio report.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__mdroneAudioReport = () => copyAudioReport();
    if (!debugEnabled) {
      return () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any).__mdroneAudioReport;
      };
    }
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
    // and sanity-check the master room path).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__engine = engine;

    // Preset certification — hands-and-ears auditioning with structured
    // tags / scores / notes export. See src/devtools/presetCertification.ts
    // and misc/2026-04-28-preset-certification.md.
    const certHooks: PresetCertHooks = {
      presets: ALL_PRESETS.map((p) => ({
        id: p.id, name: p.name, group: p.group, hidden: p.hidden,
      })),
      applyPresetById: (id) => droneViewRef.current?.applyPresetById(id),
      ensurePlaying: () => {
        if (!engine.isPlaying()) holdToggleRef.current?.();
      },
      captureTechnical: () => {
        const layers = engine.getVoiceLayers();
        const userFx = engine.getUserEffectStates();
        const adaptive = engine.getAdaptiveStabilityState();
        const monitor = engine.getLoadMonitor().getState();
        return {
          voiceLayers: (Object.keys(layers) as Array<keyof typeof layers>)
            .filter((k) => layers[k]) as string[],
          effects: (Object.keys(userFx) as Array<keyof typeof userFx>)
            .filter((k) => userFx[k]),
          adaptiveStage: adaptive.stage,
          underruns: monitor.underruns,
          lufsShort: null,
          peakDb: null,
        };
      },
      captureEnv: () => captureBrowserEnv(engine.ctx ?? null),
      download: (filename, body, mime) => {
        try {
          const blob = new Blob([body], { type: mime });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { /* browser may block consecutive downloads */ }
      },
    };
    const cert = createPresetCertController(certHooks);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__presetCert = cert;

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__measureAllPresets;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__auditArrival;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__engine;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__presetCert;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__mdroneAudioReport;
    };
  }, [engine, copyAudioReport, droneViewRef, holdToggleRef]);
}
