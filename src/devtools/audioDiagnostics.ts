/**
 * Audio diagnostics — one-call aggregator that produces a structured
 * "Copy Audio Report" for crackle / frrrr / dropout reports.
 *
 * The pieces already exist (AudioLoadMonitor, audioTrace, adaptive +
 * LIVE-SAFE state, engine getters). This module composes them into a
 * single safe payload + Markdown rendering and a clipboard helper.
 *
 * Privacy contract:
 *   - URL is reduced to origin + pathname; share URLs (which encode the
 *     full scene in the query / hash) are NOT included.
 *   - localStorage / session names / custom tuning arrays are NOT read.
 *   - Browser meta is limited to userAgent / platform / hardware
 *     concurrency / deviceMemory — no fingerprinting beyond what the
 *     browser already sends to every server it talks to.
 *   - User-entered notes from preset certification are NOT pulled.
 *
 * Console API: window.__mdroneAudioReport() — logs Markdown, attempts
 * clipboard copy, returns the structured object.
 */
import type { EffectId } from "../engine/FxChain";
import type { AudioLoadState } from "../engine/AudioLoadMonitor";
import type { AdaptiveStabilityState } from "../engine/AdaptiveStabilityEngine";
import type { LiveSafeState } from "../engine/LiveSafeMode";
import type { VoiceType } from "../engine/VoiceBuilder";
import type { TraceEvent } from "../engine/audioTrace";

export interface AudioDiagnosticsReport {
  meta: {
    appVersion: string;
    timestamp: string;
    /** origin + pathname only — never the share URL query/hash. */
    url: string;
    userAgent: string;
    platform: string;
    hardwareConcurrency: number | null;
    /** GiB. Chromium-only navigator.deviceMemory; null elsewhere. */
    deviceMemoryGb: number | null;
  };
  audioContext: {
    state: string;
    sampleRate: number;
    baseLatencyMs: number;
    outputLatencyMs: number;
    currentTime: number;
  };
  loadMonitor: {
    struggling: boolean;
    driftMs: number;
    underruns: number;
  };
  adaptive: {
    stage: number;
    bypassedFx: readonly EffectId[];
    voiceCap: number | null;
    lowPower: boolean;
  };
  liveSafe: {
    active: boolean;
    voiceCap: number | null;
    suppressedFx: readonly EffectId[];
  };
  lowPower: {
    user: boolean;
    effective: boolean;
  };
  preset: {
    id: string | null;
    name: string | null;
  };
  voices: {
    rootFreqHz: number;
    intervalsCount: number;
    layers: Partial<Record<VoiceType, boolean>>;
    levels: Partial<Record<VoiceType, number>>;
    maxVoiceLayers: number;
  };
  fx: {
    /** What the preset / user wants on. */
    userIntent: Partial<Record<EffectId, boolean>>;
    /** What's actually wired live (suppression overlays applied). */
    effective: Partial<Record<EffectId, boolean>>;
    /** Diff: ids the user wants on but the runtime has off. */
    suppressed: EffectId[];
  };
  mixer: {
    masterVolume: number | null;
    limiterEnabled: boolean | null;
    limiterCeilingDb: number | null;
    headphoneSafe: boolean | null;
    width: number | null;
    roomAmount: number | null;
    drive: number | null;
  };
  audioDebugFlags: string[];
  trace: {
    enabled: boolean;
    eventCount: number;
    /** Last RECENT_TRACE_LIMIT events when enabled; empty otherwise. */
    recent: TraceEvent[];
  };
}

/** How many trace events to ship in the report (when trace is enabled).
 *  Full ring is 512; we cap to keep a copied payload paste-friendly. */
const RECENT_TRACE_LIMIT = 60;

export interface DiagnosticsEngineLike {
  ctx: AudioContext;
  getLoadMonitor(): { getState(): AudioLoadState };
  getAdaptiveStabilityState(): AdaptiveStabilityState;
  getLiveSafeState(): LiveSafeState;
  isLowPower(): boolean;
  isUserLowPower(): boolean;
  getRootFreq(): number;
  getIntervalsCents(): readonly number[];
  getVoiceLayers(): Partial<Record<VoiceType, boolean>>;
  getMaxVoiceLayers(): number;
  getEffectStates(): Partial<Record<EffectId, boolean>>;
  getUserEffectStates(): Partial<Record<EffectId, boolean>>;
  // Optional getters — the report tolerates missing ones for tests / older shapes.
  getVoiceLevel?(t: VoiceType): number;
  getMasterVolume?(): number;
  isLimiterEnabled?(): boolean;
  getLimiterCeiling?(): number;
  isHeadphoneSafe?(): boolean;
  getWidth?(): number;
  getRoomAmount?(): number;
  getDrive?(): number;
}

