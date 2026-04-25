/**
 * Dev-only loudness audit. Iterates every visible preset, loads it,
 * lets it settle, samples the engine's existing fx-loudness-meter
 * worklet, and produces:
 *   1. A markdown table the listening-review doc asks for.
 *   2. A JSON sidecar (same data, machine-readable) so a CLI patcher
 *      can apply gain corrections back to PRESETS without a human in
 *      the loop. See scripts/apply-loudness-audit.mjs.
 *
 * Invoked from the browser console via `window.__measureAllPresets()`.
 * Both files are auto-downloaded.
 *
 * Runs in real time using the live engine — no OfflineAudioContext
 * gymnastics. Time budget: ~12 s per preset × N presets = several
 * minutes. Progress is logged to the console.
 */
import type { AudioEngine } from "../engine/AudioEngine";
import { PRESETS } from "../engine/presets";

interface MeasureHooks {
  engine: AudioEngine;
  applyPresetById: (id: string) => void;
  ensurePlaying: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Categorise a settled LUFS-S value against the listening-review
 *  doc's healthy window (-18 to -12 LUFS-S, peaks ≤ -0.5 dBFS). */
function judgeLevel(lufs: number, peak: number): string {
  if (!Number.isFinite(lufs)) return "silent";
  if (lufs < -22) return "quiet";
  if (lufs > -10) return "hot";
  if (peak > -0.3) return "peaky";
  if (lufs >= -18 && lufs <= -12) return "ok";
  return "marginal";
}

/** Healthy-window centre — used by the CLI patcher to compute the
 *  gain correction that would land each preset at this LUFS-S target.
 *  -15 sits in the middle of the listening-review window (-18..-12). */
export const LOUDNESS_TARGET_LUFS = -15;

export async function measureAllPresets(hooks: MeasureHooks): Promise<string> {
  const { engine, applyPresetById, ensurePlaying } = hooks;

  const SETTLE_MS = 5000;   // voices attack + reverbs bloom
  const MEASURE_MS = 7000;  // ~210 samples at 30 Hz

  const rows: Array<{
    id: string;
    name: string;
    group: string;
    gain: number;
    lufs: number;
    peak: number;
    verdict: string;
    suggestedGain: number;
  }> = [];

  // Hidden presets (e.g. "welcome") aren't part of the user-visible
  // library — skip them so the audit reflects only what RND, Start
  // New, and the preset grid can land on.
  const visiblePresets = PRESETS.filter((p) => !p.hidden);
  console.log(`[measure] starting — ${visiblePresets.length} visible presets × ~12s each = ~${Math.round(visiblePresets.length * 12 / 60)} min`);

  for (let i = 0; i < visiblePresets.length; i++) {
    const preset = visiblePresets[i];
    console.log(`[measure] ${i + 1}/${visiblePresets.length}: ${preset.name}`);

    applyPresetById(preset.id);
    ensurePlaying();
    await sleep(SETTLE_MS);

    const lufsSamples: number[] = [];
    let maxPeak = -Infinity;
    const unsub = engine.onLoudnessUpdate(({ lufsShort, peakDb }) => {
      if (Number.isFinite(lufsShort)) lufsSamples.push(lufsShort);
      if (Number.isFinite(peakDb) && peakDb > maxPeak) maxPeak = peakDb;
    });
    await sleep(MEASURE_MS);
    unsub();

    const lufsMedian = median(lufsSamples);
    const peakVal = Number.isFinite(maxPeak) ? maxPeak : NaN;
    const verdict = judgeLevel(lufsMedian, peakVal);
    const currentGain = preset.gain ?? 1;
    // Target gain that would land this preset at LOUDNESS_TARGET_LUFS.
    // dB delta = target - measured; linear scale = 10^(delta/20).
    // Clamped to the same [0.1, 1.7] safety band the regression test
    // uses, so the patcher can never propose a runaway value if the
    // measurement is bogus.
    const suggestedGain = Number.isFinite(lufsMedian)
      ? clamp(currentGain * Math.pow(10, (LOUDNESS_TARGET_LUFS - lufsMedian) / 20), 0.1, 1.7)
      : currentGain;

    rows.push({
      id: preset.id,
      name: preset.name,
      group: preset.group,
      gain: currentGain,
      lufs: lufsMedian,
      peak: peakVal,
      verdict,
      suggestedGain,
    });
  }

  const fmtNum = (v: number) => Number.isFinite(v) ? v.toFixed(1) : "—";
  const lines: string[] = [];
  lines.push("# Preset loudness audit");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()} — settle ${SETTLE_MS} ms, measure ${MEASURE_MS} ms.`);
  lines.push("");
  lines.push(`Healthy window: **-18 to -12 LUFS-S**, peaks ≤ **-0.5 dBFS**. Target centre: **${LOUDNESS_TARGET_LUFS} LUFS-S**.`);
  lines.push("");
  lines.push("| Preset | id | Group | Gain | LUFS-S | PEAK | Verdict | Suggested gain |");
  lines.push("|---|---|---|---:|---:|---:|---|---:|");
  for (const r of rows) {
    lines.push(`| ${r.name} | \`${r.id}\` | ${r.group} | ${r.gain.toFixed(2)} | ${fmtNum(r.lufs)} | ${fmtNum(r.peak)} | ${r.verdict} | ${r.suggestedGain.toFixed(2)} |`);
  }
  lines.push("");
  lines.push("Verdicts: `silent` (no reading), `quiet` (< -22), `ok` (-18..-12), `marginal` (outside ok but not extreme), `hot` (> -10), `peaky` (peak > -0.3 dBFS).");

  // Outlier summary block — surfaces the worst offenders by name + id
  // so the audit reads as actionable instead of just descriptive.
  const hot = rows.filter((r) => r.verdict === "hot" || r.verdict === "peaky")
    .sort((a, b) => b.lufs - a.lufs);
  const cold = rows.filter((r) => r.verdict === "quiet")
    .sort((a, b) => a.lufs - b.lufs);
  lines.push("");
  lines.push("## Outliers");
  lines.push("");
  lines.push(`Hot (${hot.length}):`);
  for (const r of hot) lines.push(`- **${r.name}** (\`${r.id}\`) — ${fmtNum(r.lufs)} LUFS, peak ${fmtNum(r.peak)} dBFS, suggest gain ${r.gain.toFixed(2)} → ${r.suggestedGain.toFixed(2)}`);
  lines.push("");
  lines.push(`Cold (${cold.length}):`);
  for (const r of cold) lines.push(`- **${r.name}** (\`${r.id}\`) — ${fmtNum(r.lufs)} LUFS, suggest gain ${r.gain.toFixed(2)} → ${r.suggestedGain.toFixed(2)}`);

  const markdown = lines.join("\n");
  console.log(markdown);

  // Download both .md (for the audit doc) and .json (for the CLI
  // patcher). The JSON is the authoritative artefact — markdown is
  // a human-readable rendering of the same data.
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  download(`mdrone-loudness-audit-${ts}.md`, markdown, "text/markdown");
  download(
    `mdrone-loudness-audit-${ts}.json`,
    JSON.stringify({ generatedAt: new Date().toISOString(), targetLufs: LOUDNESS_TARGET_LUFS, rows }, null, 2),
    "application/json",
  );

  return markdown;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function download(filename: string, body: string, mime: string): void {
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
}
