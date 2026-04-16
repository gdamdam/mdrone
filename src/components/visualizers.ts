/**
 * visualizers.ts — single pitch-mandala visualizer.
 *
 * This module used to expose 14 visualizers across GEOMETRIC / SPECTRAL
 * / FIELD / HYPNOTIC groups. All of them were amplitude-reactive with
 * hue-from-audio palettes — which directly contradicts the project's
 * visual ethos (no glow, no audio-rate animation, no hue-from-audio,
 * matte/heavy materials, legibility from 20+ m). The full replacement
 * happened 2026-04-16 to collapse the surface to one mandala that
 * accrues state via a long (30 s) integrator over the instrument's
 * real pitch-class energies. Everything else lives in git history.
 *
 * Each visualizer is a pure drawing function taking:
 *   ctx    — 2D rendering context
 *   w, h   — canvas width/height in CSS px
 *   audio  — { rms, peak, spectrum } sampled from the master analyser
 *   phase  — slow clocks and macro-derived mood that let the image
 *            breathe without reacting at audio rate
 */

export type Visualizer = "pitchMandala";

export const VISUALIZER_GROUPS: readonly {
  label: string;
  items: readonly Visualizer[];
}[] = [
  { label: "PITCH", items: ["pitchMandala"] },
];

export const VISUALIZER_ORDER: readonly Visualizer[] = ["pitchMandala"];

export const VISUALIZER_LABELS: Record<Visualizer, string> = {
  pitchMandala: "PITCH MANDALA",
};

export interface AudioFrame {
  rms: number;         // 0..1
  peak: number;        // 0..1
  spectrum: Float32Array; // 32 normalized bins, 0..1
  waveform?: Uint8Array;  // raw time-domain data (128 = silence)
}

export interface PhaseClock {
  t: number;     // seconds of audible time since mount (frozen in silence)
  slow: number;  // 0..1 sin drift (1 / 60s), macro-paced
  hue: number;   // rotating 0..360 — derived from preset mood, not audio
  growth: number; // 0..1 long-growth clock (tau ≈ 60s)
  pointer: { x: number; y: number } | null;
  pointerDown: boolean;
  /** Mood derived from engine macros (climateX/air/sub/voice layers),
   *  NOT raw audio amplitude. Preset-driven palette is ethos-compliant;
   *  hue-from-audio would not be. */
  mood: { hue: number; warmth: number; brightness: number; density: number };
  /** Ground-truth active pitch-class energies from root + intervals +
   *  8 harmonics per voice. 0..1 per pitch class (0=C, 1=C#, …, 11=B). */
  activePitches: Float32Array;
}

/** No-op stub — the sigil visualizer was removed in the mandala
 *  consolidation. Kept so useSceneManager's existing refresh calls
 *  don't need conditional guards everywhere. */
export function requestSigilRefresh(): void { /* noop */ }

// ─── Pitch-mandala state (module-scope — MeditateView is singleton) ──
// The long integrator accrues pitch-class presence over ~30 s so the
// image lags behind the sound instead of reacting to it. When silence
// arrives, `p.t` stops advancing → `dtSec` → 0 → integrator freezes.
// The accrual resumes from where it was when the drone returns.
const longEnergy = new Float32Array(12);
let longEnergyInit = false;
let lastT = -1;
/** Long-tau (seconds) for the pitch-class integrator. 30 s matches the
 *  "visual should feel behind the sound, accruing" axiom from the
 *  touch/ drone ethos. */
const LONG_TAU_SEC = 30;

/**
 * Reset the mandala's internal long-integrator. Called by MeditateView
 * on mount / preset change so the image doesn't carry stale state from
 * the previous session.
 */
export function resetPitchMandala(): void {
  longEnergy.fill(0);
  longEnergyInit = false;
  lastT = -1;
}

