/**
 * Preset certification — devtool that helps a human audition every
 * preset, record tags / scores / notes, attach basic technical
 * readings, and export the session as Markdown + JSON.
 *
 * Hands-and-ears flow per misc/2026-04-28-preset-certification.md.
 * Machines catch failure; ears certify instruments. The tool only
 * automates the tedium — preset advance, technical snapshot capture,
 * markdown rendering — and never auto-certifies. The human verdict
 * lands via {@link PresetCertController.mark}.
 *
 * Console API (installed by Layout when in dev / production console):
 *
 *   await __presetCert.start({ auditionMs: 60_000 })
 *   __presetCert.current()
 *   __presetCert.mark({ tag: "LIVE_SAFE", scores: { toneQuality: 5 }, notes: "..." })
 *   await __presetCert.next()
 *   __presetCert.exportMarkdown()
 *   __presetCert.exportJson()
 *   __presetCert.reset()
 *
 * Saved scenes / share URLs / persisted presets are never mutated.
 * applyPresetById is a transient "audition" — the same hook the
 * loudness-audit devtool uses.
 */

import type { EffectId } from "../engine/FxChain";

export const PRESET_CERT_TAGS = [
  "LIVE_SAFE",
  "STUDIO",
  "RICH",
  "WILD",
  "REWORK",
] as const;
export type PresetCertTag = (typeof PRESET_CERT_TAGS)[number];

export const PRESET_CERT_FLAGS = [
  "CPU_HEAVY",
  "SAFARI_CHECK",
  "HEADPHONES",
  "SUB_RISK",
  "BRIGHT_FATIGUE",
  "GREAT_WITH_MEDITATE",
  "GOOD_RND_ARRIVAL",
] as const;
export type PresetCertFlag = (typeof PRESET_CERT_FLAGS)[number];

export const PRESET_CERT_SCORE_KEYS = [
  "toneQuality",
  "longHoldComfort",
  "gestureResponse",
  "stabilityConfidence",
  "gainBehavior",
  "identity",
  "professionalReadiness",
] as const;
export type PresetCertScoreKey = (typeof PRESET_CERT_SCORE_KEYS)[number];
export type PresetCertScores = Partial<Record<PresetCertScoreKey, number>>;

export interface PresetCertMarkInput {
  tag?: PresetCertTag;
  flags?: readonly PresetCertFlag[];
  scores?: PresetCertScores;
  verdict?: string;
  notes?: string;
}

export interface PresetCertTechnical {
  voiceLayers: string[];
  /** User-intended ON effects (not the runtime overlay — we want
   *  certification to reflect what the preset actually asks for). */
  effects: EffectId[];
  /** Adaptive mitigation stage observed at capture time, 0 if absent. */
  adaptiveStage: number;
  /** Cumulative underruns from the load monitor at capture. */
  underruns: number;
  /** Settled LUFS-S median if a measurement was performed; null if not. */
  lufsShort: number | null;
  peakDb: number | null;
}

export interface PresetCertEntry {
  presetId: string;
  presetName: string;
  group: string;
  startedAt: string;
  technical: PresetCertTechnical;
  // Human-entered fields — optional; set via mark().
  tag?: PresetCertTag;
  flags?: readonly PresetCertFlag[];
  scores?: PresetCertScores;
  verdict?: string;
  notes?: string;
  markedAt?: string;
}

export interface PresetCertCurrent {
  presetId: string;
  presetName: string;
  group: string;
  index: number;
  total: number;
  auditionElapsedMs: number;
  auditionRequiredMs: number;
  hasMark: boolean;
  technical: PresetCertTechnical;
}

export interface PresetCertStartOptions {
  /** Minimum audition time before mark() should be considered. The
   *  controller does not enforce — it just reports elapsed/required
   *  via current() so a wrapper UI / human can decide. */
  auditionMs?: number;
  /** Only audition presets matching this filter. Defaults to all
   *  visible (non-hidden) presets. */
  filter?: (p: PresetCertItem) => boolean;
}

export interface PresetCertItem {
  id: string;
  name: string;
  group: string;
  hidden?: boolean;
}

export interface PresetCertHooks {
  presets: ReadonlyArray<PresetCertItem>;
  applyPresetById: (id: string) => void;
  ensurePlaying?: () => void;
  /** Return a fresh technical snapshot for the currently-loaded preset.
   *  Optional — tests don't need a real engine. */
  captureTechnical?: () => PresetCertTechnical;
  /** Time source — overridable for tests. Returns ISO string. */
  nowIso?: () => string;
  /** Monotonic ms — overridable for tests. */
  nowMs?: () => number;
  /** Side-effect for export — file download in browser; no-op in tests. */
  download?: (filename: string, body: string, mime: string) => void;
}