export interface DiagnosticsHooks {
  appVersion: string;
  engine: DiagnosticsEngineLike;
  /** Active preset id/name — sourced from React state since engine
   *  itself doesn't track preset identity. Optional. */
  getPreset?: () => { id: string | null; name: string | null };
  /** Trace state read — optional override for tests. Defaults to
   *  the live audioTrace ring. */
  getTrace?: () => { enabled: boolean; events: readonly TraceEvent[] };
  /** Active audio-debug flags. Optional override for tests. */
  getAudioDebugFlags?: () => readonly string[];
  // Time / browser source overrides for tests.
  now?: () => Date;
  url?: () => string;
  userAgent?: () => string;
  platform?: () => string;
  hardwareConcurrency?: () => number | null;
  deviceMemoryGb?: () => number | null;
}

const VOICE_TYPES: readonly VoiceType[] = [
  "tanpura", "reed", "metal", "air", "piano", "fm", "amp", "noise",
];

function readUrl(): string {
  if (typeof window === "undefined" || !window.location) return "";
  // origin + pathname only — query/hash carry share-encoded scene state.
  return `${window.location.origin}${window.location.pathname}`;
}

function readDeviceMemory(): number | null {
  if (typeof navigator === "undefined") return null;
  const v = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return typeof v === "number" ? v : null;
}

function readHardwareConcurrency(): number | null {
  if (typeof navigator === "undefined") return null;
  const v = navigator.hardwareConcurrency;
  return typeof v === "number" ? v : null;
}

function safeCall<T>(fn: (() => T) | undefined): T | null {
  if (!fn) return null;
  try { return fn(); } catch { return null; }
}

export function buildAudioDiagnostics(
  hooks: DiagnosticsHooks,
): AudioDiagnosticsReport {
  const e = hooks.engine;
  const now = hooks.now ?? (() => new Date());
  const url = hooks.url ?? readUrl;
  const ua = hooks.userAgent ?? (() => (typeof navigator !== "undefined" ? navigator.userAgent : ""));
  const platform = hooks.platform ?? (() => (typeof navigator !== "undefined" ? navigator.platform : ""));
  const hc = hooks.hardwareConcurrency ?? readHardwareConcurrency;
  const dm = hooks.deviceMemoryGb ?? readDeviceMemory;
  const trace = hooks.getTrace ? hooks.getTrace() : null;
  const flags = hooks.getAudioDebugFlags ? hooks.getAudioDebugFlags() : [];
  const presetInfo = hooks.getPreset ? hooks.getPreset() : { id: null, name: null };

  const monitor = e.getLoadMonitor().getState();
  const adaptive = e.getAdaptiveStabilityState();
  const liveSafe = e.getLiveSafeState();
  const userFx = e.getUserEffectStates();
  const liveFx = e.getEffectStates();
  const layers = e.getVoiceLayers();

  // Suppression diff — entries the user wants on but the runtime has off.
  const suppressed: EffectId[] = [];
  for (const id of Object.keys(userFx) as EffectId[]) {
    if (userFx[id] === true && liveFx[id] === false) suppressed.push(id);
  }

  const levels: Partial<Record<VoiceType, number>> = {};
  if (e.getVoiceLevel) {
    for (const v of VOICE_TYPES) {
      try { levels[v] = e.getVoiceLevel(v); } catch { /* skip */ }
    }
  }

  const traceEvents = trace?.events ?? [];

  return {
    meta: {
      appVersion: hooks.appVersion,
      timestamp: now().toISOString(),
      url: url(),
      userAgent: ua(),
      platform: platform(),
      hardwareConcurrency: hc(),
      deviceMemoryGb: dm(),
    },
    audioContext: {
      state: e.ctx.state,
      sampleRate: e.ctx.sampleRate,
      baseLatencyMs: (e.ctx.baseLatency ?? 0) * 1000,
      outputLatencyMs: (e.ctx.outputLatency ?? 0) * 1000,
      currentTime: e.ctx.currentTime,
    },
    loadMonitor: {
      struggling: monitor.struggling,
      driftMs: monitor.driftMs,
      underruns: monitor.underruns,
    },
    adaptive: {
      stage: adaptive.stage,
      bypassedFx: adaptive.bypassedFx,
      voiceCap: adaptive.voiceCap,
      lowPower: adaptive.lowPower,
    },
    liveSafe: {
      active: liveSafe.active,
      voiceCap: liveSafe.voiceCap,
      suppressedFx: liveSafe.suppressedFx,
    },
    lowPower: {
      user: e.isUserLowPower(),
      effective: e.isLowPower(),
    },
    preset: { id: presetInfo.id, name: presetInfo.name },
    voices: {
      rootFreqHz: e.getRootFreq(),
      intervalsCount: e.getIntervalsCents().length,
      layers,
      levels,
      maxVoiceLayers: e.getMaxVoiceLayers(),
    },
    fx: {
      userIntent: userFx,
      effective: liveFx,
      suppressed,
    },
    mixer: {
      masterVolume: safeCall(e.getMasterVolume),
      limiterEnabled: safeCall(e.isLimiterEnabled),
      limiterCeilingDb: safeCall(e.getLimiterCeiling),
      headphoneSafe: safeCall(e.isHeadphoneSafe),
      width: safeCall(e.getWidth),
      roomAmount: safeCall(e.getRoomAmount),
      drive: safeCall(e.getDrive),
    },
    audioDebugFlags: [...flags],
    trace: {
      enabled: trace?.enabled ?? false,
      eventCount: traceEvents.length,
      recent: trace?.enabled
        ? traceEvents.slice(-RECENT_TRACE_LIMIT)
        : [],
    },
  };
}

