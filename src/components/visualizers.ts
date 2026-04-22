/**
 * visualizers.ts — the six Meditate-view visualizers.
 *
 * Each visualizer is a pure drawing function that takes:
 *   ctx    — 2D rendering context
 *   w, h   — canvas width/height in px
 *   audio  — { rms, peak, spectrum } sampled each frame from the master
 *            AnalyserNode (spectrum is a Float32Array normalized 0..1)
 *   phase  — slow clocks that run regardless of audio (so the image
 *            never goes fully static in silence):
 *              phase.t     — wall clock seconds since the view opened
 *              phase.slow  — 0..1 sine drifting once every 60 s
 *              phase.hue   — palette phase (0..360 degrees)
 *
 * Keep per-frame allocations to a minimum — these run in a rAF loop.
 */

import { showNotification } from "../notifications";

export type Visualizer =
  | "mandala"
  | "haloGlow"
  | "fractal"
  | "rothko"
  | "tapeDecay"
  | "dreamHouse"
  | "sigil"
  | "starGate"
  | "cymatics"
  | "inkBloom"
  | "horizon"
  | "aurora"
  | "orb"
  | "dreamMachine"
  | "pitchMandala"
  | "flowField"
  | "waterfall"
  | "feedbackTunnel"
  | "waveformRing"
  | "saltDrift"
  | "ironFilings"
  | "sediment"
  | "erosion"
  | "ashTrail";

/**
 * Visualizer categories — the meditate view dropdown renders these
 * as group headers with the visualizers grouped underneath. Keep a
 * visualizer in exactly one group; VISUALIZER_ORDER is derived by
 * flattening this structure, so don't duplicate.
 */
export const VISUALIZER_GROUPS: readonly {
  label: string;
  items: readonly Visualizer[];
}[] = [
  {
    label: "GEOMETRIC",
    items: [
      "mandala",
      "pitchMandala",
      "flowField",
      "waveformRing",
      "sigil",
      "cymatics",
    ],
  },
  {
    label: "SPECTRAL",
    items: [
      "aurora",
      "waterfall",
      "sediment",
      "erosion",
    ],
  },
  {
    label: "FIELD / PAINTERLY",
    items: [
      "rothko",
      "tapeDecay",
      "dreamHouse",
      "inkBloom",
      "haloGlow",
      "horizon",
      "orb",
      "saltDrift",
      "ironFilings",
      "ashTrail",
    ],
  },
  {
    label: "HYPNOTIC",
    items: [
      "feedbackTunnel",
      "starGate",
      "fractal",
      "dreamMachine",
    ],
  },
];

export const VISUALIZER_ORDER: readonly Visualizer[] =
  VISUALIZER_GROUPS.flatMap((g) => g.items);

export const VISUALIZER_LABELS: Record<Visualizer, string> = {
  mandala: "BREATHING MANDALA",
  pitchMandala: "PITCH MANDALA · 12 sectors",
  flowField: "FLOW FIELD · particle streams",
  waveformRing: "WAVEFORM RING · circular oscilloscope",
  haloGlow: "HALO & RAYS",
  fractal: "JULIA FRACTAL · heavy",
  rothko: "ROTHKO FIELD",
  tapeDecay: "TAPE DECAY",
  dreamHouse: "DREAM HOUSE MAGENTA",
  sigil: "SIGIL BLOOM",
  starGate: "STAR GATE",
  cymatics: "CYMATICS PLATE",
  waterfall: "SPECTRAL WATERFALL",
  feedbackTunnel: "FEEDBACK TUNNEL",
  saltDrift: "SALT DRIFT · particulate accretion",
  ironFilings: "IRON FILINGS · magnetic field",
  sediment: "SEDIMENT STRATA · spectral deposit",
  erosion: "EROSION CONTOURS · spectral relief",
  ashTrail: "ASH TRAIL · per-voice smoke",
  inkBloom: "INK BLOOM",
  horizon: "HORIZON SUNRISE",
  aurora: "SPECTRAL AURORA",
  orb: "RESONANT ORB",
  dreamMachine: "DREAM MACHINE",
};

export interface AudioFrame {
  rms: number;         // 0..1
  peak: number;        // 0..1
  spectrum: Float32Array; // 32 normalized bins, 0..1
  waveform?: Uint8Array;  // raw time-domain data (128 = silence)
}

export interface PhaseClock {
  t: number;     // seconds since mount
  slow: number;  // 0..1 sin drift (1 / 60s)
  hue: number;   // rotating 0..360
  /** Growth factor 0..1 that saturates after ~4 minutes of continuous
   *  viewing. Visualizers use it to add layers / petals / fractal
   *  recursion so the longer you stare the more elaborate the image. */
  growth: number;
  /** Pointer position in normalized canvas coords (0..1, 0..1) when
   *  the user is hovering/dragging on the canvas. null otherwise.
   *  A few visualizers use this for a tiny bit of interactivity. */
  pointer: { x: number; y: number } | null;
  /** Latched down state — true while pointer is pressed on the canvas. */
  pointerDown: boolean;
  /** Mood of the playing drone, derived from engine macros/preset.
   *   hue        — 0..360 base hue the visualizer can tint with
   *   warmth     — 0..1, 0=cold/violet, 1=warm/amber
   *   brightness — 0..1, 0=dark-field, 1=bright-field
   *   density    — 0..1, number of active voice layers / 4
   */
  mood: { hue: number; warmth: number; brightness: number; density: number };
  /** Ground-truth active pitch-class energies, derived from the
   *  engine's current root frequency + interval stack (in cents).
   *  Length 12, each slot = 0..1 for that pitch class (0=C, 1=C#,
   *  …, 11=B). The pitch-mandala visualizer prefers this to the
   *  FFT because the 32-bin reduced spectrum is too coarse to
   *  distinguish pitch classes at drone frequencies. All-zero when
   *  silent or engine isn't available. */
  activePitches: Float32Array;
  /** Frame delta scale — 1.0 at 60 fps, 2.0 at 30 fps, larger when
   *  the tab is throttled. Visualizers whose persistence fades are
   *  per-frame (destination-out wash, alpha overlay) multiply by
   *  this so the fade rate is framerate-independent. Falls back to
   *  1 when the caller didn't populate it. */
  dtScale?: number;
}

