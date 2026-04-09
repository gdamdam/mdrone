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
  | "dreamMachine";

export const VISUALIZER_ORDER: readonly Visualizer[] = [
  "mandala",
  "haloGlow",
  "fractal",
  "rothko",
  "tapeDecay",
  "dreamHouse",
  "sigil",
  "starGate",
  "cymatics",
  "inkBloom",
  "horizon",
  "aurora",
  "orb",
  "dreamMachine",
] as const;

export const VISUALIZER_LABELS: Record<Visualizer, string> = {
  mandala: "BREATHING MANDALA",
  haloGlow: "HALO & RAYS",
  fractal: "JULIA FRACTAL · heavy",
  rothko: "ROTHKO FIELD · Radigue",
  tapeDecay: "TAPE DECAY · Basinski",
  dreamHouse: "DREAM HOUSE MAGENTA · La Monte Young",
  sigil: "SIGIL BLOOM · Coil",
  starGate: "STAR GATE · Coil / 2001",
  cymatics: "CYMATICS PLATE",
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
  const hueBase = p.hue;

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
      const l = Math.min(100, mag * 60);
      const hue = (hueBase + mag * 40) % 360;
      // HSL → RGB cheap approximation (warm ember base)
      const sat = 70;
      const ll = l / 100;
      const c = (1 - Math.abs(2 * ll - 1)) * (sat / 100);
      const hp = hue / 60;
      const xc = c * (1 - Math.abs((hp % 2) - 1));
      let r1 = 0, g1 = 0, b1 = 0;
      if (hp < 1) { r1 = c; g1 = xc; }
      else if (hp < 2) { r1 = xc; g1 = c; }
      else if (hp < 3) { g1 = c; b1 = xc; }
      else if (hp < 4) { g1 = xc; b1 = c; }
      else if (hp < 5) { r1 = xc; b1 = c; }
      else { r1 = c; b1 = xc; }
      const m = ll - c / 2;
      const idx = (y * CYMAT_W + x) * 4;
      pix[idx] = Math.round((r1 + m) * 255);
      pix[idx + 1] = Math.round((g1 + m) * 255);
      pix[idx + 2] = Math.round((b1 + m) * 255);
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

  // Sun — radius responds to rms + slow clock
  const horizonY = h * (0.68 - p.slow * 0.08);
  const sunR = Math.min(w, h) * (0.12 + a.rms * 0.08 + p.slow * 0.02);
  const sunX = w * 0.5;
  const sunGrad = ctx.createRadialGradient(sunX, horizonY, 0, sunX, horizonY, sunR * 2.2);
  sunGrad.addColorStop(0, `hsla(${(p.hue + 20) % 360}, 95%, 75%, 0.9)`);
  sunGrad.addColorStop(0.4, `hsla(${(p.hue + 10) % 360}, 85%, 55%, 0.55)`);
  sunGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sunGrad;
  ctx.fillRect(0, 0, w, h);

  // Horizon line
  ctx.strokeStyle = `hsla(${(p.hue + 20) % 360}, 85%, 70%, 0.5)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(w, horizonY);
  ctx.stroke();

  // Heat-haze shimmer lines above horizon. Count grows over time.
  const hazeCount = 5 + Math.round(p.growth * 10);
  ctx.strokeStyle = `hsla(${(p.hue + 30) % 360}, 80%, 80%, ${0.1 + a.peak * 0.15 + p.growth * 0.06})`;
  for (let i = 0; i < hazeCount; i++) {
    const yy = horizonY - 8 - i * 10;
    ctx.beginPath();
    for (let x = 0; x < w; x += 4) {
      const dy = Math.sin(x * 0.03 + p.t * 0.15 + i) * (1 + a.peak * 3);
      if (x === 0) ctx.moveTo(x, yy + dy); else ctx.lineTo(x, yy + dy);
    }
    ctx.stroke();
  }
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

  // Julia c — traces a very slow Lissajous orbit, tugged a little by RMS
  const cr = 0.7885 * Math.cos(p.t * 0.02);
  const ci = 0.7885 * Math.sin(p.t * 0.017 + p.slow * 0.5) + a.rms * 0.05;

  // Small zoom pulse with breath, rotation with growth
  const zoom = 1.4 + p.slow * 0.15 + a.rms * 0.1;
  const rot = p.t * 0.01 * p.growth;
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
//    Pure duration monument à la Radigue. Audio barely visible;
//    time and palette drift are the real composition.
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
//     localStorage every few seconds, so you can come back to tape
//     that has been eroding while you were away (Basinski).
// ─────────────────────────────────────────────────────────────────────
let tapeCanvas: HTMLCanvasElement | null = null;
let tapeCtx: CanvasRenderingContext2D | null = null;
const TAPE_W = 900;    // length of the physical loop
const TAPE_H = 80;
const TAPE_STORAGE_KEY = "mdrone.meditate.tapeDecay";
let tapeLastSave = 0;
let tapeOffset = 0;     // scroll position (px)
let tapeLoopIndex = 0;  // which playback pass we're on
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
        if (avg < 28) {
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

  // Advance the loop — 40 px/s base, modulated a little by RMS
  const scrollSpeed = 40 + a.rms * 20;
  tapeOffset += scrollSpeed * (1 / 60);
  if (tapeOffset >= TAPE_W) {
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
  if (p.t * 1000 - tapeLastSave > 6000) {
    tapeLastSave = p.t * 1000;
    try {
      localStorage.setItem(TAPE_STORAGE_KEY, tapeCanvas!.toDataURL("image/png"));
    } catch { /* ok */ }
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
//     them. Coil / Austin Osman Spare territory.
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

  // ── Fake 3D rotation around the vertical axis ───────────────
  // Apply a horizontal scale that oscillates between ~0.35 and 1
  // over ~20 s to create a "spinning coin" illusion. Also a small
  // vertical scale wobble.
  const spinPhase = p.t * (Math.PI * 2 / 20); // full revolution / 20s
  const rotX = Math.cos(spinPhase);            // -1..1
  const scaleX = Math.max(0.2, Math.abs(rotX));
  const scaleY = 1 + Math.sin(p.t * 0.15) * 0.03;
  // Pulse — breathing in and out on top of the rotation
  const pulse = 1 + 0.05 * Math.sin(p.t * 0.9) + a.rms * 0.06;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scaleX * pulse, scaleY * pulse);
  ctx.translate(-cx, -cy);

  // Deep sigil ink — red ochre bleeding on dark
  const hue = 10 + Math.sin(p.t * 0.1) * 10;
  // Edge-of-rotation darkening — the ink fades when the sigil is
  // near-edge-on (small scaleX), like a real rotating disc.
  const edgeDim = 0.4 + Math.abs(rotX) * 0.6;
  ctx.strokeStyle = `hsla(${hue}, 85%, 55%, ${(0.75 + a.peak * 0.2) * edgeDim})`;
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
  ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${0.18 * edgeDim + 0.06})`;
  ctx.lineWidth = 5 + a.peak * 4;
  ctx.beginPath();
  for (let i = 0; i < drawn; i++) {
    const pt = sigilPoints![i];
    if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();

  // Bindu nodes at the original points (show faintly)
  if (sigilPoints) {
    ctx.fillStyle = `hsla(${hue + 30}, 90%, 70%, ${0.6 * edgeDim})`;
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
};