export interface PresetCertController {
  start(opts?: PresetCertStartOptions): Promise<void>;
  next(): Promise<boolean>;
  prev(): Promise<boolean>;
  current(): PresetCertCurrent | null;
  mark(input: PresetCertMarkInput): void;
  exportMarkdown(): string;
  exportJson(): string;
  reset(): void;
  /** Direct read for tests — stable shape, do not rely on it from UI. */
  _entries(): readonly PresetCertEntry[];
}

const DEFAULT_AUDITION_MS = 60_000;

const EMPTY_TECHNICAL: PresetCertTechnical = {
  voiceLayers: [],
  effects: [],
  adaptiveStage: 0,
  underruns: 0,
  lufsShort: null,
  peakDb: null,
};

export function validateMark(input: PresetCertMarkInput): void {
  if (input.tag !== undefined && !PRESET_CERT_TAGS.includes(input.tag)) {
    throw new Error(`presetCert: unknown tag "${input.tag}"`);
  }
  if (input.flags) {
    for (const f of input.flags) {
      if (!PRESET_CERT_FLAGS.includes(f)) {
        throw new Error(`presetCert: unknown flag "${f}"`);
      }
    }
  }
  if (input.scores) {
    for (const k of Object.keys(input.scores) as PresetCertScoreKey[]) {
      if (!PRESET_CERT_SCORE_KEYS.includes(k)) {
        throw new Error(`presetCert: unknown score key "${k}"`);
      }
      const v = input.scores[k];
      if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > 5)) {
        throw new Error(`presetCert: score "${k}"=${v} must be integer 1..5`);
      }
    }
  }
}

interface Session {
  startedAt: string;
  auditionRequiredMs: number;
  presets: PresetCertItem[];
  index: number;
  entries: Map<string, PresetCertEntry>;
  auditionStartMs: number;
}

