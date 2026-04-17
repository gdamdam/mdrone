/**
 * Dev-only loudness audit. Iterates every preset, loads it, lets it
 * settle, samples the engine's existing fx-loudness-meter worklet,
 * and produces a markdown table the listening-review doc asks for:
 *   | Preset | LUFS-S (median) | PEAK (dBFS max) | Settled Level |
 *
 * Invoked from the browser console via `window.__measureAllPresets()`.
 * Also downloads the table as a .md file for pasting into the audit.
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

export async function measureAllPresets(hooks: MeasureHooks): Promise<string> {
  const { engine, applyPresetById, ensurePlaying } = hooks;

  const SETTLE_MS = 5000;   // voices attack + reverbs bloom
  const MEASURE_MS = 7000;  // ~210 samples at 30 Hz

  const rows: Array<{
    name: string;
    group: string;
    lufs: number;
    peak: number;
    verdict: string;
  }> = [];

  // eslint-disable-next-line no-console
  console.log(`[measure] starting — ${PRESETS.length} presets × ~12s each = ~${Math.round(PRESETS.length * 12 / 60)} min`);

  for (let i = 0; i < PRESETS.length; i++) {
    const preset = PRESETS[i];
    // eslint-disable-next-line no-console
    console.log(`[measure] ${i + 1}/${PRESETS.length}: ${preset.name}`);

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

    rows.push({
      name: preset.name,
      group: preset.group,
      lufs: lufsMedian,
      peak: peakVal,
      verdict,
    });
  }

  const fmtNum = (v: number) => Number.isFinite(v) ? v.toFixed(1) : "—";
  const lines: string[] = [];
  lines.push("# Preset loudness audit");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()} — settle ${SETTLE_MS} ms, measure ${MEASURE_MS} ms.`);
  lines.push("");
  lines.push("Healthy window: **-18 to -12 LUFS-S**, peaks ≤ **-0.5 dBFS**.");
  lines.push("");
  lines.push("| Preset | Group | LUFS-S (median) | PEAK (dBFS) | Verdict |");
  lines.push("|---|---|---:|---:|---|");
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.group} | ${fmtNum(r.lufs)} | ${fmtNum(r.peak)} | ${r.verdict} |`);
  }
  lines.push("");
  lines.push("Verdicts: `silent` (no reading), `quiet` (< -22), `ok` (-18..-12), `marginal` (outside ok but not extreme), `hot` (> -10), `peaky` (peak > -0.3 dBFS).");
  const markdown = lines.join("\n");

  // eslint-disable-next-line no-console
  console.log(markdown);

  // Download as a file.
  try {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mdrone-loudness-audit-${ts}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* browser may block unrelated downloads */ }

  return markdown;
}
