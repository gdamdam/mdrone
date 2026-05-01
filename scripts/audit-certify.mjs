// Merge offline preset audit (tmp/preset-audit.json) with a runtime
// certification export (cert JSON saved by __presetCert.exportJson()
// in the browser) into a single markdown report.
//
// Offline audit gives us measurable facts: LUFS, sample peak, RMS,
// DC, band energy, click stats, list of FX skipped under Node. The
// runtime certification adds the human verdict, scores, flags, plus
// browser/AudioContext metadata that can't be captured offline.
//
// Usage:
//   npm run audit:certify
//   npm run audit:certify -- --audit tmp/preset-audit.json --cert path/to/cert.json
//   npm run audit:certify -- --out tmp/preset-certification.md
//
// Either side can be missing — the script still emits a useful
// report, flagging which side it had. Joins on preset id.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function parseArgs(argv) {
  const out = { audit: null, cert: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--audit") out.audit = argv[++i];
    else if (a === "--cert") out.cert = argv[++i];
    else if (a === "--out") out.outPath = argv[++i];
  }
  return out;
}

function loadJson(path) {
  if (!path || !existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { console.error(`failed to parse ${path}: ${e.message}`); return null; }
}

function fmt(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return typeof v === "number" ? v.toFixed(digits) : String(v);
}

function scoreCell(scores, key) {
  if (!scores) return "—";
  const v = scores[key];
  return v === undefined ? "—" : String(v);
}

function envSummary(env) {
  if (!env) return null;
  const parts = [];
  if (env.sampleRate) parts.push(`${env.sampleRate} Hz`);
  if (env.baseLatency != null) parts.push(`base ${(env.baseLatency * 1000).toFixed(1)} ms`);
  if (env.outputLatency != null) parts.push(`out ${(env.outputLatency * 1000).toFixed(1)} ms`);
  if (env.contextState) parts.push(env.contextState);
  return parts.length ? parts.join(" · ") : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const auditPath = resolve(ROOT, args.audit ?? "tmp/preset-audit.json");
  const certPath = args.cert ? resolve(ROOT, args.cert) : null;
  const outPath = resolve(ROOT, args.outPath ?? "tmp/preset-certification.md");

  const audit = loadJson(auditPath);
  const cert = certPath ? loadJson(certPath) : null;

  if (!audit && !cert) {
    console.error(`audit-certify: nothing to merge — neither ${auditPath} nor a cert JSON found.`);
    process.exit(1);
  }

  const auditPresets = audit?.presets ?? {};
  const certEntries = (cert?.entries ?? []);
  const certById = new Map(certEntries.map((e) => [e.presetId, e]));

  // Union of ids — audit usually drives, cert may include presets the
  // audit run didn't cover.
  const ids = new Set([...Object.keys(auditPresets), ...certById.keys()]);

  const lines = [];
  lines.push(`# mdrone preset certification`);
  lines.push("");
  if (audit) {
    lines.push(`Offline audit: v${audit.version} @ ${audit.commit ?? "?"}, ${audit.renderSeconds}s render at ${audit.sampleRate} Hz, ${audit.voiceBusOnly ? "voice-bus only" : "voice + FX (worklet)"}.`);
  } else {
    lines.push(`Offline audit: not found.`);
  }
  if (cert) {
    lines.push(`Runtime certification: session ${cert.sessionStartedAt ?? "—"}, ${certEntries.length}/${cert.total ?? "?"} entries.`);
  } else {
    lines.push(`Runtime certification: not provided (pass --cert path/to/export.json).`);
  }
  lines.push("");

  lines.push("| Preset | Tag | LUFS | Peak dB | Pro | Hold | Stab | Verdict |");
  lines.push("|---|---|--:|--:|--:|--:|--:|---|");
  const sortedIds = [...ids].sort();
  for (const id of sortedIds) {
    const a = auditPresets[id];
    const c = certById.get(id);
    const name = c?.presetName ?? id;
    const tag = c?.tag ?? "—";
    const lufs = a?.lufs ?? c?.technical?.lufsShort ?? null;
    const peak = a?.samplePeakDb ?? c?.technical?.peakDb ?? null;
    const sc = c?.scores ?? {};
    const verdict = (c?.verdict ?? "").replace(/\|/g, "\\|").slice(0, 80);
    lines.push(
      `| ${name} | ${tag} | ${fmt(lufs)} | ${fmt(peak)} ` +
      `| ${scoreCell(sc, "professionalReadiness")} | ${scoreCell(sc, "longHoldComfort")} | ${scoreCell(sc, "stabilityConfidence")} ` +
      `| ${verdict} |`,
    );
  }
  lines.push("");
  lines.push("## Detail");
  lines.push("");
  for (const id of sortedIds) {
    const a = auditPresets[id];
    const c = certById.get(id);
    const name = c?.presetName ?? id;
    lines.push(`### ${name} (\`${id}\`)`);
    lines.push("");
    if (c?.group) lines.push(`- Group: ${c.group}`);
    if (c?.tag) lines.push(`- Tag: \`${c.tag}\``);
    if (c?.flags?.length) lines.push(`- Flags: ${c.flags.map((f) => `\`${f}\``).join(", ")}`);
    if (a) {
      lines.push(`- Audit: LUFS ${fmt(a.lufs)} · peak ${fmt(a.samplePeakDb)} dBFS · RMS ${fmt(a.rmsDb)} dB · crest ${fmt(a.crestFactor, 2)} · L/R corr ${fmt(a.lrCorr, 2)}`);
      if (a.skippedFx?.length) lines.push(`- Audit skipped FX: ${a.skippedFx.join(", ")}`);
    } else {
      lines.push(`- Audit: not in this run`);
    }
    if (c?.technical) {
      const t = c.technical;
      if (t.adaptiveStage > 0) lines.push(`- Adaptive stage during audition: ${t.adaptiveStage}`);
      if (t.underruns > 0) lines.push(`- Underruns observed: ${t.underruns}`);
      if (t.voiceLayers?.length) lines.push(`- Voice layers: ${t.voiceLayers.join(", ")}`);
      if (t.effects?.length) lines.push(`- FX (user intent): ${t.effects.join(", ")}`);
      const env = envSummary(t.env);
      if (env) lines.push(`- Audio context: ${env}`);
      if (t.env?.userAgent) lines.push(`- UA: \`${t.env.userAgent}\``);
    }
    if (c?.verdict) {
      lines.push("");
      lines.push(`> ${c.verdict}`);
    }
    if (c?.notes) {
      lines.push("");
      lines.push(c.notes);
    }
    lines.push("");
  }

  const tmpDir = dirname(outPath);
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  writeFileSync(outPath, lines.join("\n"));
  console.error(`wrote ${outPath} (${ids.size} presets)`);
}

main();