export function renderAudioDiagnosticsJson(r: AudioDiagnosticsReport): string {
  return JSON.stringify(r, null, 2);
}

export function renderAudioDiagnosticsMarkdown(r: AudioDiagnosticsReport): string {
  const lines: string[] = [];
  const fmt = (n: number | null, digits = 1) =>
    n === null ? "—" : Number.isFinite(n) ? n.toFixed(digits) : "—";
  const yn = (v: boolean | null) => (v === null ? "—" : v ? "yes" : "no");

  lines.push(`# mdrone audio report — ${r.meta.appVersion}`);
  lines.push("");
  lines.push(`Generated ${r.meta.timestamp}`);
  lines.push(`URL: \`${r.meta.url}\``);
  lines.push("");

  lines.push("## Browser / device");
  lines.push(`- userAgent: \`${r.meta.userAgent}\``);
  lines.push(`- platform: \`${r.meta.platform}\``);
  lines.push(`- hardwareConcurrency: ${r.meta.hardwareConcurrency ?? "—"}`);
  lines.push(`- deviceMemory: ${r.meta.deviceMemoryGb ?? "—"} GiB`);
  lines.push("");

  lines.push("## AudioContext");
  lines.push(`- state: \`${r.audioContext.state}\``);
  lines.push(`- sampleRate: ${r.audioContext.sampleRate} Hz`);
  lines.push(`- baseLatency: ${fmt(r.audioContext.baseLatencyMs)} ms`);
  lines.push(`- outputLatency: ${fmt(r.audioContext.outputLatencyMs)} ms`);
  lines.push(`- currentTime: ${fmt(r.audioContext.currentTime, 3)} s`);
  lines.push("");

  lines.push("## Load monitor");
  lines.push(`- struggling: **${yn(r.loadMonitor.struggling)}**`);
  lines.push(`- drift: ${fmt(r.loadMonitor.driftMs)} ms`);
  lines.push(`- underruns: ${r.loadMonitor.underruns}`);
  lines.push("");

  lines.push("## Adaptive stability");
  lines.push(`- stage: ${r.adaptive.stage}`);
  lines.push(`- lowPower overlay: ${yn(r.adaptive.lowPower)}`);
  lines.push(`- voiceCap (forced): ${r.adaptive.voiceCap ?? "—"}`);
  lines.push(`- bypassedFx: ${r.adaptive.bypassedFx.length ? r.adaptive.bypassedFx.join(", ") : "—"}`);
  lines.push("");

  lines.push("## LIVE SAFE");
  lines.push(`- active: ${yn(r.liveSafe.active)}`);
  lines.push(`- voiceCap (clamped): ${r.liveSafe.voiceCap ?? "—"}`);
  lines.push(`- suppressedFx: ${r.liveSafe.suppressedFx.length ? r.liveSafe.suppressedFx.join(", ") : "—"}`);
  lines.push("");

  lines.push("## Low-power composition");
  lines.push(`- user setting: ${yn(r.lowPower.user)}`);
  lines.push(`- effective: ${yn(r.lowPower.effective)}`);
  lines.push("");

  lines.push("## Preset");
  lines.push(`- id: \`${r.preset.id ?? "—"}\``);
  lines.push(`- name: ${r.preset.name ?? "—"}`);
  lines.push("");

  lines.push("## Voices");
  lines.push(`- rootFreqHz: ${fmt(r.voices.rootFreqHz, 2)}`);
  lines.push(`- intervalsCount: ${r.voices.intervalsCount}`);
  lines.push(`- maxVoiceLayers: ${r.voices.maxVoiceLayers}`);
  const activeLayers = (Object.keys(r.voices.layers) as VoiceType[])
    .filter((k) => r.voices.layers[k]);
  lines.push(`- active layers: ${activeLayers.length ? activeLayers.join(", ") : "—"}`);
  if (Object.keys(r.voices.levels).length) {
    const cells = (Object.keys(r.voices.levels) as VoiceType[])
      .map((k) => `${k}=${fmt(r.voices.levels[k] ?? null, 2)}`);
    lines.push(`- levels: ${cells.join(", ")}`);
  }
  lines.push("");

  lines.push("## FX");
  if (r.fx.suppressed.length) {
    lines.push(`- **suppressed (user-intent ON, runtime OFF):** ${r.fx.suppressed.join(", ")}`);
  } else {
    lines.push("- suppressed: —");
  }
  const userOn = (Object.keys(r.fx.userIntent) as EffectId[])
    .filter((k) => r.fx.userIntent[k]);
  const liveOn = (Object.keys(r.fx.effective) as EffectId[])
    .filter((k) => r.fx.effective[k]);
  lines.push(`- user-intent on: ${userOn.length ? userOn.join(", ") : "—"}`);
  lines.push(`- effective on: ${liveOn.length ? liveOn.join(", ") : "—"}`);
  lines.push("");

  lines.push("## Mixer");
  lines.push(`- masterVolume: ${fmt(r.mixer.masterVolume, 2)}`);
  lines.push(`- limiterEnabled: ${yn(r.mixer.limiterEnabled)}`);
  lines.push(`- limiterCeiling: ${fmt(r.mixer.limiterCeilingDb)} dB`);
  lines.push(`- headphoneSafe: ${yn(r.mixer.headphoneSafe)}`);
  lines.push(`- width: ${fmt(r.mixer.width, 2)}`);
  lines.push(`- roomAmount: ${fmt(r.mixer.roomAmount, 2)}`);
  lines.push(`- drive: ${fmt(r.mixer.drive, 2)}`);
  lines.push("");

  lines.push("## Audio-debug flags");
  lines.push(r.audioDebugFlags.length
    ? r.audioDebugFlags.map((f) => `- \`${f}\``).join("\n")
    : "- (none)");
  lines.push("");

  lines.push("## Trace");
  lines.push(`- enabled: ${yn(r.trace.enabled)}`);
  if (!r.trace.enabled) {
    lines.push("- (enable with `?audio-debug=trace` to capture a ring buffer)");
  } else {
    lines.push(`- ring length: ${r.trace.eventCount}`);
    lines.push(`- recent (last ${r.trace.recent.length}):`);
    lines.push("```");
    for (const ev of r.trace.recent) {
      const t = ev.tMs.toFixed(1);
      const a = ev.audioSec !== null ? ev.audioSec.toFixed(3) : "—";
      const p = ev.payload ? " " + JSON.stringify(ev.payload) : "";
      lines.push(`t=${t}ms a=${a}s ${ev.kind}${p}`);
    }
    lines.push("```");
  }

  return lines.join("\n");
}

/** Best-effort copy. Returns true on apparent success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall through */ }
  }
  // Legacy fallback — works when navigator.clipboard is gated by
  // permissions / non-secure context.
  if (typeof document !== "undefined") {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { /* noop */ }
  }
  return false;
}