export function createPresetCertController(
  hooks: PresetCertHooks,
): PresetCertController {
  const nowIso = hooks.nowIso ?? (() => new Date().toISOString());
  const nowMs = hooks.nowMs ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const captureTechnical = hooks.captureTechnical ?? (() => ({ ...EMPTY_TECHNICAL }));

  let session: Session | null = null;

  function ensureSession(method: string): Session {
    if (!session) throw new Error(`presetCert: ${method}() requires start() first`);
    return session;
  }

  function applyAtIndex(s: Session, i: number): void {
    const preset = s.presets[i];
    hooks.applyPresetById(preset.id);
    hooks.ensurePlaying?.();
    s.auditionStartMs = nowMs();
    if (!s.entries.has(preset.id)) {
      s.entries.set(preset.id, {
        presetId: preset.id,
        presetName: preset.name,
        group: preset.group,
        startedAt: nowIso(),
        technical: captureTechnical(),
      });
    } else {
      // Re-applying (prev/next round-trip) — refresh technical only, keep mark.
      const entry = s.entries.get(preset.id)!;
      entry.technical = captureTechnical();
    }
  }

  return {
    async start(opts: PresetCertStartOptions = {}): Promise<void> {
      const filter = opts.filter ?? ((p) => !p.hidden);
      const presets = hooks.presets.filter(filter);
      if (presets.length === 0) {
        throw new Error("presetCert: no presets matched filter");
      }
      session = {
        startedAt: nowIso(),
        auditionRequiredMs: opts.auditionMs ?? DEFAULT_AUDITION_MS,
        presets: [...presets],
        index: 0,
        entries: new Map(),
        auditionStartMs: nowMs(),
      };
      applyAtIndex(session, 0);
    },

    async next(): Promise<boolean> {
      const s = ensureSession("next");
      if (s.index >= s.presets.length - 1) return false;
      s.index += 1;
      applyAtIndex(s, s.index);
      return true;
    },

    async prev(): Promise<boolean> {
      const s = ensureSession("prev");
      if (s.index <= 0) return false;
      s.index -= 1;
      applyAtIndex(s, s.index);
      return true;
    },

    current(): PresetCertCurrent | null {
      if (!session) return null;
      const s = session;
      const preset = s.presets[s.index];
      const entry = s.entries.get(preset.id);
      return {
        presetId: preset.id,
        presetName: preset.name,
        group: preset.group,
        index: s.index,
        total: s.presets.length,
        auditionElapsedMs: nowMs() - s.auditionStartMs,
        auditionRequiredMs: s.auditionRequiredMs,
        hasMark: entry?.markedAt !== undefined,
        technical: entry?.technical ?? { ...EMPTY_TECHNICAL },
      };
    },

    mark(input: PresetCertMarkInput): void {
      const s = ensureSession("mark");
      validateMark(input);
      const preset = s.presets[s.index];
      const entry = s.entries.get(preset.id);
      if (!entry) throw new Error(`presetCert: no entry for ${preset.id}`);
      if (input.tag !== undefined) entry.tag = input.tag;
      if (input.flags !== undefined) entry.flags = [...input.flags];
      if (input.scores !== undefined) entry.scores = { ...entry.scores, ...input.scores };
      if (input.verdict !== undefined) entry.verdict = input.verdict;
      if (input.notes !== undefined) entry.notes = input.notes;
      entry.markedAt = nowIso();
    },

    exportMarkdown(): string {
      const s = session;
      const entries = s ? [...s.entries.values()] : [];
      const lines: string[] = [];
      lines.push("# Preset certification");
      lines.push("");
      if (s) {
        lines.push(`Session started ${s.startedAt}. ${entries.length}/${s.presets.length} presets reviewed.`);
        lines.push("");
      }
      lines.push("| Preset | Group | Tag | Tone | Hold | Gesture | Stability | Gain | Identity | Pro | Verdict |");
      lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|");
      const fmt = (v?: number) => v === undefined ? "—" : String(v);
      for (const e of entries) {
        const sc = e.scores ?? {};
        lines.push(
          `| ${e.presetName} | ${e.group} | ${e.tag ?? "—"} ` +
          `| ${fmt(sc.toneQuality)} | ${fmt(sc.longHoldComfort)} | ${fmt(sc.gestureResponse)} ` +
          `| ${fmt(sc.stabilityConfidence)} | ${fmt(sc.gainBehavior)} | ${fmt(sc.identity)} | ${fmt(sc.professionalReadiness)} ` +
          `| ${(e.verdict ?? "").replace(/\|/g, "\\|")} |`,
        );
      }
      lines.push("");
      lines.push("## Detail");
      lines.push("");
      for (const e of entries) {
        lines.push(`### ${e.presetName} (\`${e.presetId}\`)`);
        lines.push("");
        lines.push(`- Group: ${e.group}`);
        if (e.tag) lines.push(`- Tag: \`${e.tag}\``);
        if (e.flags && e.flags.length) lines.push(`- Flags: ${e.flags.map((f) => `\`${f}\``).join(", ")}`);
        if (e.technical.adaptiveStage > 0) lines.push(`- Adaptive stage during audition: ${e.technical.adaptiveStage}`);
        if (e.technical.underruns > 0) lines.push(`- Underruns observed: ${e.technical.underruns}`);
        if (e.technical.lufsShort !== null) lines.push(`- LUFS-S: ${e.technical.lufsShort.toFixed(1)} (peak ${e.technical.peakDb?.toFixed(1) ?? "—"} dBFS)`);
        if (e.technical.voiceLayers.length) lines.push(`- Voice layers: ${e.technical.voiceLayers.join(", ")}`);
        if (e.technical.effects.length) lines.push(`- FX (user intent): ${e.technical.effects.join(", ")}`);
        if (e.verdict) {
          lines.push("");
          lines.push(`> ${e.verdict}`);
        }
        if (e.notes) {
          lines.push("");
          lines.push(e.notes);
        }
        lines.push("");
      }
      const out = lines.join("\n");
      hooks.download?.(`mdrone-preset-cert-${tsSlug(nowIso())}.md`, out, "text/markdown");
      return out;
    },

    exportJson(): string {
      const s = session;
      const payload = {
        generatedAt: nowIso(),
        sessionStartedAt: s?.startedAt ?? null,
        auditionRequiredMs: s?.auditionRequiredMs ?? DEFAULT_AUDITION_MS,
        total: s?.presets.length ?? 0,
        entries: s ? [...s.entries.values()] : [],
      };
      const out = JSON.stringify(payload, null, 2);
      hooks.download?.(`mdrone-preset-cert-${tsSlug(nowIso())}.json`, out, "application/json");
      return out;
    },

    reset(): void {
      session = null;
    },

    _entries(): readonly PresetCertEntry[] {
      return session ? [...session.entries.values()] : [];
    },
  };
}

function tsSlug(iso: string): string {
  return iso.replace(/[:.]/g, "-").slice(0, 19);
}