// ── Shared colour helpers (ember-leaning but drifting) ─────────────
function embToHsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)},${s}%,${l}%,${a})`;
}

// ─────────────────────────────────────────────────────────────────────
// 1. BREATHING MANDALA — layered lotus bands with filled petals,
//    a bindu center, and thin separator rings. Not a spider-web.
// ─────────────────────────────────────────────────────────────────────
export function drawMandala(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Dark ink persistence so old bands linger a moment
  ctx.fillStyle = "rgba(8, 5, 3, 0.28)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) * 0.46;
  const breath = 1 + a.rms * 0.22 + p.slow * 0.05;

  // Band count grows from 4 → 9 over a few minutes. Each band is a
  // ring of filled lotus petals with its own rotation and palette.
  const bandCount = Math.round(4 + p.growth * 5);

  for (let band = 0; band < bandCount; band++) {
    // Inner / outer radii for this band
    const r0 = maxR * ((band) / bandCount) * breath + maxR * 0.08;
    const r1 = maxR * ((band + 1) / bandCount) * breath + maxR * 0.08;
    const rMid = (r0 + r1) * 0.5;
    const bandThick = r1 - r0;

    // Petal count: 8 / 12 / 16 / 24 pattern, grows with band index
    const PETAL_COUNTS = [8, 12, 16, 12, 24, 16, 32, 24, 16];
    const petals = PETAL_COUNTS[band % PETAL_COUNTS.length];

    // Each band rotates slowly at its own rate — alternating directions
    const dir = band % 2 === 0 ? 1 : -1;
    const rot = p.t * 0.02 * dir * (1 + band * 0.15);

    // Ember palette drifting with hue clock
    const hue = (p.hue + band * 24) % 360;
    const fillColor = `hsla(${hue}, 75%, ${42 - band * 1.5}%, ${0.32 + a.peak * 0.25})`;
    const edgeColor = `hsla(${hue}, 85%, ${68 - band * 2}%, ${0.55 + a.peak * 0.3})`;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // Thin separator ring at the outer edge of this band
    ctx.strokeStyle = `hsla(${hue}, 60%, 75%, 0.22)`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, r1, 0, Math.PI * 2);
    ctx.stroke();

    // Lotus petals — pointed oval shapes drawn with quadratic curves.
    // Each petal arcs outward from r0 to r1, its tip pinched.
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1;
    for (let i = 0; i < petals; i++) {
      const ang = (i / petals) * Math.PI * 2;
      const half = (Math.PI / petals) * 0.82;
      const a0 = ang - half;
      const a1 = ang + half;
      const tipR = r1 * (1 + 0.03 * Math.sin(p.t * 0.08 + band + i * 0.3));
      const baseR = r0;
      // Petal outline: base-left → tip → base-right, with side curves
      const x0 = Math.cos(a0) * baseR;
      const y0 = Math.sin(a0) * baseR;
      const x1 = Math.cos(a1) * baseR;
      const y1 = Math.sin(a1) * baseR;
      const xt = Math.cos(ang) * tipR;
      const yt = Math.sin(ang) * tipR;
      // Side control points bulge the petal
      const cbulge = (baseR + tipR) * 0.55;
      const cxl = Math.cos(ang - half * 0.6) * cbulge;
      const cyl = Math.sin(ang - half * 0.6) * cbulge;
      const cxr = Math.cos(ang + half * 0.6) * cbulge;
      const cyr = Math.sin(ang + half * 0.6) * cbulge;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cxl, cyl, xt, yt);
      ctx.quadraticCurveTo(cxr, cyr, x1, y1);
      // Close along the inner arc
      ctx.arc(0, 0, baseR, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Small dot ring at the mid-radius between petals — a traditional
    // mandala motif that adds texture without clutter.
    if (band < bandCount - 1) {
      ctx.fillStyle = `hsla(${(hue + 30) % 360}, 80%, 80%, ${0.25 + a.peak * 0.2})`;
      const dotCount = petals;
      const dotR = Math.max(1, bandThick * 0.06);
      for (let i = 0; i < dotCount; i++) {
        const ang = (i / dotCount) * Math.PI * 2 + Math.PI / dotCount;
        const dx = Math.cos(ang) * rMid;
        const dy = Math.sin(ang) * rMid;
        ctx.beginPath();
        ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // ── Bindu (central dot + glow) ─────────────────────────────────
  const binduR = maxR * 0.05 * (1 + a.rms * 0.4 + p.slow * 0.1);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, binduR * 3.5);
  glow.addColorStop(0, `hsla(${p.hue}, 90%, 85%, ${0.9 + a.rms * 0.1})`);
  glow.addColorStop(0.4, `hsla(${p.hue}, 85%, 60%, 0.5)`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, binduR * 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Outer frame ring — appears after ~1 min, the mandala's boundary
  if (p.growth > 0.3) {
    ctx.strokeStyle = `hsla(${(p.hue + 60) % 360}, 60%, 70%, ${0.2 * p.growth})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * breath * 1.04, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Accreted complexity — each tier lights up as growth advances ──
  // Radial spokes behind all bands. Count doubles as growth rises,
  // giving the mandala a skeletal sacred-geometry layer over minutes.
  if (p.growth > 0.4) {
    const spokeAlpha = 0.06 + (p.growth - 0.4) * 0.18;
    const spokeCount = 12 + Math.round((p.growth - 0.4) * 36); // 12 → 48
    ctx.strokeStyle = `hsla(${(p.hue + 180) % 360}, 40%, 60%, ${spokeAlpha})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i < spokeCount; i++) {
      const ang = (i / spokeCount) * Math.PI * 2;
      const r0 = maxR * 0.18;
      const r1 = maxR * breath * 0.98;
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    }
    ctx.stroke();
  }

  // Tick-marked halo ring just inside the frame. Count + density
  // scale with growth, like a clock face gaining markers.
  if (p.growth > 0.55) {
    const g = (p.growth - 0.55) / 0.45;
    const tickCount = 36 + Math.round(g * 72); // 36 → 108
    const rh = maxR * breath * 1.09;
    ctx.strokeStyle = `hsla(${(p.hue + 30) % 360}, 70%, 72%, ${0.18 + g * 0.22})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let i = 0; i < tickCount; i++) {
      const ang = (i / tickCount) * Math.PI * 2;
      const r0 = rh - 3;
      const r1 = rh + 3;
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    }
    ctx.stroke();
  }

  // Perimeter dot ring beyond all bands — the mandala's aureole.
  if (p.growth > 0.72) {
    const g = (p.growth - 0.72) / 0.28;
    const dotCount = 48 + Math.round(g * 96); // 48 → 144
    const rp = maxR * breath * 1.16;
    const dr = 0.9 + g * 0.8;
    ctx.fillStyle = `hsla(${(p.hue + 90) % 360}, 70%, 78%, ${0.25 + g * 0.35})`;
    for (let i = 0; i < dotCount; i++) {
      const ang = (i / dotCount) * Math.PI * 2 + p.t * 0.015;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * rp, cy + Math.sin(ang) * rp, dr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Tracery — a fine second frame ring with its own slow counter-rotation
  // appears at deep growth as the final ornament.
  if (p.growth > 0.85) {
    const g = (p.growth - 0.85) / 0.15;
    ctx.strokeStyle = `hsla(${(p.hue + 240) % 360}, 50%, 72%, ${0.14 + g * 0.18})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * breath * 1.22, 0, Math.PI * 2);
    ctx.stroke();
    // Fine cross-hairs across the outer ring, alternating direction
    const crosses = 6 + Math.round(g * 12);
    for (let i = 0; i < crosses; i++) {
      const ang = (i / crosses) * Math.PI * 2 - p.t * 0.01;
      const r0 = maxR * breath * 1.03;
      const r1 = maxR * breath * 1.21;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 2. CYMATICS PLATE — 2D interference of a handful of cosines
// ─────────────────────────────────────────────────────────────────────
// Full-res per-pixel is expensive; instead we render a coarse grid
// and let the canvas smooth it via image scaling.
let cymatCanvas: HTMLCanvasElement | null = null;
let cymatCtx: CanvasRenderingContext2D | null = null;
let cymatData: ImageData | null = null;
const CYMAT_W = 96;
const CYMAT_H = 64;
function ensureCymatBuffer() {
  if (!cymatCanvas) {
    cymatCanvas = document.createElement("canvas");
    cymatCanvas.width = CYMAT_W;
    cymatCanvas.height = CYMAT_H;
    cymatCtx = cymatCanvas.getContext("2d");
    cymatData = cymatCtx!.createImageData(CYMAT_W, CYMAT_H);
  }
}
export function drawCymatics(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  ensureCymatBuffer();
  const data = cymatData!;
  const pix = data.data;

  // Growth increases spatial frequency → finer nodal patterns emerge
  // over time, like a Chladni plate whose tone slowly climbs.
  const freq = 2.2 + a.rms * 2 + p.slow * 0.6 + p.growth * 3;
  const t = p.t;

  for (let y = 0; y < CYMAT_H; y++) {
    for (let x = 0; x < CYMAT_W; x++) {
      const nx = (x / CYMAT_W) * 2 - 1;
      const ny = (y / CYMAT_H) * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      const ang = Math.atan2(ny, nx);
      const v =
        Math.cos(r * freq * 3.1 - t * 0.12) *
        Math.cos(ang * (6 + p.growth * 8) + t * 0.05) +
        Math.cos((nx + ny) * freq * 2.3 + t * 0.07) * 0.6 +
        // Third harmonic interference unfolds with growth
        Math.cos(r * freq * 5.7 + ang * 4 - t * 0.09) * 0.35 * p.growth;
      const mag = Math.abs(v) * (0.4 + a.peak * 0.9);
      const lum = Math.min(255, Math.round(mag * 150));
      const idx = (y * CYMAT_W + x) * 4;
      pix[idx] = lum;
      pix[idx + 1] = lum;
      pix[idx + 2] = lum;
      pix[idx + 3] = 255;
    }
  }
  cymatCtx!.putImageData(data, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cymatCanvas!, 0, 0, w, h);
}

// ─────────────────────────────────────────────────────────────────────
// 3. INK BLOOM — slow drifting ink on a noise field
// ─────────────────────────────────────────────────────────────────────
interface InkBlob { x: number; y: number; r: number; vx: number; vy: number; h: number; life: number; }
let inkBlobs: InkBlob[] = [];
let lastInkRms = 0;
export function drawInkBloom(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Fade the previous frame to give the impression of drifting ink
  ctx.fillStyle = "rgba(8, 5, 3, 0.06)";
  ctx.fillRect(0, 0, w, h);

  // Spawn a new blob on peaks, or occasionally on time
  if (a.peak > 0.4 && a.peak - lastInkRms > 0.06) {
    inkBlobs.push({
      x: w * (0.2 + Math.random() * 0.6),
      y: h * (0.2 + Math.random() * 0.6),
      r: 10 + Math.random() * 40,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      h: (p.hue + Math.random() * 40) % 360,
      life: 0,
    });
    const capacity = 24 + Math.round(p.growth * 40);
    if (inkBlobs.length > capacity) inkBlobs.shift();
  }
  lastInkRms = a.peak;
  // Idle spawn — rate climbs with growth so the field densifies slowly
  if (Math.random() < 0.003 + p.growth * 0.009) {
    inkBlobs.push({
      x: w * Math.random(),
      y: h * Math.random(),
      r: 15 + Math.random() * 30,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      h: (p.hue + 60 + Math.random() * 60) % 360,
      life: 0,
    });
    const capacity = 24 + Math.round(p.growth * 40);
    if (inkBlobs.length > capacity) inkBlobs.shift();
  }

  for (const b of inkBlobs) {
    b.life += 0.016;
    // Slow drift pushed by a low-freq "current"
    const curx = Math.cos(p.t * 0.05 + b.y * 0.002) * 0.3;
    const cury = Math.sin(p.t * 0.04 + b.x * 0.002) * 0.3;
    b.x += b.vx + curx;
    b.y += b.vy + cury;
    b.r += 0.15 + a.rms * 0.3;
    const alpha = Math.max(0, 0.35 - b.life * 0.02) * (0.3 + a.rms);
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, embToHsl(b.h, 80, 55, alpha));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
  }
  inkBlobs = inkBlobs.filter((b) => b.life < 30);
}

// ─────────────────────────────────────────────────────────────────────
// 4. HORIZON SUNRISE — gradient horizon line rising with breath
// ─────────────────────────────────────────────────────────────────────
export function drawHorizon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Sky gradient
  const skyTop = `hsl(${(p.hue + 200) % 360}, 40%, ${8 + p.slow * 4}%)`;
  const skyMid = `hsl(${(p.hue + 25) % 360}, 60%, ${18 + a.rms * 8}%)`;
  const skyBot = `hsl(${(p.hue + 10) % 360}, 75%, ${28 + a.rms * 14}%)`;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(0.55, skyMid);
  sky.addColorStop(1, skyBot);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Sun — radius responds to rms + slow clock. The old horizon line
  // and heat-haze shimmer rows have been removed; the visualizer is
  // now a single suspended sun breathing on the sky gradient.
  const sunY = h * (0.58 - p.slow * 0.06);
  const sunR = Math.min(w, h) * (0.12 + a.rms * 0.08 + p.slow * 0.02);
  const sunX = w * 0.5;
  const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2.4);
  sunGrad.addColorStop(0, `hsla(${(p.hue + 20) % 360}, 95%, 75%, 0.95)`);
  sunGrad.addColorStop(0.4, `hsla(${(p.hue + 10) % 360}, 85%, 55%, 0.55)`);
  sunGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sunGrad;
  ctx.fillRect(0, 0, w, h);
}

// ─────────────────────────────────────────────────────────────────────
// 5. SPECTRAL AURORA — FFT bars bent into curtains
// ─────────────────────────────────────────────────────────────────────
export function drawAurora(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(5, 3, 6, 0.2)";
  ctx.fillRect(0, 0, w, h);

  // Bands used — starts with 16 and rises to all 32 with growth so
  // the curtain gets more detailed the longer you watch.
  const bands = Math.min(a.spectrum.length, 16 + Math.round(p.growth * 16));
  for (let b = 0; b < bands; b++) {
    const energy = a.spectrum[b];
    const hue = (p.hue + b * (360 / bands) + p.t * 0.8) % 360;
    ctx.strokeStyle = embToHsl(hue, 80, 40 + energy * 50, 0.06 + energy * 0.3);
    ctx.lineWidth = 1 + energy * 3;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const phaseX = x * 0.01 + p.t * 0.035 + b * 0.2;
      const y =
        h * 0.5 +
        Math.sin(phaseX) * (h * 0.2) +
        Math.sin(phaseX * 2.1 + p.slow * 6) * (h * 0.1) * energy +
        (b - bands / 2) * (6 + a.rms * 2);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────────────────
// 6. RESONANT ORB — glowing sphere with halo rings
// ─────────────────────────────────────────────────────────────────────
export function drawOrb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(4, 2, 2, 0.22)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const baseR = Math.min(w, h) * 0.18;
  const r = baseR * (1 + a.rms * 0.8 + p.slow * 0.1);

  // Core orb gradient
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  core.addColorStop(0, `hsla(${(p.hue + 20) % 360}, 90%, 75%, 0.9)`);
  core.addColorStop(0.5, `hsla(${(p.hue + 10) % 360}, 85%, 55%, 0.6)`);
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Halos — count from spectrum bands with energy above a threshold,
  // plus a baseline that grows with time so the orb accretes rings.
  const baseHalos = Math.min(6, a.spectrum.filter((v) => v > 0.12).length);
  const halos = Math.min(14, baseHalos + Math.round(p.growth * 8));
  for (let i = 0; i < halos; i++) {
    const rr = r * (1.4 + i * 0.22 + a.peak * 0.1);
    const ang = p.t * (0.018 + i * 0.004) + i;
    ctx.strokeStyle = `hsla(${(p.hue + i * 18) % 360}, 80%, 70%, ${0.22 - i * 0.03})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let s = 0; s <= 64; s++) {
      const t = (s / 64) * Math.PI * 2 + ang;
      const wobble = 1 + Math.sin(t * 5 + p.t * 0.08) * 0.04 * (0.5 + a.peak);
      const x = cx + Math.cos(t) * rr * wobble;
      const y = cy + Math.sin(t) * rr * wobble * 0.85;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────────────────
// 7. DREAM MACHINE — Brion Gysin / Burroughs style stroboscopic
//    flicker at ~10 Hz (alpha-wave band). A rotating slot overlay
//    on top of a breathing colour field. Close your eyes and the
//    flicker induces closed-eye hallucinations.
//
//    WARNING: persistent strobe can trigger seizures for people with
//    photosensitive epilepsy. The MeditateView shows a warning the
//    first time this visualizer is selected.
// ─────────────────────────────────────────────────────────────────────
export function drawDreamMachine(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Flicker rate — 10 Hz nominal, nudged ±1 Hz by the slow phase
  // so the brain doesn't lock to a single frequency. Also bent a
  // little by the drone RMS so loud passages feel more insistent.
  const baseHz = 10 + Math.sin(p.t * 0.07) * 1.2 + a.rms * 1.5;
  // Square wave: on for half the cycle, off for the other half.
  const cyclePos = (p.t * baseHz) % 1;
  const bright = cyclePos < 0.5;

  // Background colour cycles slowly through warm hues
  const bgHue = (p.hue + 15) % 360;
  const bgLight = bright ? 55 + a.peak * 20 : 3;
  const bgSat = 75;
  ctx.fillStyle = `hsl(${bgHue}, ${bgSat}%, ${bgLight}%)`;
  ctx.fillRect(0, 0, w, h);

  // Rotating slot overlay — evokes the slits of Gysin's cylinder
  // spinning at ~78 rpm (≈1.3 Hz). We draw 12 radial slots and
  // rotate them slowly on top. On dark phases they become the
  // bright slits; on bright phases they become shadows.
  const cx = w / 2;
  const cy = h / 2;
  const slotR = Math.hypot(cx, cy) * 1.1;
  const slots = 12;
  const rot = p.t * 1.3 * Math.PI * 2 / 60; // 1.3 Hz → rad/s
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  // Slot fill is the inverse phase of the background
  ctx.fillStyle = bright
    ? `hsla(${(bgHue + 180) % 360}, 70%, 6%, 0.75)`
    : `hsla(${bgHue}, 90%, ${60 + a.peak * 25}%, 0.85)`;
  for (let i = 0; i < slots; i++) {
    const a0 = (i / slots) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / (slots * 2.2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, slotR, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Soft vignette so the flicker feels framed rather than harsh
  const vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.2, cx, cy, Math.max(w, h) * 0.7);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// ─────────────────────────────────────────────────────────────────────
// 8. JULIA FRACTAL — a slowly morphing Julia set. The seed `c`
//    describes a tiny orbit in the complex plane, so the fractal
//    shape continuously breathes. Rendered on a small offscreen
//    buffer (resolution grows with growth) and stretched to the
//    canvas — CPU-heavy but glorious. Opt-in heavy visualizer.
// ─────────────────────────────────────────────────────────────────────
let juliaCanvas: HTMLCanvasElement | null = null;
let juliaCtx: CanvasRenderingContext2D | null = null;
let juliaData: ImageData | null = null;
let juliaW = 0;
let juliaH = 0;
function ensureJulia(bw: number, bh: number) {
  if (!juliaCanvas || juliaW !== bw || juliaH !== bh) {
    juliaCanvas = document.createElement("canvas");
    juliaCanvas.width = bw;
    juliaCanvas.height = bh;
    juliaCtx = juliaCanvas.getContext("2d");
    juliaData = juliaCtx!.createImageData(bw, bh);
    juliaW = bw;
    juliaH = bh;
  }
}
export function drawFractal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Resolution grows with growth — start cheap, get lush.
  const bw = Math.round(160 + p.growth * 160);
  const bh = Math.round(100 + p.growth * 100);
  ensureJulia(bw, bh);
  const pix = juliaData!.data;
  const maxIter = Math.round(28 + p.growth * 50 + a.rms * 20);

  // Sum spectral energy into three bands — each deforms a different
  // dimension of the Julia parameter / transform so the fractal
  // *reacts* rather than just drifting. Low = cr nudge, high = ci
  // nudge, mid = zoom pulse, all-over RMS = rotation speed.
  const bins = a.spectrum.length;
  let lowE = 0, midE = 0, highE = 0;
  const thirdA = Math.floor(bins / 3);
  const thirdB = Math.floor((bins * 2) / 3);
  for (let i = 0; i < thirdA; i++) lowE += a.spectrum[i];
  for (let i = thirdA; i < thirdB; i++) midE += a.spectrum[i];
  for (let i = thirdB; i < bins; i++) highE += a.spectrum[i];
  lowE /= Math.max(1, thirdA);
  midE /= Math.max(1, thirdB - thirdA);
  highE /= Math.max(1, bins - thirdB);

  // Julia c — slow Lissajous orbit pushed by spectral balance. Rich
  // spectra push the parameter toward the rim of the Mandelbrot set
  // where the shape changes dramatically; a pure tonic sits quietly
  // near the classic 0.7885 radius.
  const cr = 0.7885 * Math.cos(p.t * 0.02) + (lowE - 0.15) * 0.22;
  const ci = 0.7885 * Math.sin(p.t * 0.017 + p.slow * 0.5) + (highE - 0.15) * 0.22;

  // Zoom pulses with mid-band energy + breath + overall RMS.
  const zoom = 1.3 + p.slow * 0.15 + a.rms * 0.35 + midE * 0.6;
  // Rotation speed scales with RMS so loud moments spin a bit faster.
  const rot = p.t * (0.01 + a.rms * 0.04) * (0.3 + p.growth * 0.7);
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  // Indigo / violet / amber palette, different from the ember theme
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const zx0 = (x / bw - 0.5) * 3.2 / zoom;
      const zy0 = (y / bh - 0.5) * 2.0 / zoom;
      // Rotate (zx0,zy0)
      const zxr = zx0 * cosR - zy0 * sinR;
      const zyr = zx0 * sinR + zy0 * cosR;
      let zx = zxr;
      let zy = zyr;
      let it = 0;
      while (zx * zx + zy * zy < 4 && it < maxIter) {
        const nx = zx * zx - zy * zy + cr;
        zy = 2 * zx * zy + ci;
        zx = nx;
        it++;
      }
      const idx = (y * bw + x) * 4;
      if (it === maxIter) {
        pix[idx] = 4;
        pix[idx + 1] = 2;
        pix[idx + 2] = 10;
      } else {
        // Smooth colouring
        const modsq = zx * zx + zy * zy;
        const mu = it + 1 - Math.log(Math.log(modsq) * 0.5) / Math.LN2;
        const n = mu / maxIter;
        // Indigo → violet → amber palette
        const hue = (260 + n * 140 + p.t * 8) % 360;
        const ll = Math.min(75, 10 + n * 90);
        // HSL to RGB
        const sat = 80;
        const L = ll / 100;
        const c = (1 - Math.abs(2 * L - 1)) * (sat / 100);
        const hp = hue / 60;
        const xc = c * (1 - Math.abs((hp % 2) - 1));
        let r1 = 0, g1 = 0, b1 = 0;
        if (hp < 1) { r1 = c; g1 = xc; }
        else if (hp < 2) { r1 = xc; g1 = c; }
        else if (hp < 3) { g1 = c; b1 = xc; }
        else if (hp < 4) { g1 = xc; b1 = c; }
        else if (hp < 5) { r1 = xc; b1 = c; }
        else { r1 = c; b1 = xc; }
        const m = L - c / 2;
        pix[idx] = Math.round((r1 + m) * 255);
        pix[idx + 1] = Math.round((g1 + m) * 255);
        pix[idx + 2] = Math.round((b1 + m) * 255);
      }
      pix[idx + 3] = 255;
    }
  }
  juliaCtx!.putImageData(juliaData!, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(juliaCanvas!, 0, 0, w, h);
}

// ─────────────────────────────────────────────────────────────────────
// 9. ROTHKO FIELD — soft color blocks stacked like a Rothko canvas.
//    Long-duration piece in the Radigue tradition: audio barely
//    visible; time and palette drift are the composition.
// ─────────────────────────────────────────────────────────────────────
export function drawRothko(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Deep maroon / rust / ochre palette — pure Rothko Seagram.
  const hueA = (350 + Math.sin(p.t * 0.01) * 20) % 360;     // blood
  const hueB = (15 + Math.sin(p.t * 0.008) * 18) % 360;     // rust
  const hueC = (38 + Math.sin(p.t * 0.012) * 12) % 360;     // ochre

  // Background canvas → a near-black maroon
  ctx.fillStyle = `hsl(${hueA}, 55%, ${6 + a.rms * 4}%)`;
  ctx.fillRect(0, 0, w, h);

  const blockH = h * 0.32;
  const blockW = w * 0.72;
  const x0 = (w - blockW) / 2;

  // Top block — wider, taller, soft edges via a radial tint
  drawRothkoBlock(ctx, x0, h * 0.08 + p.slow * 6, blockW, blockH * 1.05, hueB, 55, 34, a, p);
  // Middle thin break
  // Bottom block — deeper rust
  drawRothkoBlock(ctx, x0, h * 0.56 + p.slow * 4, blockW, blockH * 0.95, hueC, 60, 38, a, p);

  // Very slow vertical noise-less scan line to break the flatness
  const scanY = h * 0.5 + Math.sin(p.t * 0.12) * h * 0.04;
  ctx.strokeStyle = `hsla(${hueB}, 40%, 50%, 0.08)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, scanY);
  ctx.lineTo(x0 + blockW, scanY);
  ctx.stroke();
}
function drawRothkoBlock(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, bw: number, bh: number,
  hue: number, sat: number, lig: number,
  a: AudioFrame, p: PhaseClock,
) {
  // Subtle vibration of the block edges, driven by peak + a low-
  // frequency sine so the colour fields feel "alive" the way a
  // Rothko canvas does in a dim room.
  // Vibration — slow and subtle. Frequencies are intentionally well
  // below 2 Hz so the canvas breathes instead of shivers.
  const vibAmp = 1.2 + a.peak * 3 + p.slow * 1.5;
  const vibX = Math.sin(p.t * 1.1) * vibAmp + Math.sin(p.t * 0.45) * vibAmp * 0.6;
  const vibY = Math.cos(p.t * 0.9) * vibAmp * 0.7;

  const xv = x + vibX;
  const yv = y + vibY;

  // Soft blurred edge via stacked opaque rectangles with easing alphas.
  const steps = 8;
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    const pad = t * Math.min(bw, bh) * 0.12;
    const alpha = (1 - t) * 0.18;
    // Each halo ring gets its own tiny jitter so the edge ripples
    const jx = Math.sin(p.t * 1.3 + s) * 0.6;
    const jy = Math.cos(p.t * 1.1 + s) * 0.6;
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lig + (1 - t) * 10}%, ${alpha + a.rms * 0.05})`;
    ctx.fillRect(xv + pad + jx, yv + pad + jy, bw - pad * 2, bh - pad * 2);
  }
  // Final solid core with a tiny horizontal scan offset that wobbles
  ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lig}%, 0.9)`;
  const pc = Math.min(bw, bh) * 0.08;
  ctx.fillRect(xv + pc, yv + pc, bw - pc * 2, bh - pc * 2);
}

// ─────────────────────────────────────────────────────────────────────
// 10. TAPE DECAY — a horizontal band of magnetic tape scrolling
//     right-to-left, slowly rotting with per-pixel dropouts. Persists
//     across session reloads: the decay pattern is serialized to
//     localStorage every few seconds, so the tape keeps eroding
//     between sessions — Basinski-style disintegration loops.
// ─────────────────────────────────────────────────────────────────────
let tapeCanvas: HTMLCanvasElement | null = null;
let tapeCtx: CanvasRenderingContext2D | null = null;
const TAPE_W = 900;    // length of the physical loop
const TAPE_H = 80;
const TAPE_STORAGE_KEY = "mdrone.meditate.tapeDecay";
let tapeLastSave = 0;
let tapePersistDisabled = false;
let tapeOffset = 0;     // scroll position (px)
let tapeLoopIndex = 0;  // which playback pass we're on
let tapeLastT = 0;      // p.t at the previous frame — drives scroll via
                        // active-time delta so the loop advances only
                        // while the drone is audible and is framerate-
                        // independent (MeditateView caps at 30 fps).
function paintBaseTape() {
  const t = tapeCtx!;
  const grad = t.createLinearGradient(0, 0, 0, TAPE_H);
  grad.addColorStop(0, "#2a1404");
  grad.addColorStop(0.5, "#4a2408");
  grad.addColorStop(1, "#2a1404");
  t.fillStyle = grad;
  t.fillRect(0, 0, TAPE_W, TAPE_H);
  // Add warm modulated brightness along the tape — simulates
  // the magnetic signal variation along the strip.
  for (let x = 0; x < TAPE_W; x++) {
    const lum = 40 + Math.sin(x * 0.02) * 20 + Math.sin(x * 0.08 + 2) * 15;
    t.fillStyle = `rgba(${180 + lum}, ${80 + lum * 0.5}, ${30 + lum * 0.2}, 0.5)`;
    t.fillRect(x, TAPE_H * 0.15, 1, TAPE_H * 0.7);
  }
  // Sprocket holes / splice lines
  t.fillStyle = "rgba(20,10,4,0.5)";
  for (let i = 0; i < 8; i++) {
    const sx = (i / 8) * TAPE_W + Math.random() * 40;
    t.fillRect(sx, 0, 1, TAPE_H);
  }
}
function ensureTape(): void {
  if (tapeCanvas) return;
  tapeCanvas = document.createElement("canvas");
  tapeCanvas.width = TAPE_W;
  tapeCanvas.height = TAPE_H;
  tapeCtx = tapeCanvas.getContext("2d");
  // Always paint a fresh base first so we have something visible
  // before/without a saved state.
  paintBaseTape();
  // Try to restore the eroded loop from storage, but validate that
  // the restored image isn't mostly black. A tape that was left
  // degrading for a very long time can save as "all black" which
  // isn't a useful resume state — just repaint fresh.
  try {
    const raw = localStorage.getItem(TAPE_STORAGE_KEY);
    if (raw) {
      const img = new Image();
      img.onload = () => {
        tapeCtx!.drawImage(img, 0, 0);
        const sample = tapeCtx!.getImageData(0, 0, TAPE_W, TAPE_H).data;
        let lum = 0;
        for (let i = 0; i < sample.length; i += 4) {
          lum += sample[i] + sample[i + 1] + sample[i + 2];
        }
        const avg = lum / (sample.length / 4) / 3;
        // Reset freshness threshold — catches tapes that are flat
        // (no dynamic variation) even if not pitch-black. Avg ≤ 42
        // roughly corresponds to "uniformly dark brown smear with
        // no contrast left".
        if (avg < 42) {
          localStorage.removeItem(TAPE_STORAGE_KEY);
          paintBaseTape();
          tapeLoopIndex = 0;
        }
      };
      img.onerror = () => { paintBaseTape(); };
      img.src = raw;
    }
  } catch { /* ok */ }
}
function decayLoop(peak: number, growth: number): void {
  // Each time the loop wraps we scar the tape in a few places.
  // Gentle by default — a few short semi-opaque slashes — so the
  // tape stays visible for many loop passes instead of going black.
  const t = tapeCtx!;
  const scars = 1 + Math.round(growth * 2 + peak * 1.5);
  for (let i = 0; i < scars; i++) {
    const x = Math.random() * TAPE_W;
    const thickness = 1 + Math.random() * 2;
    const yOff = (Math.random() - 0.5) * TAPE_H * 0.3;
    const yh = TAPE_H * (0.4 + Math.random() * 0.4);
    t.fillStyle = "rgba(0,0,0,0.55)";
    t.fillRect(x, TAPE_H / 2 - yh / 2 + yOff, thickness, yh);
  }
  // Occasional thin horizontal streak (rare, semi-transparent)
  if (Math.random() < 0.08 + growth * 0.12) {
    const y = Math.random() * TAPE_H;
    t.fillStyle = "rgba(0,0,0,0.45)";
    t.fillRect(0, y, TAPE_W, 1);
  }
}
export function drawTapeDecay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  ensureTape();

  // Background — deep ferric brown
  ctx.fillStyle = "#0a0604";
  ctx.fillRect(0, 0, w, h);

  // Advance the loop in active time — 40 px/s base, modulated a
  // little by RMS. p.t only ticks while the drone is audible, so the
  // tape freezes during silence and resumes exactly where it left
  // off. Delta is clamped to avoid a huge jump on first frame or
  // after a long tab pause.
  const scrollSpeed = 40 + a.rms * 20;
  const dt = Math.max(0, Math.min(0.2, p.t - tapeLastT));
  tapeLastT = p.t;
  tapeOffset += scrollSpeed * dt;
  while (tapeOffset >= TAPE_W) {
    tapeOffset -= TAPE_W;
    tapeLoopIndex += 1;
    // On every loop wrap, introduce new permanent scars
    decayLoop(a.peak, p.growth);
  }

  // Render the tape centered, wrapping the loop across the view
  const bandH = h * 0.55;
  const bandY = (h - bandH) / 2;
  const tileW = w * (TAPE_W / TAPE_W); // full width
  ctx.imageSmoothingEnabled = true;
  // Draw two copies side by side so the loop wraps seamlessly
  ctx.drawImage(tapeCanvas!, -tapeOffset, bandY, tileW, bandH);
  ctx.drawImage(tapeCanvas!, -tapeOffset + tileW, bandY, tileW, bandH);

  // Soft vignette edges so the band fades to black at the sides
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.7)");
  grad.addColorStop(0.1, "rgba(0,0,0,0)");
  grad.addColorStop(0.9, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, bandY, w, bandH);

  // Persist every 6 s so Basinski-style resume works
  if (!tapePersistDisabled && p.t * 1000 - tapeLastSave > 6000) {
    tapeLastSave = p.t * 1000;
    try {
      localStorage.setItem(TAPE_STORAGE_KEY, tapeCanvas!.toDataURL("image/png"));
    } catch (e) {
      // Quota exceeded — drop the stored tape and stop retrying so
      // we don't spam the user every 6 s. A fresh tape picks up next
      // visit. Any other error is silent.
      const name = (e as { name?: string })?.name ?? "";
      if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
        tapePersistDisabled = true;
        try { localStorage.removeItem(TAPE_STORAGE_KEY); } catch { /* ok */ }
        showNotification(
          "Tape loop too large to save — it will reset next session.",
          "info",
        );
      }
    }
  }

  // Subtitle with pass counter
  ctx.fillStyle = "rgba(200,140,60,0.28)";
  ctx.font = '10px "ui-monospace", monospace';
  ctx.fillText(`TAPE · LOOP PASS ${tapeLoopIndex}`, 16, h - 16);
}

// ─────────────────────────────────────────────────────────────────────
// 11. DREAM HOUSE MAGENTA — full-screen magenta flood with slow-
//     drifting organic silhouettes, evoking the La Monte Young /
//     Marian Zazeela Dream House installation. Fullscreen this.
// ─────────────────────────────────────────────────────────────────────
interface DhShape { cx: number; cy: number; r: number; vx: number; vy: number; rot: number; }
let dhShapes: DhShape[] | null = null;
function ensureDh(w: number, h: number): DhShape[] {
  if (!dhShapes || dhShapes.length === 0) {
    dhShapes = [];
    for (let i = 0; i < 6; i++) {
      dhShapes.push({
        cx: Math.random() * w,
        cy: Math.random() * h,
        r: 80 + Math.random() * 160,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.06,
        rot: Math.random() * Math.PI * 2,
      });
    }
  }
  return dhShapes;
}
export function drawDreamHouse(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // The magenta field itself breathes through the Dream House palette:
  //   magenta → ultraviolet → deep red → back
  const baseHue = 300 + Math.sin(p.t * 0.015) * 40; // 260–340
  const sat = 85 + Math.sin(p.t * 0.02) * 10;
  const lig = 32 + a.rms * 8 + p.slow * 4;
  ctx.fillStyle = `hsl(${baseHue}, ${sat}%, ${lig}%)`;
  ctx.fillRect(0, 0, w, h);

  const shapes = ensureDh(w, h);
  // Wrap-around drift
  for (const s of shapes) {
    s.cx += s.vx + Math.cos(p.t * 0.05 + s.rot) * 0.1;
    s.cy += s.vy + Math.sin(p.t * 0.04 + s.rot) * 0.08;
    if (s.cx < -s.r) s.cx = w + s.r;
    if (s.cx > w + s.r) s.cx = -s.r;
    if (s.cy < -s.r) s.cy = h + s.r;
    if (s.cy > h + s.r) s.cy = -s.r;

    // Silhouette color — slightly darker/violet than the field
    const g = ctx.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, s.r * (1 + a.rms * 0.15));
    g.addColorStop(0, `hsla(${(baseHue - 25) % 360}, 90%, 16%, 0.55)`);
    g.addColorStop(0.7, `hsla(${(baseHue - 15) % 360}, 80%, 22%, 0.28)`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, s.r * (1 + a.rms * 0.15), 0, Math.PI * 2);
    ctx.fill();
  }

  // Pointer interactivity — tiny bright spot follows the pointer
  if (p.pointer) {
    const px = p.pointer.x * w;
    const py = p.pointer.y * h;
    const r = 80 + (p.pointerDown ? 60 : 0);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `hsla(${(baseHue + 60) % 360}, 100%, 75%, 0.6)`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Extra shapes fade in with growth for slow build
  if (p.growth > 0.3 && shapes.length < 12) {
    shapes.push({
      cx: Math.random() * w,
      cy: Math.random() * h,
      r: 60 + Math.random() * 120,
      vx: (Math.random() - 0.5) * 0.07,
      vy: (Math.random() - 0.5) * 0.05,
      rot: Math.random() * Math.PI * 2,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// 12. SIGIL BLOOM — continuous-line ritual sigils drawn slowly from
//     the center outward. Each sigil is generated from a seed (the
//     current time). Old sigils fade to ghost as new ones replace
//     them. Coil-style ritual-visual field.
// ─────────────────────────────────────────────────────────────────────
interface SigilPoint { x: number; y: number; }
let sigilPoints: SigilPoint[] | null = null;
let sigilDrawn = 0;
let sigilSeed = 0;
let sigilBirth = 0;
/** External trigger — Layout calls this on RANDOM scene so the
 *  sigil visualizer always starts a fresh glyph for the new scene. */
export function requestSigilRefresh(): void {
  sigilPoints = null;
  sigilDrawn = 0;
  sigilBirth = -1e9;
}
function makeSigil(cx: number, cy: number, radius: number, seed: number): SigilPoint[] {
  // Deterministic pseudo-random from seed — Mulberry32-style
  let s = (seed * 2654435761) | 0;
  const rand = () => {
    s = (s + 1831565813) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Austin Osman Spare sigils are single continuous lines that weave
  // through a set of node points, with looping knots where the line
  // crosses itself, terminal flourishes, and occasional arcs bending
  // back on themselves. Here: 8–14 nodes, each visited in a non-
  // linear order, each segment either straight-ish or a small loop,
  // with a few knot-crossings forced in.
  const nodeCount = 8 + Math.floor(rand() * 7);
  const nodes: SigilPoint[] = [];
  for (let i = 0; i < nodeCount; i++) {
    // Spread nodes in a rough circle but jittered so they feel
    // asymmetric like AOS glyphs.
    const ang = (i / nodeCount) * Math.PI * 2 + (rand() - 0.5) * 0.8;
    const r = radius * (0.35 + rand() * 0.55);
    nodes.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
  }

  // Traversal order — a random permutation of the nodes, then back
  // to the start. Sometimes revisit a node to force a knot.
  const order: number[] = [];
  const indices = nodes.map((_, i) => i);
  while (indices.length) {
    const k = Math.floor(rand() * indices.length);
    order.push(indices.splice(k, 1)[0]);
  }
  order.push(order[0]);
  // Inject 1–2 revisits (knot crossings)
  const knots = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < knots; i++) {
    const pos = 2 + Math.floor(rand() * (order.length - 3));
    const rev = Math.floor(rand() * nodeCount);
    order.splice(pos, 0, rev);
  }

  const path: SigilPoint[] = [];
  const pushArc = (p0: SigilPoint, p1: SigilPoint, curl: number, steps: number) => {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    // Perpendicular for arc control point
    const mx = (p0.x + p1.x) / 2 + (-dy) * curl;
    const my = (p0.y + p1.y) / 2 + (dx) * curl;
    for (let s2 = 0; s2 < steps; s2++) {
      const t = s2 / steps;
      const u = 1 - t;
      const x = u * u * p0.x + 2 * u * t * mx + t * t * p1.x;
      const y = u * u * p0.y + 2 * u * t * my + t * t * p1.y;
      path.push({ x, y });
    }
  };
  const pushLoop = (pt: SigilPoint, r: number, dir: number) => {
    // Small circular terminal loop — the trademark AOS "eye"
    const loopSteps = 40;
    // Start the loop from the current pen position so it attaches
    const startAng = rand() * Math.PI * 2;
    for (let s2 = 0; s2 < loopSteps; s2++) {
      const t = s2 / loopSteps;
      const ang = startAng + t * Math.PI * 2 * dir;
      path.push({ x: pt.x + Math.cos(ang) * r, y: pt.y + Math.sin(ang) * r });
    }
  };

  for (let i = 0; i < order.length - 1; i++) {
    const p0 = nodes[order[i]];
    const p1 = nodes[order[i + 1]];
    const curl = (rand() - 0.5) * 0.6;
    pushArc(p0, p1, curl, 90);
    // Occasional loop at the intermediate node
    if (rand() < 0.25) {
      pushLoop(p1, radius * 0.05 * (0.5 + rand()), rand() < 0.5 ? 1 : -1);
    }
  }

  // Terminal flourish: a small loop around the end node
  const last = nodes[order[order.length - 1]];
  pushLoop(last, radius * 0.06, 1);
  return path;
}
export function drawSigilBloom(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Fade the previous frame so old sigils ghost out
  ctx.fillStyle = "rgba(6, 4, 8, 0.04)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.35;

  // Draw takes 3 minutes, new sigil every 5 minutes. Pointer
  // press after the drawing has finished forces a new one.
  const SIGIL_PEN_SECONDS = 180;  // 3 min to fully draw
  const SIGIL_DURATION = 300;     // 5 min before refresh
  const age = p.t - sigilBirth;
  if (!sigilPoints || age > SIGIL_DURATION || (p.pointerDown && age > SIGIL_PEN_SECONDS + 5)) {
    sigilSeed = Math.floor(p.t * 1000 + Math.random() * 100000);
    sigilPoints = makeSigil(cx, cy, radius, sigilSeed);
    sigilDrawn = 0;
    sigilBirth = p.t;
  }

  const penSpeed = (sigilPoints!.length / SIGIL_PEN_SECONDS) / 60; // pts/frame at 60 fps
  sigilDrawn = Math.min(sigilPoints!.length, sigilDrawn + penSpeed * (1 + a.rms * 0.4));

  // Audio-reactive uniform pulse — the sigil sits flat on the plane
  // and breathes with RMS + a slow sinus underlay. A small peak-
  // driven jitter gives it an extra shimmer on transients. The old
  // fake 3D "spinning coin" rotation (abs(cos(t)) scaleX + edgeDim
  // fade) looked broken because it flipped through a zero-width
  // sliver every 10 s; removed entirely.
  const pulse = 1 + 0.04 * Math.sin(p.t * 0.9) + a.rms * 0.18 + a.peak * 0.04;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pulse, pulse);
  ctx.translate(-cx, -cy);

  // Deep sigil ink — red ochre bleeding on dark
  const hue = 10 + Math.sin(p.t * 0.1) * 10;
  ctx.strokeStyle = `hsla(${hue}, 85%, 55%, ${0.75 + a.peak * 0.2})`;
  ctx.lineWidth = 1.8 + a.peak * 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const drawn = Math.floor(sigilDrawn);
  for (let i = 0; i < drawn; i++) {
    const pt = sigilPoints![i];
    if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();

  // Glow layer — redraw with larger, more transparent stroke
  ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${0.18 + a.rms * 0.1})`;
  ctx.lineWidth = 5 + a.peak * 4;
  ctx.beginPath();
  for (let i = 0; i < drawn; i++) {
    const pt = sigilPoints![i];
    if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();

  // Bindu nodes at the original points (show faintly)
  if (sigilPoints) {
    ctx.fillStyle = `hsla(${hue + 30}, 90%, 70%, 0.6)`;
    const n = Math.min(8, Math.floor(drawn / 160));
    for (let i = 0; i < n; i++) {
      const pt = sigilPoints[i * 160];
      if (!pt) continue;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────
// 13. STAR GATE — Coil Time Machines / 2001 monolith. A central
//     vertical slit of white light, radial rays bending around it,
//     particles streaming sideways through the slit.
// ─────────────────────────────────────────────────────────────────────
interface GateParticle { x: number; y: number; vx: number; r: number; h: number; }
let gateParticles: GateParticle[] | null = null;
export function drawStarGate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(2, 3, 10, 0.22)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  // Star Gate acceleration: starts barely moving, ramps over ~3
  // minutes to "full warp". Squared ease makes the early seconds
  // feel almost static and the climb convincing.
  const accel = Math.min(1, Math.pow(p.t / 180, 1.8));
  // Radial light rays emanating from the slit — rotate very slowly
  // at first, speed up with the acceleration.
  const rayCount = 40;
  const rot = p.t * (0.002 + accel * 0.08);
  for (let i = 0; i < rayCount; i++) {
    const ang = (i / rayCount) * Math.PI * 2 + rot;
    const warp = Math.sin(ang * 3 + p.t * 0.15) * p.growth * 0.25;
    const len = Math.hypot(w, h) * (0.6 + p.growth * 0.4);
    const x1 = cx + Math.cos(ang + warp) * len;
    const y1 = cy + Math.sin(ang + warp) * len;
    const grad = ctx.createLinearGradient(cx, cy, x1, y1);
    grad.addColorStop(0, `hsla(${205 + i * 2}, 90%, 85%, ${0.18 + a.rms * 0.25})`);
    grad.addColorStop(0.4, `hsla(${220 + i * 3}, 85%, 65%, ${0.1 + a.rms * 0.2})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Particle stream — initialised lazily
  if (!gateParticles) {
    gateParticles = [];
    for (let i = 0; i < 240; i++) {
      gateParticles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: 0,
        r: 0.5 + Math.random() * 1.6,
        h: 200 + Math.random() * 60,
      });
    }
  }
  for (const pt of gateParticles) {
    // Particles stream toward the slit (center). Very slow at first,
    // speeding up with the gate's acceleration.
    const dx = cx - pt.x;
    const dy = cy - pt.y;
    const dist = Math.hypot(dx, dy) + 1;
    const speed = 0.15 + accel * 1.4 + a.rms * 0.8;
    pt.vx = dx / dist * speed;
    pt.x += pt.vx * 1.2;
    pt.y += dy / dist * 0.4 * (0.3 + accel);
    if (dist < 15) {
      // Respawn at the edge
      pt.x = Math.random() * w;
      pt.y = Math.random() * h;
    }
    ctx.fillStyle = `hsla(${pt.h}, 80%, 85%, 0.7)`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Central slit — bright vertical bar of light
  const slitW = 6 + a.rms * 20;
  const slitH = h * (0.6 + a.rms * 0.3);
  const slitGrad = ctx.createLinearGradient(cx - slitW, cy, cx + slitW, cy);
  slitGrad.addColorStop(0, "rgba(0,0,0,0)");
  slitGrad.addColorStop(0.5, `rgba(255,255,255,${0.9 + a.rms * 0.1})`);
  slitGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = slitGrad;
  ctx.fillRect(cx - slitW, cy - slitH / 2, slitW * 2, slitH);

  // Outer halo
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.25);
  halo.addColorStop(0, `rgba(180,210,255,${0.4 + a.rms * 0.3})`);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);
}

// Halo-and-rays visualizer (formerly the Buddha image gallery)
import { drawHaloGlow } from "./deities";

export const VISUALIZER_FNS: Record<
  Visualizer,
  (ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock) => void
> = {
  mandala: drawMandala,
  haloGlow: drawHaloGlow,
  cymatics: drawCymatics,
  inkBloom: drawInkBloom,
  horizon: drawHorizon,
  aurora: drawAurora,
  orb: drawOrb,
  dreamMachine: drawDreamMachine,
  fractal: drawFractal,
  rothko: drawRothko,
  tapeDecay: drawTapeDecay,
  dreamHouse: drawDreamHouse,
  sigil: drawSigilBloom,
  starGate: drawStarGate,
  pitchMandala: drawPitchMandala,
  flowField: drawFlowField,
  waveformRing: drawWaveformRing,
  waterfall: drawWaterfall,
  feedbackTunnel: drawFeedbackTunnel,
  saltDrift: drawSaltDrift,
  ironFilings: drawIronFilings,
  sediment: drawSediment,
  erosion: drawErosion,
  ashTrail: drawAshTrail,
};

// ═══════════════════════════════════════════════════════════════════════
// NEW DRONE-FOCUSED VISUALIZERS (commit 2026-04-10)
// ═══════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// 15. FREQUENCY RING — radial FFT in monochrome. Each of the 32
//     spectrum bins is a spoke from an inner ring outward; length =
//     bin energy. Drones produce stable radial glow patterns that
//     slowly rotate and breathe. Pure black-and-white palette.
// ─────────────────────────────────────────────────────────────────────
export function drawFreqRing(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Motion blur fade
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  const cx = w / 2;
  const cy = h / 2;
  const r0 = Math.min(w, h) * 0.15;
  const rMax = Math.min(w, h) * 0.44;
  const breath = 1 + a.rms * 0.06 + p.slow * 0.03;
  const bins = a.spectrum.length;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.t * 0.02);
  ctx.lineCap = "round";

  // Concentric resonance rings — 3 rings that pulse with low/mid/high bands
  for (let ring = 0; ring < 3; ring++) {
    const bandStart = Math.floor(ring * bins / 3);
    const bandEnd = Math.floor((ring + 1) * bins / 3);
    let bandEnergy = 0;
    for (let i = bandStart; i < bandEnd; i++) bandEnergy += a.spectrum[i];
    bandEnergy /= (bandEnd - bandStart);
    const ringR = r0 + (rMax - r0) * ((ring + 1) / 4) * breath;
    const alpha = 0.1 + bandEnergy * 0.5;
    ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.lineWidth = 0.5 + bandEnergy * 2;
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Radial spokes — each bin as a line from inner to outer
  const activeNodes: { angle: number; r: number; energy: number }[] = [];
  for (let i = 0; i < bins; i++) {
    const energy = a.spectrum[i];
    const angle = (i / bins) * Math.PI * 2;
    const inner = r0 * breath;
    const outer = inner + (rMax - r0) * (0.05 + energy * 0.95);
    const lum = Math.round(50 + energy * 205);
    ctx.strokeStyle = `rgba(${lum},${lum},${lum},${(0.2 + energy * 0.6).toFixed(3)})`;
    ctx.lineWidth = 1 + energy * 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.stroke();

    // Collect nodes with significant energy for the harmonic web
    if (energy > 0.15) {
      activeNodes.push({ angle, r: outer, energy });
      // Pulsing dot at the tip
      const dotR = 1.5 + energy * 3;
      ctx.globalAlpha = 0.4 + energy * 0.6;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * outer, Math.sin(angle) * outer, dotR, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Harmonic web — connect active nodes with faint lines
  if (activeNodes.length > 1) {
    ctx.strokeStyle = `rgba(255,255,255,0.06)`;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < activeNodes.length; i++) {
      for (let j = i + 1; j < activeNodes.length && j < i + 4; j++) {
        const a1 = activeNodes[i];
        const a2 = activeNodes[j];
        ctx.beginPath();
        ctx.moveTo(Math.cos(a1.angle) * a1.r, Math.sin(a1.angle) * a1.r);
        ctx.lineTo(Math.cos(a2.angle) * a2.r, Math.sin(a2.angle) * a2.r);
        ctx.stroke();
      }
    }
  }

  // Inner core — breathes with RMS
  ctx.strokeStyle = `rgba(255,255,255,${(0.3 + a.rms * 0.5).toFixed(3)})`;
  ctx.lineWidth = 1 + a.rms * 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r0 * breath, 0, Math.PI * 2);
  ctx.stroke();

  // Centre dot
  ctx.globalAlpha = 0.3 + a.rms * 0.4;
  ctx.beginPath();
  ctx.arc(0, 0, 2 + a.rms * 2, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────
// 16. PITCH MANDALA — 12-sector monochromatic mandala. Sectors are
//     labeled C..B (C at top). Spectrum bins are log-mapped to pitch
//     classes via bin-center frequency → MIDI → mod 12. Bin 0 is
//     skipped: at a 48 kHz / 2048 fft / 32-reduced-bin layout each
//     visualizer bin covers ~750 Hz, so bin 0 always mapped to F#
//     and swamped the mandala regardless of what was playing.
//     Pure black-and-white palette — no hue rotation.
// ─────────────────────────────────────────────────────────────────────
const pitchEnergies = new Float32Array(12);
// Bin width estimate: 48 kHz sample rate → 24 kHz Nyquist, 32 reduced
// bins → ~750 Hz per visualizer bin.
const BIN_WIDTH_HZ = 48000 / 2 / 32;
export function drawPitchMandala(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
  ctx.fillRect(0, 0, w, h);

  // Prefer ground-truth active pitches from the engine. The 32-bin
  // reduced FFT spectrum is too coarse (~750 Hz per bin) to
  // discriminate pitch classes at drone frequencies — a D3 drone
  // dumps most of its upper-harmonic energy into bin 1 whose center
  // is ~1125 Hz → MIDI 85 → C#, so the mandala used to light C#
  // every time. PhaseClock.activePitches carries root+intervals
  // derived from engine state, which is exact.
  pitchEnergies.fill(0);
  const truth = p.activePitches;
  let hasTruth = false;
  for (let i = 0; i < 12; i++) {
    if (truth[i] > 0) { hasTruth = true; break; }
  }
  if (hasTruth) {
    for (let i = 0; i < 12; i++) pitchEnergies[i] = truth[i];
  } else {
    // Fallback: the old FFT-based mapping, for visualizer demos
    // when no engine is attached.
    const bins = a.spectrum.length;
    for (let i = 1; i < bins; i++) {
      const centerHz = (i + 0.5) * BIN_WIDTH_HZ;
      const midi = 12 * Math.log2(centerHz / 440) + 69;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      pitchEnergies[pc] += a.spectrum[i];
    }
    let maxE = 0.001;
    for (let i = 0; i < 12; i++) if (pitchEnergies[i] > maxE) maxE = pitchEnergies[i];
    for (let i = 0; i < 12; i++) pitchEnergies[i] /= maxE;
  }

  // Per-frame wobble — give each sector an independent breathing
  // phase so the mandala feels alive even when the ground truth
  // hasn't changed. The wobble also multiplies with RMS so loud
  // passages visibly pump. This is visualization, not measurement,
  // so precision isn't the goal — motion is.
  const rmsBoost = 0.7 + a.rms * 0.7;
  const wobbleEnergies = tmpPitchWobble;
  let maxPc = 0, maxE = 0;
  let secondPc = 0, secondE = 0;
  for (let pc = 0; pc < 12; pc++) {
    const base = pitchEnergies[pc];
    const wob =
      1 +
      0.15 * Math.sin(p.t * (0.5 + pc * 0.13)) +
      0.08 * Math.sin(p.t * (1.3 + pc * 0.23) + pc * 0.7);
    const e = Math.min(1, base * wob * rmsBoost);
    wobbleEnergies[pc] = e;
    if (e > maxE) { secondE = maxE; secondPc = maxPc; maxE = e; maxPc = pc; }
    else if (e > secondE) { secondE = e; secondPc = pc; }
  }

  const cx = w / 2;
  const cy = h / 2;
  const r0 = Math.min(w, h) * 0.09;
  const rMax = Math.min(w, h) * 0.38;
  const breath = 1 + a.rms * 0.06 + p.slow * 0.03;

  ctx.save();
  ctx.translate(cx, cy);
  // Slow clockwise rotation — ~one revolution per 100 s. Was 0.012
  // (≈ 8 min per revolution) which was too slow to notice.
  ctx.rotate(p.t * 0.06);

  const halfAngle = (Math.PI / 12) * 0.86;
  // Store active sector midpoints for the constellation-line pass
  const activeX = tmpPitchX;
  const activeY = tmpPitchY;
  for (let pc = 0; pc < 12; pc++) {
    const energy = wobbleEnergies[pc];
    // C at top (angle = -π/2)
    const angle = (pc / 12) * Math.PI * 2 - Math.PI / 2;
    const innerR = r0 * breath;
    const outerR = innerR + (rMax - r0) * (0.22 + energy * 0.78);
    const midR = (innerR + outerR) * 0.5;
    activeX[pc] = Math.cos(angle) * midR;
    activeY[pc] = Math.sin(angle) * midR;

    // Monochromatic sector fill
    const light = Math.round(16 + energy * 75); // 16..91 grey
    ctx.fillStyle = `hsla(0, 0%, ${light}%, ${0.25 + energy * 0.6})`;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, angle - halfAngle, angle + halfAngle);
    ctx.arc(0, 0, innerR, angle + halfAngle, angle - halfAngle, true);
    ctx.closePath();
    ctx.fill();

    // Echo sliver just outside the main sector — smaller, phase-
    // shifted, gives the mandala visual depth without adding clutter
    if (energy > 0.18) {
      const echoR = outerR + 6 + energy * 10;
      const echoInner = outerR + 2;
      const echoHalf = halfAngle * 0.6;
      const echoLight = Math.round(40 + energy * 55);
      ctx.fillStyle = `hsla(0, 0%, ${echoLight}%, ${energy * 0.35})`;
      ctx.beginPath();
      ctx.arc(0, 0, echoR, angle - echoHalf, angle + echoHalf);
      ctx.arc(0, 0, echoInner, angle + echoHalf, angle - echoHalf, true);
      ctx.closePath();
      ctx.fill();
    }

    // Bright outer edge for active pitches
    if (energy > 0.25) {
      ctx.strokeStyle = `hsla(0, 0%, 100%, ${energy * 0.75})`;
      ctx.lineWidth = 1.5 + energy * 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, outerR, angle - halfAngle, angle + halfAngle);
      ctx.stroke();
    }

  }

  // Constellation lines — connect every pair of sufficiently-active
  // sectors with a faint white line. Makes the set of lit classes
  // feel like a *chord*, not isolated blobs.
  ctx.lineCap = "round";
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    if (wobbleEnergies[i] < 0.22) continue;
    for (let j = i + 1; j < 12; j++) {
      if (wobbleEnergies[j] < 0.22) continue;
      const alpha = Math.min(0.5, (wobbleEnergies[i] + wobbleEnergies[j]) * 0.2);
      ctx.strokeStyle = `hsla(0, 0%, 95%, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(activeX[i], activeY[i]);
      ctx.lineTo(activeX[j], activeY[j]);
      ctx.stroke();
    }
  }

  // Highlight the two brightest sectors with a thicker link —
  // the visual "root → dominant" connection.
  if (maxE > 0.3 && secondE > 0.22) {
    ctx.strokeStyle = `hsla(0, 0%, 100%, ${0.45 + a.rms * 0.3})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(activeX[maxPc], activeY[maxPc]);
    ctx.lineTo(activeX[secondPc], activeY[secondPc]);
    ctx.stroke();
  }

  // Inner hub — pulses with total lit energy
  let totalE = 0;
  for (let i = 0; i < 12; i++) totalE += wobbleEnergies[i];
  const hubPulse = Math.min(1, totalE * 0.18 + a.rms * 0.5);
  const hubR = r0 * breath * (0.8 + hubPulse * 0.5);
  const hubGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, hubR * 2);
  hubGrad.addColorStop(0, `hsla(0, 0%, 100%, ${0.45 + hubPulse * 0.45})`);
  hubGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hubGrad;
  ctx.beginPath();
  ctx.arc(0, 0, hubR * 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Module-level scratch buffers for drawPitchMandala — avoid per-
// frame allocation.
const tmpPitchWobble = new Float32Array(12);
const tmpPitchX = new Float32Array(12);
const tmpPitchY = new Float32Array(12);

// ─────────────────────────────────────────────────────────────────────
// 17. HARMONOGRAPH — Lissajous attractor. Four decoupled oscillators
//     with irrational frequency ratios produce a slow-evolving pen
//     curve. Oscillator frequencies are perturbed by the spectral
//     centroid and RMS, so the figure morphs continuously with the
//     drone's tonal color. Classic tabletop-harmonograph / spiral-
//     sigil aesthetic.
// ─────────────────────────────────────────────────────────────────────
const HARM_TRAIL_MAX = 2800;
const harmTrail = new Float32Array(HARM_TRAIL_MAX * 2); // packed x,y
let harmTrailHead = 0;
let harmTrailLen = 0;
export function drawHarmonograph(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const scale = Math.min(w, h) * 0.34;

  // Rough spectral centroid — weighted mean bin index normalized 0..1
  let num = 0, den = 0;
  for (let i = 0; i < a.spectrum.length; i++) {
    num += i * a.spectrum[i];
    den += a.spectrum[i];
  }
  const centroid = den > 0 ? (num / den) / a.spectrum.length : 0.3;

  // Four oscillators with irrational ratios, gently audio-modulated
  const f1 = 0.91 + centroid * 0.18 + p.slow * 0.04;
  const f2 = 1.37 - a.rms * 0.22 + p.slow * 0.03;
  const f3 = 2.11 + p.growth * 0.25;
  const f4 = 1.63 - p.growth * 0.15;

  // Append ~40 new points to the trail this frame. Each is computed
  // by advancing a local "pen time" — this is decoupled from p.t so
  // the curve stays smooth even at non-60fps frame rates.
  const framePoints = 36;
  const t = p.t;
  for (let i = 0; i < framePoints; i++) {
    const tt = t + i * 0.003;
    const x = (Math.sin(tt * f1) + Math.sin(tt * f3 + 1.1)) * scale * 0.45;
    const y = (Math.sin(tt * f2 + 0.7) + Math.sin(tt * f4 + 2.3)) * scale * 0.45;
    harmTrail[harmTrailHead * 2] = cx + x;
    harmTrail[harmTrailHead * 2 + 1] = cy + y;
    harmTrailHead = (harmTrailHead + 1) % HARM_TRAIL_MAX;
    if (harmTrailLen < HARM_TRAIL_MAX) harmTrailLen++;
  }

  // Draw trail as a continuous line starting from the oldest point.
  // Monochromatic — single grey stroke with RMS-driven brightness.
  const strokeLight = 60 + Math.round(a.rms * 25);
  ctx.strokeStyle = `hsla(0, 0%, ${strokeLight}%, ${0.4 + a.rms * 0.35})`;
  ctx.lineWidth = 1.3 + a.peak * 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const startIdx = harmTrailLen < HARM_TRAIL_MAX
    ? 0
    : harmTrailHead; // wrap start = head when full
  for (let j = 0; j < harmTrailLen; j++) {
    const k = (startIdx + j) % HARM_TRAIL_MAX;
    const x = harmTrail[k * 2];
    const y = harmTrail[k * 2 + 1];
    if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Soft halo second pass — faint white bloom
  ctx.strokeStyle = `hsla(0, 0%, 100%, ${0.1 + a.peak * 0.15})`;
  ctx.lineWidth = 5 + a.peak * 4;
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────
// 18. SPECTRAL WATERFALL — scrolling spectrogram. Each frame pushes
//     a new FFT row at the top of an offscreen canvas and scrolls
//     the rest down by 1 px. Drone harmonics show as persistent
//     vertical lines; fine-detune sliders visibly curve them in
//     real time. La Monte Young / Dream House aesthetic.
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// FLOW FIELD — audio-reactive particle streams through a noise field.
// Same algorithm as the WeatherPad but fullscreen, with RMS-driven
// spawn rate and motion-blur persistence trails.
// ─────────────────────────────────────────────────────────────────────
function flowNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const h = (a: number, b: number) => (Math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1;
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const flowParticles: { x: number; y: number; life: number; maxLife: number; size: number }[] = [];
export function drawFlowField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  const rms = a.rms;
  const time = p.t;

  // Motion blur
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // Spawn
  const spawnRate = rms * 3;
  for (let s = 0; s < spawnRate && flowParticles.length < 120; s++) {
    flowParticles.push({
      x: Math.random() * w, y: Math.random() * h,
      life: 0, maxLife: 100 + Math.random() * 120,
      size: 1.5 + Math.random() * 2,
    });
  }

  const fieldScale = 0.004;
  const fieldSpeed = 0.5 + rms * 2;

  for (let i = flowParticles.length - 1; i >= 0; i--) {
    const fp = flowParticles[i];
    const n = flowNoise(fp.x * fieldScale + time * 0.06, fp.y * fieldScale + time * 0.03);
    const angle = n * Math.PI * 4 + time * 0.1;
    fp.x += Math.cos(angle) * fieldSpeed;
    fp.y += Math.sin(angle) * fieldSpeed;
    fp.life++;

    if (fp.life >= fp.maxLife || fp.x < -10 || fp.x > w + 10 || fp.y < -10 || fp.y > h + 10) {
      flowParticles.splice(i, 1);
      continue;
    }

    const t = fp.life / fp.maxLife;
    const alpha = (t < 0.1 ? t / 0.1 : t > 0.7 ? (1 - t) / 0.3 : 1);
    ctx.globalAlpha = alpha * (0.2 + rms * 0.4);
    ctx.beginPath();
    ctx.arc(fp.x, fp.y, fp.size, 0, Math.PI * 2);
    const lum = Math.round(180 + rms * 75);
    ctx.fillStyle = `rgb(${lum},${lum},${lum})`;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ─────────────────────────────────────────────────────────────────────
// WAVEFORM RING — circular oscilloscope centered on screen.
// Radius proportional to RMS volume (up to a max). The audio
// waveform draws as a ring, breathing with the drone. Pure B&W.
// ─────────────────────────────────────────────────────────────────────
export function drawWaveformRing(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Motion-blur fade — dt-scaled and aggressive enough that even a
  // severely-throttled captureStream (pop-out fullscreen on a
  // second monitor can push rAF down to ~1 Hz) clears accumulated
  // strokes instead of piling them into a solid ring. At 60 fps
  // (dtScale ≈ 1) ~45% erased per frame; at 30 fps ~70%; at 1 fps
  // (dtScale clamped to 4.8) ~96% — effectively a full clear.
  const BASE_FADE = 0.45;
  const fade = Math.min(1, 1 - Math.pow(1 - BASE_FADE, p.dtScale ?? 1));
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = fade;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  const cx = w / 2;
  const cy = h / 2;
  const rms = a.rms;
  const maxR = Math.min(w, h) * 0.38;
  const baseR = maxR * Math.min(1, rms * 2.5); // radius proportional to volume
  if (baseR < 3) return;

  const wave = a.waveform;
  if (!wave) return;
  const samples = wave.length;
  const step = Math.max(1, Math.floor(samples / 180));

  // Main waveform ring
  ctx.beginPath();
  for (let i = 0; i < 180; i++) {
    const si = i * step;
    const v = (wave[si] - 128) / 128;
    const angle = (i / 180) * Math.PI * 2 - Math.PI / 2;
    const r = baseR + v * baseR * 0.35;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = `rgba(255,255,255,${(0.5 + rms * 0.4).toFixed(3)})`;
  ctx.lineWidth = 1.5 + rms;
  ctx.stroke();

  // Inner ghost ring — steady reference
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 0.4, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,255,255,${(0.1 + rms * 0.15).toFixed(3)})`;
  ctx.lineWidth = 0.6;
  ctx.stroke();

  // Centre dot
  ctx.beginPath();
  ctx.arc(cx, cy, 1.5 + rms * 2, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${(0.3 + rms * 0.4).toFixed(3)})`;
  ctx.fill();
}

let waterfallCanvas: HTMLCanvasElement | null = null;
let waterfallCtx: CanvasRenderingContext2D | null = null;
let waterfallLastScroll = 0;
export function drawWaterfall(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Lazy (re)create offscreen canvas on size change
  if (!waterfallCanvas || waterfallCanvas.width !== w || waterfallCanvas.height !== h) {
    waterfallCanvas = document.createElement("canvas");
    waterfallCanvas.width = w;
    waterfallCanvas.height = h;
    waterfallCtx = waterfallCanvas.getContext("2d");
    if (waterfallCtx) {
      waterfallCtx.fillStyle = "#060408";
      waterfallCtx.fillRect(0, 0, w, h);
    }
  }
  const off = waterfallCtx;
  if (!off || !waterfallCanvas) return;

  // Fast scroll: ~80 rows/sec (a 500-px canvas fills in ~6 s).
  const SCROLL_PX = 3;
  if (p.t - waterfallLastScroll >= 0.016) {
    waterfallLastScroll = p.t;
    // Scroll everything down by SCROLL_PX.
    off.drawImage(waterfallCanvas, 0, 0, w, h - SCROLL_PX, 0, SCROLL_PX, w, h - SCROLL_PX);

    // Draw the new top row from the current spectrum. Frequencies
    // increase left→right; higher energy = brighter + warmer hue.
    const bins = a.spectrum.length;
    for (let i = 0; i < bins; i++) {
      const energy = a.spectrum[i];
      const x = (i / bins) * w;
      const xEnd = ((i + 1) / bins) * w;
      const hue = (p.hue + i * 4) % 360;
      const lightness = 10 + energy * 60;
      off.fillStyle = `hsla(${hue}, 85%, ${lightness}%, ${0.1 + energy})`;
      off.fillRect(x, 0, xEnd - x + 1, SCROLL_PX);
    }

    // Slow global fade so ancient rows don't persist forever
    off.fillStyle = "rgba(6, 4, 8, 0.005)";
    off.fillRect(0, 0, w, h);
  }

  ctx.drawImage(waterfallCanvas, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────
// 19. DRONE STRATA — horizontal frequency bands layered like weather
//     strata. Each band is assigned a frequency range and its
//     altitude/thickness/hue track the band's energy. Slow sine
//     drift gives each stratum its own wandering contour. Abstract
//     atmospheric landscape; meditation-friendly.
// ─────────────────────────────────────────────────────────────────────
export function drawStrata(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  // Deep base colour
  ctx.fillStyle = `hsl(${(p.hue + 220) % 360}, 30%, 5%)`;
  ctx.fillRect(0, 0, w, h);

  const bandCount = 7 + Math.round(p.growth * 2); // 7..9
  const bands = a.spectrum.length;
  const bandH = h / bandCount;

  for (let b = 0; b < bandCount; b++) {
    // Map this band to a chunk of the spectrum. Low bands → low
    // frequencies, so the "ground" layer reacts to the fundamental.
    const specStart = Math.floor((b / bandCount) * bands);
    const specEnd = Math.floor(((b + 1) / bandCount) * bands);
    let energy = 0;
    for (let i = specStart; i < specEnd; i++) energy += a.spectrum[i];
    energy /= Math.max(1, specEnd - specStart);

    // From top: higher b = lower stratum in the image
    const y0 = (bandCount - 1 - b) * bandH;
    const hue = ((p.hue + b * 28) + p.slow * 30) % 360;
    const lightness = 18 + energy * 35 + p.slow * 4;
    const alpha = 0.4 + energy * 0.4;

    ctx.fillStyle = `hsla(${hue}, 65%, ${lightness}%, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(0, y0 + bandH);
    // Wavy top contour — slow sine drift per band
    for (let x = 0; x <= w; x += 6) {
      const drift = Math.sin(x * 0.006 + p.t * 0.07 + b * 0.9) * bandH * 0.18;
      const bump = Math.sin(x * 0.02 + p.t * 0.13 + b * 1.7) * bandH * 0.06;
      const yy = y0 + drift + bump - energy * bandH * 0.25;
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(w, y0 + bandH);
    ctx.closePath();
    ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────────────
// 20. FEEDBACK TUNNEL — video-feedback emulation. Classic analog
//     feedback loop simulated on an offscreen canvas: each frame,
//     the prior frame is scaled slightly larger, rotated slightly,
//     and blended back underneath a new central pulse. Produces
//     the hypnotic spiraling inward/outward texture of Ken Russell
//     / Derek Jarman experimental film.
// ─────────────────────────────────────────────────────────────────────
let feedbackCanvas: HTMLCanvasElement | null = null;
let feedbackCtx: CanvasRenderingContext2D | null = null;
export function drawFeedbackTunnel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  if (!feedbackCanvas || feedbackCanvas.width !== w || feedbackCanvas.height !== h) {
    feedbackCanvas = document.createElement("canvas");
    feedbackCanvas.width = w;
    feedbackCanvas.height = h;
    feedbackCtx = feedbackCanvas.getContext("2d");
    if (feedbackCtx) {
      feedbackCtx.fillStyle = "#060408";
      feedbackCtx.fillRect(0, 0, w, h);
    }
  }
  const off = feedbackCtx;
  if (!off || !feedbackCanvas) return;

  // Slight fade so old content eventually decays out
  off.fillStyle = `rgba(4, 2, 6, ${0.05 + a.rms * 0.04})`;
  off.fillRect(0, 0, w, h);

  // Zoom + rotate the previous frame onto itself. Small transforms
  // build up over many frames into a visible tunnel.
  off.save();
  off.translate(w / 2, h / 2);
  off.rotate(0.004 + a.rms * 0.008 + Math.sin(p.t * 0.07) * 0.002);
  const zoom = 1.015 + a.rms * 0.01 + p.growth * 0.002;
  off.scale(zoom, zoom);
  off.translate(-w / 2, -h / 2);
  off.globalAlpha = 0.9;
  off.drawImage(feedbackCanvas, 0, 0);
  off.globalAlpha = 1;
  off.restore();

  // Inject a new central pulse — it's what feeds the feedback loop
  const pulseR = Math.min(w, h) * (0.04 + a.peak * 0.1 + a.rms * 0.05);
  const hue = (p.hue + p.t * 4) % 360;
  const grad = off.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, pulseR * 3);
  grad.addColorStop(0, `hsla(${hue}, 95%, 70%, ${0.5 + a.peak * 0.4})`);
  grad.addColorStop(0.5, `hsla(${(hue + 30) % 360}, 85%, 50%, ${0.25 + a.peak * 0.2})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  off.fillStyle = grad;
  off.fillRect(0, 0, w, h);

  ctx.drawImage(feedbackCanvas, 0, 0);
}


// ═══════════════════════════════════════════════════════════════════════
// ORIGINAL DRONE VISUALIZERS — accretive, matte, heavy. No glow, no
// hue-from-audio, no per-frame fast reactivity. Each one accrues over
// minutes of listening.
// ═══════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// SALT DRIFT — fine particulate drifting left-to-right across the
// frame under a gentle gravity, accumulating at the bottom as slowly-
// growing dunes. The floor erodes very slightly so dunes reshape
// rather than piling up forever.
// ─────────────────────────────────────────────────────────────────────
interface SaltGrain { x: number; y: number; vx: number; vy: number; bright: number; }
let saltGrains: SaltGrain[] | null = null;
let saltFloor: Float32Array | null = null;
let saltCanvasW = 0;
let saltCanvasH = 0;

export function drawSaltDrift(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  a: AudioFrame, p: PhaseClock,
): void {
  const N = 1200;
  const FLOOR_BINS = Math.max(128, Math.floor(w / 4));

  if (!saltGrains || saltCanvasW !== w || saltCanvasH !== h || !saltFloor || saltFloor.length !== FLOOR_BINS) {
    saltCanvasW = w;
    saltCanvasH = h;
    saltGrains = new Array(N);
    for (let i = 0; i < N; i++) {
      saltGrains[i] = {
        x: Math.random() * w,
        y: Math.random() * h * 0.6,
        vx: 0.2 + Math.random() * 0.5,
        vy: 0.05 + Math.random() * 0.15,
        bright: 0.55 + Math.random() * 0.45,
      };
    }
    saltFloor = new Float32Array(FLOOR_BINS);
  }

  ctx.fillStyle = "#1a1612";
  ctx.fillRect(0, 0, w, h);

  const gust = Math.sin(p.t * 0.05) * 0.25 + p.slow * 0.15;
  const gravity = 0.02 + a.rms * 0.02;
  const floor = saltFloor!;

  ctx.fillStyle = `hsl(${p.mood.hue}, 12%, 82%)`;
  for (let i = 0; i < N; i++) {
    const g = saltGrains[i];
    g.x += g.vx + gust;
    g.y += g.vy + gravity;
    if (g.x > w) g.x -= w;
    if (g.x < 0) g.x += w;
    const floorIdx = Math.min(FLOOR_BINS - 1, Math.max(0, Math.floor((g.x / w) * FLOOR_BINS)));
    const floorY = h - floor[floorIdx];
    if (g.y >= floorY) {
      const spread = 1.5 + Math.random() * 0.8;
      floor[floorIdx] += spread;
      const nL = Math.max(0, floorIdx - 1);
      const nR = Math.min(FLOOR_BINS - 1, floorIdx + 1);
      floor[nL] += spread * 0.35;
      floor[nR] += spread * 0.35;
      g.x = Math.random() * w;
      g.y = -Math.random() * 10;
      g.vx = 0.2 + Math.random() * 0.5;
      g.vy = 0.05 + Math.random() * 0.15;
      continue;
    }
    const r = 0.6 + g.bright * 0.7;
    ctx.globalAlpha = 0.55 + g.bright * 0.35;
    ctx.fillRect(g.x, g.y, r, r);
  }
  ctx.globalAlpha = 1;

  const erosion = 0.04 + a.rms * 0.04;
  const maxH = h * 0.45;
  const nextFloor = new Float32Array(FLOOR_BINS);
  for (let i = 0; i < FLOOR_BINS; i++) {
    const l = floor[Math.max(0, i - 1)];
    const r = floor[Math.min(FLOOR_BINS - 1, i + 1)];
    const diffused = (l + floor[i] * 2 + r) * 0.25;
    nextFloor[i] = Math.max(0, Math.min(maxH, diffused - erosion));
  }
  saltFloor = nextFloor;

  ctx.fillStyle = "#2a221c";
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < FLOOR_BINS; i++) {
    const x = (i / (FLOOR_BINS - 1)) * w;
    ctx.lineTo(x, h - nextFloor[i]);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#3a2e24";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, h - nextFloor[0]);
  for (let i = 1; i < FLOOR_BINS; i++) {
    ctx.lineTo((i / (FLOOR_BINS - 1)) * w, h - nextFloor[i]);
  }
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────
// IRON FILINGS — a dense field of short filament strokes oriented to
// an invisible magnetic field. Field angle at each point is a spiral
// around the canvas centre plus a slow rotation + drone-influenced
// warp. When the drone is stable the filings lock into radial
// alignment; richer spectra induce swirl.
// ─────────────────────────────────────────────────────────────────────
interface FilingPos { x: number; y: number; }
let filingsPositions: FilingPos[] | null = null;
let filingsW = 0;
let filingsH = 0;

export function drawIronFilings(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  a: AudioFrame, p: PhaseClock,
): void {
  const SPACING = 14;
  if (!filingsPositions || filingsW !== w || filingsH !== h) {
    filingsPositions = [];
    for (let y = SPACING * 0.5; y < h; y += SPACING) {
      for (let x = SPACING * 0.5; x < w; x += SPACING) {
        filingsPositions.push({
          x: x + (Math.random() - 0.5) * SPACING * 0.5,
          y: y + (Math.random() - 0.5) * SPACING * 0.5,
        });
      }
    }
    filingsW = w;
    filingsH = h;
  }

  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.5;
  const phi = p.t * 0.02 + p.slow * 1.6;
  let active = 0;
  for (let i = 0; i < a.spectrum.length; i++) if (a.spectrum[i] > 0.1) active++;
  const spectrumWidth = active / a.spectrum.length;
  const swirl = 0.15 + spectrumWidth * 1.1 + a.rms * 0.3;
  const FILAMENT_LEN = 7;

  ctx.strokeStyle = "#b8b3a8";
  ctx.lineWidth = 0.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  const positions = filingsPositions;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    const radial = Math.atan2(dy, dx);
    const theta = radial + swirl * Math.sin(r * 0.012 - phi);
    const hx = Math.cos(theta) * FILAMENT_LEN * 0.5;
    const hy = Math.sin(theta) * FILAMENT_LEN * 0.5;
    ctx.moveTo(pos.x - hx, pos.y - hy);
    ctx.lineTo(pos.x + hx, pos.y + hy);
  }
  ctx.stroke();

  ctx.fillStyle = "#d4cfc2";
  ctx.beginPath();
  ctx.arc(cx, cy, 1.8 + a.rms * 0.8, 0, Math.PI * 2);
  ctx.fill();
}

// ─────────────────────────────────────────────────────────────────────
// SEDIMENT STRATA — horizontal rock layers deposit at the BOTTOM and
// the pile grows upward over time. Each new stratum's colour and
// grain come from the drone's current spectral balance, then freeze.
// Once the column fills the canvas, the oldest layers scroll off the
// top — you are always looking at the most recent N minutes as rock.
// ─────────────────────────────────────────────────────────────────────
let sedimentCanvas: HTMLCanvasElement | null = null;
let sedimentCtx: CanvasRenderingContext2D | null = null;
let sedimentOffset = 0;

export function drawSediment(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  a: AudioFrame, p: PhaseClock,
): void {
  if (!sedimentCanvas || sedimentCanvas.width !== w || sedimentCanvas.height !== h) {
    sedimentCanvas = document.createElement("canvas");
    sedimentCanvas.width = w;
    sedimentCanvas.height = h;
    sedimentCtx = sedimentCanvas.getContext("2d");
    if (sedimentCtx) {
      sedimentCtx.fillStyle = "#18120e";
      sedimentCtx.fillRect(0, 0, w, h);
    }
    sedimentOffset = 0;
  }
  const off = sedimentCtx!;

  const rate = 0.12 + a.rms * 0.12;
  sedimentOffset += rate;
  const pxToScroll = Math.floor(sedimentOffset);
  sedimentOffset -= pxToScroll;
  // Shift the existing pile UP by pxToScroll so new strata deposit
  // at the bottom. The dark background gets pushed off the top first;
  // once real strata reaches the top, the oldest layers drop off.
  if (pxToScroll > 0 && h - pxToScroll > 0) {
    const img = off.getImageData(0, pxToScroll, w, h - pxToScroll);
    off.putImageData(img, 0, 0);
  }

  for (let row = 0; row < pxToScroll; row++) {
    const y = h - pxToScroll + row; // draw at BOTTOM
    for (let x = 0; x < w; x += 2) {
      const bin = Math.floor((x / w) * a.spectrum.length);
      const e = a.spectrum[bin] ?? 0;
      const lig = 10 + e * 28 + (Math.random() - 0.5) * 4 + p.slow * 3;
      const sat = 12 + e * 18;
      const hue = 28 + (p.mood.warmth - 0.5) * 14;
      off.fillStyle = `hsl(${hue}, ${sat}%, ${lig}%)`;
      off.fillRect(x, y, 2, 1);
    }
  }

  ctx.drawImage(sedimentCanvas, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────
// EROSION CONTOURS — low-resolution heightmap quantised into discrete
// elevation levels, rendered as flat shaded bands with darker seam
// lines between levels — reads like a USGS topographic map whose
// coastline breathes with the drone.
// ─────────────────────────────────────────────────────────────────────
const EROSION_GW = 96;
const EROSION_GH = 64;
const EROSION_LEVELS = 7;
let erosionHeight: Float32Array | null = null;

export function drawErosion(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  a: AudioFrame, p: PhaseClock,
): void {
  if (!erosionHeight) {
    erosionHeight = new Float32Array(EROSION_GW * EROSION_GH);
  }
  const height = erosionHeight;

  const bins = a.spectrum.length;
  const lowpass = 0.04;
  for (let gy = 0; gy < EROSION_GH; gy++) {
    for (let gx = 0; gx < EROSION_GW; gx++) {
      const bin = Math.floor(((gx + gy * 0.5) / (EROSION_GW + EROSION_GH * 0.5)) * bins) % bins;
      const e = a.spectrum[bin] ?? 0;
      const wave =
        Math.sin(gx * 0.09 + p.t * 0.05) * 0.2 +
        Math.cos(gy * 0.13 - p.t * 0.03) * 0.15 +
        Math.sin((gx + gy) * 0.05 + p.slow * 3) * 0.1;
      const target = e * 0.7 + wave + 0.4 + a.rms * 0.2;
      const idx = gy * EROSION_GW + gx;
      height[idx] += (target - height[idx]) * lowpass;
    }
  }

  const cellW = w / EROSION_GW;
  const cellH = h / EROSION_GH;
  const baseHue = 28 + (p.mood.warmth - 0.5) * 14;
  for (let gy = 0; gy < EROSION_GH; gy++) {
    for (let gx = 0; gx < EROSION_GW; gx++) {
      const val = height[gy * EROSION_GW + gx];
      const level = Math.max(0, Math.min(EROSION_LEVELS - 1,
        Math.floor(val * EROSION_LEVELS)));
      const lig = 8 + level * 6;
      ctx.fillStyle = `hsl(${baseHue}, 12%, ${lig}%)`;
      ctx.fillRect(gx * cellW, gy * cellH, cellW + 1, cellH + 1);
    }
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let gy = 0; gy < EROSION_GH; gy++) {
    for (let gx = 0; gx < EROSION_GW; gx++) {
      const i = gy * EROSION_GW + gx;
      const lvl = Math.floor(height[i] * EROSION_LEVELS);
      if (gx < EROSION_GW - 1) {
        const lvlR = Math.floor(height[i + 1] * EROSION_LEVELS);
        if (lvlR !== lvl) {
          const x = (gx + 1) * cellW;
          ctx.moveTo(x, gy * cellH);
          ctx.lineTo(x, (gy + 1) * cellH);
        }
      }
      if (gy < EROSION_GH - 1) {
        const lvlB = Math.floor(height[i + EROSION_GW] * EROSION_LEVELS);
        if (lvlB !== lvl) {
          const y = (gy + 1) * cellH;
          ctx.moveTo(gx * cellW, y);
          ctx.lineTo((gx + 1) * cellW, y);
        }
      }
    }
  }
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────
// ASH TRAIL — three slowly-drifting point sources leave charcoal ink
// trails on a persistent paper canvas. Sources wander across 60-80%
// of the canvas; speed, spread, blob size, and sparkle fleck density
// all react to the drone's character:
//   overall RMS → source speed + blob size + core opacity
//   low band    → core blob radius (bass = fatter strokes)
//   mid band    → orbital amplitude (mid = bigger travel)
//   high band   → charcoal flecks spraying around each source
// Trails fade very slowly so minutes of listening accrete into a
// drifting smoke drawing.
// ─────────────────────────────────────────────────────────────────────
let ashCanvas: HTMLCanvasElement | null = null;
let ashCtx: CanvasRenderingContext2D | null = null;
interface AshSource { fx: number; fy: number; fbx: number; fby: number; offset: number; phase: number; }
const ashSources: AshSource[] = [
  // Lissajous frequency pairs (fx, fy) chosen so the curves don't
  // repeat quickly; offset seeds each source at a different phase.
  { fx: 1.7, fy: 2.3, fbx: 0.19, fby: 0.23, offset: 0.0, phase: 0 },
  { fx: 2.1, fy: 1.9, fbx: 0.23, fby: 0.17, offset: 2.1, phase: 2.1 },
  { fx: 1.3, fy: 2.7, fbx: 0.17, fby: 0.21, offset: 4.3, phase: 4.3 },
];

export function drawAshTrail(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  a: AudioFrame, p: PhaseClock,
): void {
  if (!ashCanvas || ashCanvas.width !== w || ashCanvas.height !== h) {
    ashCanvas = document.createElement("canvas");
    ashCanvas.width = w;
    ashCanvas.height = h;
    ashCtx = ashCanvas.getContext("2d");
    if (ashCtx) {
      ashCtx.fillStyle = "#efe8dc";
      ashCtx.fillRect(0, 0, w, h);
    }
  }
  const off = ashCtx!;

  // Very slow fade toward paper colour so trails persist for minutes.
  off.fillStyle = "rgba(239, 232, 220, 0.008)";
  off.fillRect(0, 0, w, h);

  // Spectral bands
  const bins = a.spectrum.length;
  let lowE = 0, midE = 0, highE = 0;
  const tA = Math.floor(bins / 3);
  const tB = Math.floor((bins * 2) / 3);
  for (let i = 0; i < tA; i++) lowE += a.spectrum[i];
  for (let i = tA; i < tB; i++) midE += a.spectrum[i];
  for (let i = tB; i < bins; i++) highE += a.spectrum[i];
  lowE /= Math.max(1, tA);
  midE /= Math.max(1, tB - tA);
  highE /= Math.max(1, bins - tB);

  const cx = w * 0.5;
  const cy = h * 0.5;
  // Orbital extent — sources wander over most of the canvas even at
  // silence so the piece isn't centre-bound. 50% at silence, up to
  // ~95% with rich mid-band + RMS + slight slow breath. The
  // secondary orbital adds another ~18% on top, so loud moments
  // occasionally push sources slightly past the visible edges
  // (intentional: trails end abruptly at the paper border).
  const reach = 0.50 + 0.25 * midE + 0.18 * a.rms + 0.06 * p.slow;
  const ampX = w * reach;
  const ampY = h * reach;
  // Source motion speed — slow by default, visibly faster with loud
  // drones. Base 0.02 matches the original pace; peak ~0.18.
  const speed = 0.02 + a.rms * 0.16 + midE * 0.04;
  // Core blob radius + opacity
  const blobR = 3 + lowE * 22 + a.peak * 10 + a.rms * 6;
  const blobAlpha = 0.06 + a.rms * 0.14 + lowE * 0.08;
  // Three matte soot tones — warm, cool, neutral
  const soots = [
    `rgba(25, 22, 20, ${blobAlpha})`,
    `rgba(40, 32, 26, ${blobAlpha * 0.9})`,
    `rgba(22, 26, 32, ${blobAlpha * 0.9})`,
  ];
  const halos = [
    `rgba(25, 22, 20, ${blobAlpha * 0.28})`,
    `rgba(40, 32, 26, ${blobAlpha * 0.26})`,
    `rgba(22, 26, 32, ${blobAlpha * 0.26})`,
  ];

  for (let s = 0; s < ashSources.length; s++) {
    const src = ashSources[s];
    src.phase += speed;
    const th = src.phase + src.offset;
    // Primary Lissajous: fx/fy are incommensurate so the curve never
    // closes exactly — the source wanders indefinitely.
    const x = cx + Math.cos(th * src.fx) * ampX +
              Math.sin(th * src.fbx) * ampX * 0.18;
    const y = cy + Math.sin(th * src.fy) * ampY +
              Math.cos(th * src.fby) * ampY * 0.18;

    // Core soft blob
    off.fillStyle = soots[s];
    off.beginPath();
    off.arc(x, y, blobR, 0, Math.PI * 2);
    off.fill();

    // Outer halo — softer, wider
    off.fillStyle = halos[s];
    off.beginPath();
    off.arc(x, y, blobR * 2.5, 0, Math.PI * 2);
    off.fill();

    // High-band charcoal flecks — little specks sprayed around the
    // source on treble-rich drones. Silent / bass-only drones have
    // zero flecks, which keeps the quiet image clean.
    const flecks = Math.round(highE * 10);
    if (flecks > 0) {
      off.fillStyle = `rgba(25, 22, 20, ${0.15 + highE * 0.25})`;
      for (let i = 0; i < flecks; i++) {
        const fa = th * 0.8 + i * 1.7 + s * 0.9;
        const fr = blobR + 6 + (i * 3);
        const fx2 = x + Math.cos(fa) * fr + (Math.random() - 0.5) * 2;
        const fy2 = y + Math.sin(fa) * fr + (Math.random() - 0.5) * 2;
        const sz = 0.8 + Math.random() * 0.9;
        off.fillRect(fx2, fy2, sz, sz);
      }
    }
  }

  ctx.drawImage(ashCanvas, 0, 0);
}