export function drawPitchMandala(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  _a: AudioFrame,
  p: PhaseClock,
): void {
  // Solid matte background — no trailing fade. Ethos: matte, not
  // emissive; reset is a full wash, not a lingering ghost.
  const warmth = p.mood.warmth;
  const bgL = 4 + warmth * 2;            // 4..6% lightness (near-black matte)
  const bgH = 20 + warmth * 20;          // 20°..40° (graphite → parchment tint)
  ctx.fillStyle = `hsl(${bgH}, 8%, ${bgL}%)`;
  ctx.fillRect(0, 0, w, h);

  // Integrator step — advance only while `p.t` moves (i.e. while audible).
  const dtSec = lastT < 0 ? 0 : Math.max(0, Math.min(2, p.t - lastT));
  lastT = p.t;
  if (!longEnergyInit) {
    for (let i = 0; i < 12; i++) longEnergy[i] = p.activePitches[i];
    longEnergyInit = true;
  } else if (dtSec > 0) {
    const k = 1 - Math.exp(-dtSec / LONG_TAU_SEC);
    for (let i = 0; i < 12; i++) {
      longEnergy[i] += (p.activePitches[i] - longEnergy[i]) * k;
    }
  }

  const cx = w / 2;
  const cy = h / 2;
  const rOuter = Math.min(w, h) * 0.42;
  const rInner = Math.min(w, h) * 0.12;
  // Breath is macro-paced (phase.slow is a 60 s sinewave). No rms.
  const breath = 1 + (p.slow - 0.5) * 0.04;

  ctx.save();
  ctx.translate(cx, cy);
  // Very slow rotation — one revolution per ~6 minutes. Visible only
  // on long stares; matches the "feel behind the sound" axiom.
  ctx.rotate(p.t * (Math.PI * 2) / 360);

  const halfAngle = (Math.PI / 12) * 0.86;

  // First pass — sector arcs.
  for (let pc = 0; pc < 12; pc++) {
    const e = Math.max(0, Math.min(1, longEnergy[pc]));
    // C at top (-π/2), clockwise around the circle.
    const angle = (pc / 12) * Math.PI * 2 - Math.PI / 2;
    const r0 = rInner * breath;
    const r1 = r0 + (rOuter - rInner) * (0.18 + e * 0.82);

    // Matte graphite → bone crossfade. Fully macro-driven (warmth is
    // a preset macro), never from amplitude.
    const boneMix = warmth * 0.55 + e * 0.3;
    const L = Math.round(18 + boneMix * 55);      // 18..73
    const S = Math.round(4 + warmth * 8);         // 4..12% — desaturated
    const H = Math.round(22 + warmth * 22);       // 22..44 — umber/parchment
    ctx.fillStyle = `hsla(${H}, ${S}%, ${L}%, ${0.55 + e * 0.35})`;
    ctx.beginPath();
    ctx.arc(0, 0, r1, angle - halfAngle, angle + halfAngle);
    ctx.arc(0, 0, r0, angle + halfAngle, angle - halfAngle, true);
    ctx.closePath();
    ctx.fill();

    // Strong outer stroke — silhouette from 20+ m. Only drawn for
    // pitches with real long-term presence.
    if (e > 0.12) {
      ctx.strokeStyle = `hsla(${H}, 6%, ${Math.round(78 + warmth * 14)}%, ${Math.min(1, e * 1.3)})`;
      ctx.lineWidth = 1.2 + e * 2.0;
      ctx.beginPath();
      ctx.arc(0, 0, r1, angle - halfAngle, angle + halfAngle);
      ctx.stroke();
    }
  }

  // Second pass — 12 fixed radial tick marks (clock face), always
  // drawn so the structural frame is legible even when only one pitch
  // is lit. Matte, low contrast.
  ctx.strokeStyle = `hsla(30, 6%, ${Math.round(24 + warmth * 16)}%, 0.55)`;
  ctx.lineWidth = 1;
  for (let pc = 0; pc < 12; pc++) {
    const angle = (pc / 12) * Math.PI * 2 - Math.PI / 2;
    const rA = rOuter * 1.02;
    const rB = rOuter * 1.07;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * rA, Math.sin(angle) * rA);
    ctx.lineTo(Math.cos(angle) * rB, Math.sin(angle) * rB);
    ctx.stroke();
  }

  // Third pass — inner hub. Size pulses with *integrated* total
  // energy only (no RMS), so it breathes on the 30 s integrator's
  // timescale — slow, accruing — not at audio rate.
  let totalE = 0;
  for (let i = 0; i < 12; i++) totalE += longEnergy[i];
  const hubFill = Math.min(1, totalE / 6);
  const hubR = rInner * breath * (0.55 + hubFill * 0.35);
  const hubL = Math.round(26 + warmth * 20 + hubFill * 10);
  ctx.fillStyle = `hsla(30, 6%, ${hubL}%, ${0.7 + hubFill * 0.25})`;
  ctx.beginPath();
  ctx.arc(0, 0, hubR, 0, Math.PI * 2);
  ctx.fill();
  // Hub silhouette ring — high-contrast bone stroke.
  ctx.strokeStyle = `hsla(30, 6%, ${Math.round(82 + warmth * 10)}%, 0.8)`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, hubR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

export const VISUALIZER_FNS: Record<
  Visualizer,
  (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    a: AudioFrame,
    p: PhaseClock,
  ) => void
> = {
  pitchMandala: drawPitchMandala,
};
