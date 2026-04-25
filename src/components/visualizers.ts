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
  | "haloGlow"
  | "mirrorGlyphs"
  | "rothko"
  | "starGate"
  | "cymatics"
  | "dreamMachine"
  | "pitchTonnetz"
  | "pitchBeats"
  | "flowField"
  | "waveformRing"
  | "ironFilings"
  | "sediment"
  | "prayerRug"
  | "phasePortrait"
  | "moireField"
  | "illuminatedGlyphs"
  | "scryingMirror"
  | "crystalLattice"
  | "phaseMirror"
  | "resonantBody"
  | "tapeDecay"
  | "voidMonolith"
  | "beatingField"
  | "tuningManuscript"
  | "petroglyphs"
  | "feedbackTunnelBW"
  | "stereoVectorscope"
  | "harmonicEmber"
  | "shortwaveStatic";

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
    // ── Show the drone's pitch / tuning / phase / beats / voice
    label: "HARMONIC",
    items: [
      // B&W / monochromatic
      "pitchBeats",
      "phasePortrait",
      "phaseMirror",
      "stereoVectorscope",
      "tuningManuscript",
      "beatingField",
      "resonantBody",
      // Color
      "pitchTonnetz",
      "waveformRing",
      "harmonicEmber",
    ],
  },
  {
    // ── Slow accreting fields: geology, textile, dust, paper, tape
    label: "LANDSCAPE",
    items: [
      // B&W / monochromatic (rock + gilt)
      "petroglyphs",
      "illuminatedGlyphs",
      "mirrorGlyphs",
      // Color
      "sediment",
      "prayerRug",
      "tapeDecay",
    ],
  },
  {
    // ── Ornate / painterly / ceremonial
    label: "RITUAL",
    items: [
      // B&W / monochromatic
      "ironFilings",
      "cymatics",
      "crystalLattice",
      // Color
      "haloGlow",
      "scryingMirror",
      "rothko",
    ],
  },
  {
    // ── Minimal negative space or stroboscopic / psychotropic
    label: "VOID / HYPNOTIC",
    items: [
      // B&W / monochromatic
      "voidMonolith",
      "moireField",
      "feedbackTunnelBW",
      "shortwaveStatic",
      // Color
      "flowField",
      "starGate",
      "dreamMachine",
    ],
  },
];

export const VISUALIZER_ORDER: readonly Visualizer[] =
  VISUALIZER_GROUPS.flatMap((g) => g.items);

export const VISUALIZER_LABELS: Record<Visualizer, string> = {
  pitchTonnetz: "PITCH TONNETZ · harmonic lattice",
  pitchBeats: "PITCH BEATS · interferometer",
  flowField: "FLOW FIELD · particle streams",
  waveformRing: "WAVEFORM RING · circular oscilloscope",
  haloGlow: "HALO & RAYS",
  mirrorGlyphs: "MIRROR GLYPHS · scrying + gilt runes",
  rothko: "ROTHKO FIELD",
  starGate: "STAR GATE",
  cymatics: "CYMATICS PLATE",
  ironFilings: "IRON FILINGS · magnetic field",
  sediment: "SEDIMENT STRATA · spectral deposit",
  prayerRug: "SPECTRAL PRAYER RUG",
  phasePortrait: "PHASE PORTRAIT · Lissajous attractor",
  phaseMirror: "PHASE MIRROR · 8-fold phase-space",
  moireField: "MOIRÉ FIELD · interference grid",
  illuminatedGlyphs: "ILLUMINATED GLYPHS · gilt runes",
  scryingMirror: "SCRYING MIRROR · Rorschach bloom",
  crystalLattice: "CRYSTAL LATTICE · accreting facets",
  dreamMachine: "DREAM MACHINE",
  resonantBody: "RESONANT BODY · voice anatomy",
  tapeDecay: "TAPE DECAY · oxide archive",
  voidMonolith: "VOID MONOLITH · pressure line",
  beatingField: "BEATING FIELD · binaural interference",
  tuningManuscript: "TUNING MANUSCRIPT · interval score",
  petroglyphs: "PETROGLYPHS",
  feedbackTunnelBW: "FEEDBACK TUNNEL",
  stereoVectorscope: "STEREO VECTORSCOPE · L×R correlation",
  harmonicEmber: "HARMONIC EMBER · burning series",
  shortwaveStatic: "SHORTWAVE STATIC · analog noise",
};

export interface AudioFrame {
  rms: number;         // 0..1
  peak: number;        // 0..1
  spectrum: Float32Array; // 32 normalized bins, 0..1
  waveform?: Uint8Array;  // raw time-domain data (128 = silence)
}

/** Active voice identities passed by MeditateView. Each entry is the
 *  effective level of that voice (0 when inactive, its mixer level
 *  otherwise). `resonantBody` blends per-voice anatomy from this;
 *  other visualizers ignore it. Undefined when engine is unavailable. */
export type VoiceWeights = {
  tanpura: number;
  reed: number;
  metal: number;
  air: number;
  piano: number;
  fm: number;
  amp: number;
  noise: number;
};

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
  /** Per-voice weights 0..1. `resonantBody` blends anatomy silhouettes
   *  from these. Undefined when no engine is wired (tests, silence). */
  voices?: VoiceWeights;
}

// ── Shared colour helpers (ember-leaning but drifting) ─────────────
function embToHsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)},${s}%,${l}%,${a})`;
}

// ─────────────────────────────────────────────────────────────────────
// 2. CYMATICS PLATE — 2D interference of a handful of cosines
// ─────────────────────────────────────────────────────────────────────
// Full-res per-pixel is expensive; instead we render a coarse grid
// and let the canvas smooth it via image scaling.
let cymatCanvas: HTMLCanvasElement | null = null;
let cymatCtx: CanvasRenderingContext2D | null = null;
let cymatData: ImageData | null = null;
// Buffer resolution — sharp nodal lines need enough pixels. 256x160
// is a 4.4x pixel count vs the old 96x64 and still runs at 30fps on
// modern hardware. Per-frame cost: ~41k pixels × 8 bands × 2 cos ≈
// 660k trig ops/frame, well under the ~3M/frame V8 can sustain.
const CYMAT_W = 256;
const CYMAT_H = 160;
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
  const spec = a.spectrum;
  const nBands = Math.min(8, spec.length);

  // Spectral centroid 0..1 warms / cools the palette.
  let num = 0, den = 0;
  for (let i = 0; i < spec.length; i++) { num += i * spec[i]; den += spec[i]; }
  const centroid = den > 0 ? (num / den) / spec.length : 0.25;

  // Amplitude response — wider range so silence is dark and loud
  // drones clearly flash the nodes bright.
  const amp = 0.15 + a.rms * 4.8 + a.peak * 2.0;

  // Grayscale palette — contrast is the whole story.
  const paletteR = 230;
  const paletteG = 230;
  const paletteB = 230;
  void centroid;

  const t = p.t;
  // Phase speed scales with RMS — the whole plate visibly vibrates
  // faster on louder drones, not just brighter.
  const phaseMul = 1 + a.rms * 7 + a.peak * 3;

  for (let y = 0; y < CYMAT_H; y++) {
    for (let x = 0; x < CYMAT_W; x++) {
      const nx = (x / CYMAT_W) * 2 - 1;
      const ny = (y / CYMAT_H) * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      const ang = Math.atan2(ny, nx);

      let v = 0;
      for (let k = 0; k < nBands; k++) {
        const e = spec[k];
        if (e < 0.03) continue;
        // Radial freq modulated by RMS so nodes densify with loudness,
        // not only long-term growth.
        const rf = 3.1 + k * 2.0 + p.growth * 1.3 + a.rms * 6;
        const af = 2 + k * 2 + Math.floor(p.growth * 3);
        v += e * Math.cos(r * rf - t * phaseMul * (0.08 + k * 0.015))
              * Math.cos(ang * af + t * phaseMul * 0.04 * ((k & 1) ? 1 : -1));
      }
      // Peak-triggered radial shockwave — a visible ripple on transients.
      if (a.peak > 0.08) {
        v += a.peak * 1.5 * Math.cos(r * (8 + a.peak * 20) - t * 2.0);
      }
      // Silent-drift baseline, now very subtle so it doesn't wash out
      // the audio reactivity.
      v += 0.05 * Math.cos(r * (2.2 + p.slow * 0.6) - t * 0.11);

      const mag = Math.min(1, Math.abs(v) * amp);
      // Smoothstep contrast — nodal lines pop, dark zones stay dark.
      const contrast = mag * mag * (3 - 2 * mag);

      const idx = (y * CYMAT_W + x) * 4;
      pix[idx]     = Math.round(paletteR * contrast);
      pix[idx + 1] = Math.round(paletteG * contrast);
      pix[idx + 2] = Math.round(paletteB * contrast);
      pix[idx + 3] = 255;
    }
  }
  cymatCtx!.putImageData(data, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cymatCanvas!, 0, 0, w, h);
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
  // Spectral centroid drives the base palette so different drones
  // land in genuinely different rooms rather than all reading as the
  // same maroon-on-black. Low-centroid (tonic-heavy) = deep maroon;
  // mid = magenta; high = ochre / amber. Slow mood drift rotates the
  // whole palette ±60° over ~150 s.
  let num = 0, den = 0;
  for (let i = 0; i < a.spectrum.length; i++) {
    num += i * a.spectrum[i];
    den += a.spectrum[i];
  }
  const centroid = den > 0 ? (num / den) / a.spectrum.length : 0.3;

  const moodPhase = p.t * 0.042;
  const hueBase = ((340 + Math.sin(moodPhase) * 60 + centroid * 50) + 720) % 360;
  const hueA = (hueBase + Math.sin(p.t * 0.017) * 24) % 360;
  const hueB = (hueBase + 18 + Math.sin(p.t * 0.013) * 22) % 360;
  const hueC = (hueBase + 42 + Math.sin(p.t * 0.021) * 18) % 360;

  // Background saturates + brightens with RMS — quiet drones matte,
  // loud drones flood the whole canvas.
  const bgSat = 48 + a.rms * 22;
  ctx.fillStyle = `hsl(${hueA}, ${bgSat}%, ${5 + a.rms * 8}%)`;
  ctx.fillRect(0, 0, w, h);

  // Block dimensions breathe visibly with RMS.
  const rmsFlex = 1 + a.rms * 0.18 + p.slow * 0.04;
  const blockW = w * 0.72 * rmsFlex;
  const blockH = h * 0.32 * rmsFlex;
  const x0 = (w - blockW) / 2;

  // Peak transients nudge the whole stack vertically.
  const shakeY = a.peak * 18;

  drawRothkoBlock(
    ctx, x0, h * 0.08 + p.slow * 12 + shakeY * Math.sin(p.t * 0.7),
    blockW, blockH * 1.05,
    hueB, 58 + centroid * 25, 30 + centroid * 15, a, p,
  );
  drawRothkoBlock(
    ctx, x0, h * 0.56 + p.slow * 8 - shakeY * 0.6,
    blockW, blockH * 0.95,
    hueC, 62 + a.rms * 20, 36 + centroid * 12, a, p,
  );

  // Peak-triggered vertical paint-bleed. On transients a faint band
  // smears across the canvas like a drip running down.
  if (a.peak > 0.22) {
    const bleedX = x0 + (Math.sin(p.t * 0.9) * 0.5 + 0.5) * blockW;
    const bleedW = 14 + a.peak * 40;
    const grad = ctx.createLinearGradient(bleedX, 0, bleedX + bleedW, 0);
    grad.addColorStop(0, `hsla(${hueB}, 70%, 58%, 0)`);
    grad.addColorStop(0.5, `hsla(${hueB}, 70%, 58%, ${0.12 * a.peak})`);
    grad.addColorStop(1, `hsla(${hueB}, 70%, 58%, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(bleedX, 0, bleedW, h);
  }

  // Scan line wobbles much harder on peaks than before.
  const scanY = h * 0.5 + Math.sin(p.t * 0.24) * h * 0.08 * (1 + a.peak * 2);
  ctx.strokeStyle = `hsla(${hueB}, 55%, 60%, ${0.12 + a.rms * 0.15})`;
  ctx.lineWidth = 1 + a.peak * 2;
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
  // Aggressive vibration — the old version was clamped ~4px; this
  // reaches ~12px on peaks with visible micro-shake so the canvas
  // feels charged rather than merely ajar.
  const vibAmp = 2 + a.peak * 9 + p.slow * 2;
  const vibX = Math.sin(p.t * 1.4) * vibAmp
             + Math.sin(p.t * 0.55) * vibAmp * 0.7
             + Math.sin(p.t * 3.1) * a.peak * 4;
  const vibY = Math.cos(p.t * 1.05) * vibAmp * 0.8
             + Math.sin(p.t * 2.7) * a.peak * 3;

  const xv = x + vibX;
  const yv = y + vibY;

  // Soft edge via stacked rectangles — more steps, stronger RMS alpha
  // bleed so loud drones genuinely bloom at the edges.
  const steps = 10;
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    const pad = t * Math.min(bw, bh) * 0.14;
    const alpha = (1 - t) * 0.22;
    const jx = Math.sin(p.t * 1.7 + s) * (1.5 + a.peak * 3);
    const jy = Math.cos(p.t * 1.3 + s) * (1.5 + a.peak * 3);
    const lw = lig + (1 - t) * 12 + a.rms * 8;
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lw}%, ${alpha + a.rms * 0.18})`;
    ctx.fillRect(xv + pad + jx, yv + pad + jy, bw - pad * 2, bh - pad * 2);
  }

  // Core fill
  const pc = Math.min(bw, bh) * 0.08;
  ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lig}%, 0.92)`;
  ctx.fillRect(xv + pc, yv + pc, bw - pc * 2, bh - pc * 2);

  // Peak-triggered horizontal stripes across the core — the block
  // "strobes" briefly on transients, then returns to calm.
  if (a.peak > 0.18) {
    const bandCount = 4;
    for (let i = 0; i < bandCount; i++) {
      const by = yv + pc + ((i + Math.sin(p.t * 2 + i)) / bandCount) * (bh - pc * 2);
      ctx.fillStyle = `hsla(${hue}, ${sat + 15}%, ${lig + 18}%, ${a.peak * 0.35})`;
      ctx.fillRect(xv + pc, by, bw - pc * 2, 1 + a.peak * 3);
    }
  }
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
  haloGlow: drawHaloGlow,
  mirrorGlyphs: drawMirrorGlyphs,
  cymatics: drawCymatics,
  dreamMachine: drawDreamMachine,
  rothko: drawRothko,
  starGate: drawStarGate,
  pitchTonnetz: drawPitchTonnetz,
  pitchBeats: drawPitchBeats,
  flowField: drawFlowField,
  waveformRing: drawWaveformRing,
  ironFilings: drawIronFilings,
  sediment: drawSediment,
  prayerRug: drawPrayerRug,
  phasePortrait: drawPhasePortrait,
  phaseMirror: drawPhaseMirror,
  moireField: drawMoireField,
  illuminatedGlyphs: drawIlluminatedGlyphs,
  scryingMirror: drawScryingMirror,
  crystalLattice: drawCrystalLattice,
  resonantBody: drawResonantBody,
  tapeDecay: drawTapeDecay,
  voidMonolith: drawVoidMonolith,
  beatingField: drawBeatingField,
  tuningManuscript: drawTuningManuscript,
  petroglyphs: drawPetroglyphs,
  feedbackTunnelBW: drawFeedbackTunnelBW,
  stereoVectorscope: drawStereoVectorscope,
  harmonicEmber: drawHarmonicEmber,
  shortwaveStatic: drawShortwaveStatic,
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
// PITCH TONNETZ — harmonic lattice
//
// Hexagonal grid of pitch classes: horizontal axis = fifths (+7),
// up-right diagonal = major thirds (+4). Each lattice cell is a
// pitch class; active pitches light nodes; interval pairs light
// edges; chord triangles read visually as small lit shapes.
// ─────────────────────────────────────────────────────────────────────
const PITCH_LABELS = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
export function drawPitchTonnetz(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.17)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const spacing = Math.min(w, h) * 0.1;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(p.t * 0.015) * (0.035 + a.rms * 0.06));

  const energies = p.activePitches;
  const UX = spacing, UY = 0;
  const VX = spacing * 0.5, VY = -spacing * 0.866;

  for (let v = -3; v <= 3; v++) {
    for (let u = -4; u <= 4; u++) {
      const x = u * UX + v * VX;
      const y = u * UY + v * VY;
      if (Math.abs(x) > w * 0.48 || Math.abs(y) > h * 0.48) continue;
      const pc = (((u * 7 + v * 4) % 12) + 12) % 12;
      const e = energies[pc];

      // Edge east (fifth)
      const ex = (u + 1) * UX + v * VX;
      const ey = (u + 1) * UY + v * VY;
      const ePc = (((u * 7 + v * 4 + 7) % 12) + 12) % 12;
      const eEn = energies[ePc];
      if (e > 0.12 && eEn > 0.12) {
        ctx.strokeStyle = `hsla(0, 0%, 90%, ${Math.min(0.6, (e + eEn) * 0.25)})`;
        ctx.lineWidth = 0.8 + Math.min(2, (e + eEn) * 1.4);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      // Edge up-right (major third)
      const ux = u * UX + (v + 1) * VX;
      const uy = u * UY + (v + 1) * VY;
      const uPc = (((u * 7 + (v + 1) * 4) % 12) + 12) % 12;
      const uEn = energies[uPc];
      if (e > 0.12 && uEn > 0.12) {
        ctx.strokeStyle = `hsla(0, 0%, 90%, ${Math.min(0.6, (e + uEn) * 0.25)})`;
        ctx.lineWidth = 0.8 + Math.min(2, (e + uEn) * 1.4);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ux, uy);
        ctx.stroke();
      }
    }
  }

  for (let v = -3; v <= 3; v++) {
    for (let u = -4; u <= 4; u++) {
      const x = u * UX + v * VX;
      const y = u * UY + v * VY;
      if (Math.abs(x) > w * 0.48 || Math.abs(y) > h * 0.48) continue;
      const pc = (((u * 7 + v * 4) % 12) + 12) % 12;
      const e = energies[pc];

      ctx.fillStyle = `hsla(0, 0%, 35%, ${0.25 + e * 0.1})`;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      if (e > 0.06) {
        const gR = 6 + e * 22;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, gR);
        grad.addColorStop(0, `hsla(0, 0%, 100%, ${Math.min(1, e * 0.9 + 0.25)})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, gR, 0, Math.PI * 2);
        ctx.fill();
        if (e > 0.25) {
          ctx.fillStyle = `hsla(0, 0%, 100%, ${e * 0.5})`;
          ctx.font = "10px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(PITCH_LABELS[pc], x, y);
        }
      }
    }
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────
// PITCH BEATS — interferometer
//
// Each active pitch draws a ring at a distinct radius, with fringe
// oscillations whose rate depends on the interval to the nearest
// other active pitch (close intervals → slow wide fringes, far
// intervals → tight). Pairwise moiré bands render the visual
// "beating" between every active pair.
// ─────────────────────────────────────────────────────────────────────
let pitchBeatsShock = 0;
let prevPitchBeatsPeak = 0;
export function drawPitchBeats(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
  ctx.fillRect(0, 0, w, h);

  const energies = p.activePitches;
  const actives: { pc: number; e: number; r: number }[] = [];
  for (let pc = 0; pc < 12; pc++) {
    if (energies[pc] > 0.08) actives.push({ pc, e: energies[pc], r: 0 });
  }
  actives.sort((x, y) => x.pc - y.pc);

  const cx = w / 2;
  const cy = h / 2;
  const rMax = Math.min(w, h) * 0.48;

  // Peak-triggered shockwave — a bright expanding ring that travels
  // outward each time the drone spikes. Decays each frame.
  if (a.peak > prevPitchBeatsPeak + 0.06) pitchBeatsShock = 1;
  prevPitchBeatsPeak = a.peak;
  pitchBeatsShock *= 0.94;

  ctx.save();
  ctx.translate(cx, cy);
  // Slow rotation of the whole interferometer, accelerated by RMS.
  ctx.rotate(p.t * (0.04 + a.rms * 0.12));

  // Silent-state baseline ring so the canvas is never empty.
  if (actives.length === 0) {
    ctx.strokeStyle = `rgba(180, 180, 180, ${0.12 + a.rms * 0.1})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, rMax * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Per-pitch ring radius pulses with its own energy so the stack
  // breathes rather than sitting static.
  for (let i = 0; i < actives.length; i++) {
    const base = rMax * (0.18 + (i / Math.max(1, actives.length - 1)) * 0.7);
    const pulse = Math.sin(p.t * (0.6 + i * 0.25) + i) * 6 * (0.3 + actives[i].e);
    actives[i].r = base + pulse + a.rms * 10;
  }

  for (let i = 0; i < actives.length; i++) {
    const { pc, e, r } = actives[i];
    const fringeCount = 18 + Math.floor(e * 14);
    let minDist = 12;
    for (let j = 0; j < actives.length; j++) {
      if (j === i) continue;
      const d = Math.min(
        Math.abs(actives[j].pc - pc),
        12 - Math.abs(actives[j].pc - pc),
      );
      if (d < minDist) minDist = d;
    }
    // Beat rate now scales with RMS too — loud drones make the fringes
    // actually sweep around the ring, not just hint at motion.
    const beatRate = (0.15 + minDist * 0.12) * (1 + a.rms * 4 + a.peak * 3);
    const fringePhase = p.t * beatRate;

    for (let f = 0; f < fringeCount; f++) {
      const fr = r + Math.sin(fringePhase + f * 0.55 + pc * 0.3) * (8 + minDist * 2);
      const alpha = (1 - f / fringeCount) * (0.15 + e * 0.45);
      ctx.strokeStyle = `rgba(235, 235, 235, ${alpha})`;
      ctx.lineWidth = 0.8 + e * 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, fr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Angular lobed overlay — breaks the pure-circle geometry so the
    // ring visibly breathes non-isotropically.
    const lobes = 2 + (pc % 4);
    ctx.strokeStyle = `rgba(245, 245, 245, ${Math.min(0.8, e * 0.7 + 0.25)})`;
    ctx.lineWidth = 1.4 + e * 1.2;
    ctx.beginPath();
    const steps = 72;
    for (let s = 0; s <= steps; s++) {
      const ang = (s / steps) * Math.PI * 2;
      const lobeMod = 1 + Math.sin(ang * lobes + p.t * (0.8 + minDist * 0.3)) * 0.04 * (0.5 + e + a.rms);
      const rr = r * lobeMod;
      const x = Math.cos(ang) * rr;
      const y = Math.sin(ang) * rr;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Pairwise moiré — the angular moiré phase now rotates with time
  // and scales with RMS, so close pitches produce visibly sweeping
  // interference bands.
  for (let i = 0; i < actives.length; i++) {
    for (let j = i + 1; j < actives.length; j++) {
      const mid = (actives[i].r + actives[j].r) * 0.5;
      const gap = Math.abs(actives[j].r - actives[i].r);
      const bands = 6;
      const beatRate = 0.8 + a.rms * 3;
      for (let b = 0; b < bands; b++) {
        const phase = p.t * beatRate + b * 0.9;
        const off = Math.sin(phase) * gap * 0.35;
        const alpha = (1 - b / bands) * 0.1 * Math.min(1, actives[i].e + actives[j].e);
        ctx.strokeStyle = `rgba(230, 215, 175, ${alpha})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, mid + off, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // Radial sweeps — spokes that rotate, creating cross-interference
  // with the ring stripes. A proper interferometer has both radial
  // and angular axes.
  const sweeps = Math.min(8, actives.length * 2);
  ctx.strokeStyle = `rgba(220, 220, 220, ${0.12 + a.rms * 0.25})`;
  ctx.lineWidth = 0.6;
  for (let k = 0; k < sweeps; k++) {
    const ang = (k / sweeps) * Math.PI * 2 + p.t * (0.5 + a.rms);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(ang) * rMax, Math.sin(ang) * rMax);
    ctx.stroke();
  }

  // Expanding peak shockwave — a bright ring that travels outward
  // each time the drone spikes.
  if (pitchBeatsShock > 0.02) {
    const shockR = (1 - pitchBeatsShock) * rMax * 1.1 + 10;
    ctx.strokeStyle = `rgba(255, 255, 255, ${pitchBeatsShock * 0.7})`;
    ctx.lineWidth = 1 + pitchBeatsShock * 2;
    ctx.beginPath();
    ctx.arc(0, 0, shockR, 0, Math.PI * 2);
    ctx.stroke();
  }

  let totalE = 0;
  for (const { e } of actives) totalE += e;
  const coreR = 4 + Math.min(18, totalE * 3 + a.rms * 10 + pitchBeatsShock * 12);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
  core.addColorStop(0, `rgba(255, 255, 255, ${0.7 + a.peak * 0.3})`);
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
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
// Flow-field particle (band tag picks palette: 0=low/copper, 1=mid/
// bone, 2=high/ash). emitter flag marks particles spawned from the
// peak-triggered central source so we can style them brighter.
const flowParticles: {
  x: number; y: number; px: number; py: number;
  life: number; maxLife: number; size: number;
  band: 0 | 1 | 2; emitter: boolean;
}[] = [];
let flowPeakFlash = 0;
let prevFlowPeak = 0;
export function drawFlowField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: AudioFrame,
  p: PhaseClock,
): void {
  const rms = a.rms;
  const time = p.t;

  // Cream/ink fade. Slow — particles leave strokes that persist for
  // several seconds so the flow field reads as a drawing being
  // inscribed, not a dot cloud.
  ctx.fillStyle = `rgba(10, 8, 6, ${0.03 + (1 - rms) * 0.04})`;
  ctx.fillRect(0, 0, w, h);

  if (a.peak > prevFlowPeak + 0.1) flowPeakFlash = 1;
  prevFlowPeak = a.peak;
  flowPeakFlash *= 0.92;

  // ── Band split — drives per-particle palette / spawn weight
  let low = 0, mid = 0, high = 0;
  for (let i = 0; i < 8; i++) low += a.spectrum[i] ?? 0;
  for (let i = 8; i < 20; i++) mid += a.spectrum[i] ?? 0;
  for (let i = 20; i < 32; i++) high += a.spectrum[i] ?? 0;
  low /= 8; mid /= 12; high /= 12;
  const bandTotal = low + mid + high + 1e-6;
  const wLow  = low  / bandTotal;
  const wHigh = high / bandTotal;

  // ── Pitch centroid as stronger directional pull (1.0 scaled, not 0.4)
  let pitchCx = 0, pitchCy = 0, pitchMass = 0;
  for (let i = 0; i < 12; i++) {
    const e = p.activePitches[i];
    const ang = (i / 12) * Math.PI * 2;
    pitchCx += Math.cos(ang) * e;
    pitchCy += Math.sin(ang) * e;
    pitchMass += e;
  }
  const pitchAng = pitchMass > 0.01 ? Math.atan2(pitchCy, pitchCx) : 0;
  const pitchPull = Math.min(0.9, pitchMass * 0.7);

  // ── Spawning — denser strokes overall. Peak-triggered central
  //    emitter bursts emit tight particle fans aimed outward.
  const spawnRate = rms * rms * 22 + 2;
  for (let s = 0; s < spawnRate && flowParticles.length < 380; s++) {
    const fromCentre = flowPeakFlash > 0.3 && Math.random() < 0.55;
    const x = fromCentre ? w / 2 : Math.random() * w;
    const y = fromCentre ? h / 2 : Math.random() * h;
    // Band assignment — weighted by spectral shape so spectrum shows
    // in the palette. Rolling the die in normalized band-weight space.
    const r = Math.random();
    const band: 0 | 1 | 2 = r < wLow ? 0 : r < (wLow + 0.4 + wHigh * 0.2) ? 1 : 2;
    flowParticles.push({
      x, y, px: x, py: y,
      life: 0, maxLife: 140 + Math.random() * 220,
      size: 0.5 + Math.random() * (band === 0 ? 2.0 : band === 1 ? 1.4 : 0.9),
      band,
      emitter: fromCentre,
    });
  }

  // ── Curl noise — sample noise at two offset points and take a
  //    finite-difference curl so the velocity field is divergence-
  //    free (fluid-like, not radial). Much more "drone smoke" feel.
  const fieldScale = 0.004;
  const fieldSpeed = 0.4 + rms * 3.5 + flowPeakFlash * 2.5;
  const eps = 0.0018;
  ctx.lineCap = "round";
  for (let i = flowParticles.length - 1; i >= 0; i--) {
    const fp = flowParticles[i];
    fp.px = fp.x; fp.py = fp.y;
    const x0 = fp.x * fieldScale + time * 0.06;
    const y0 = fp.y * fieldScale + time * 0.03;
    // Curl noise: (∂ψ/∂y, −∂ψ/∂x) of a scalar potential ψ = flowNoise.
    const na = flowNoise(x0, y0 + eps);
    const nb = flowNoise(x0, y0 - eps);
    const nc = flowNoise(x0 + eps, y0);
    const nd = flowNoise(x0 - eps, y0);
    let vx = (na - nb) / (2 * eps);
    let vy = -(nc - nd) / (2 * eps);
    // Normalize and rotate by pitch centroid angle
    const vl = Math.hypot(vx, vy) + 1e-6;
    vx /= vl; vy /= vl;
    // Blend with pitch-pull direction
    if (pitchPull > 0) {
      const px = Math.cos(pitchAng), py = Math.sin(pitchAng);
      vx = vx * (1 - pitchPull) + px * pitchPull;
      vy = vy * (1 - pitchPull) + py * pitchPull;
      const vl2 = Math.hypot(vx, vy) + 1e-6;
      vx /= vl2; vy /= vl2;
    }
    fp.x += vx * fieldSpeed;
    fp.y += vy * fieldSpeed;
    fp.life++;
    if (fp.life >= fp.maxLife || fp.x < -10 || fp.x > w + 10 || fp.y < -10 || fp.y > h + 10) {
      flowParticles.splice(i, 1);
      continue;
    }
    const t = fp.life / fp.maxLife;
    const alpha = (t < 0.1 ? t / 0.1 : t > 0.7 ? (1 - t) / 0.3 : 1);
    // Band → palette. Copper/ember for lows, bone for mids, ash-grey
    // for highs. Emitter particles are always warmer + brighter.
    let r255: number, g255: number, b255: number;
    if (fp.emitter) {
      r255 = 245; g255 = 210; b255 = 160;
    } else if (fp.band === 0) {
      r255 = 190 + Math.round(low * 45); g255 = 135 + Math.round(low * 25); b255 = 90;
    } else if (fp.band === 1) {
      r255 = 210 + Math.round(mid * 35); g255 = 196 + Math.round(mid * 30); b255 = 170 + Math.round(mid * 20);
    } else {
      const gy = 180 + Math.round(high * 60);
      r255 = gy; g255 = gy; b255 = gy - 12;
    }
    ctx.strokeStyle = `rgba(${r255},${g255},${b255},${alpha * (0.32 + rms * 0.65 + (fp.emitter ? 0.2 : 0))})`;
    ctx.lineWidth = fp.size + rms * 1.4 + flowPeakFlash * 1.2 + (fp.emitter ? 0.4 : 0);
    ctx.beginPath();
    ctx.moveTo(fp.px, fp.py);
    ctx.lineTo(fp.x, fp.y);
    ctx.stroke();
  }

  // ── Pitch-centroid anchor — a faint glyph at the centroid location,
  //    visible only when mass > 0. Anchors the flow to a point so the
  //    visualizer reads as "wind around a held note", not formless.
  if (pitchMass > 0.15) {
    const cx = w / 2 + Math.cos(pitchAng) * Math.min(w, h) * 0.22;
    const cy = h / 2 + Math.sin(pitchAng) * Math.min(w, h) * 0.22;
    const ar = 4 + pitchMass * 4;
    const ag = ctx.createRadialGradient(cx, cy, 0, cx, cy, ar * 4);
    ag.addColorStop(0, `hsla(28, 60%, 60%, ${Math.min(0.35, pitchMass * 0.25)})`);
    ag.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ag;
    ctx.fillRect(cx - ar * 4, cy - ar * 4, ar * 8, ar * 8);
  }
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



// ═══════════════════════════════════════════════════════════════════════
// ORIGINAL DRONE VISUALIZERS — accretive, matte, heavy. No glow, no
// hue-from-audio, no per-frame fast reactivity. Each one accrues over
// minutes of listening.
// ═══════════════════════════════════════════════════════════════════════


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

let filingsShock = 0;
let prevFilingsPeak = 0;
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
  const phi = p.t * 0.05 + p.slow * 1.6;
  let active = 0;
  for (let i = 0; i < a.spectrum.length; i++) if (a.spectrum[i] > 0.1) active++;
  const spectrumWidth = active / a.spectrum.length;
  const swirl = 0.15 + spectrumWidth * 1.1 + a.rms * 0.6;

  // Active-pitch centroid places a second, orbiting pole — different
  // chords push the pole to different positions so the field pattern
  // visibly reshapes with the drone's harmony.
  let pitchX = 0, pitchY = 0, pitchMass = 0;
  for (let i = 0; i < 12; i++) {
    const e = p.activePitches[i];
    const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
    pitchX += Math.cos(ang) * e;
    pitchY += Math.sin(ang) * e;
    pitchMass += e;
  }
  const poleAng = pitchMass > 0.01 ? Math.atan2(pitchY, pitchX) : p.t * 0.1;
  const poleR = Math.min(w, h) * (0.22 + 0.12 * Math.min(1, pitchMass));
  const poleX = cx + Math.cos(poleAng + p.t * 0.1) * poleR;
  const poleY = cy + Math.sin(poleAng + p.t * 0.1) * poleR;

  // Peak shockwave — a brief moment where every filament radiates
  // outward from the centre regardless of the field.
  if (a.peak > prevFilingsPeak + 0.08) filingsShock = 1;
  prevFilingsPeak = a.peak;
  filingsShock *= 0.9;

  const positions = filingsPositions;
  const spec = a.spectrum;
  const bins = spec.length;
  ctx.lineCap = "round";
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    // Local jitter so the grid breathes instead of sitting static
    const jx = Math.sin(p.t * 2 + i * 0.7) * a.rms * 1.2;
    const jy = Math.cos(p.t * 1.7 + i * 0.9) * a.rms * 1.2;
    const px = pos.x + jx;
    const py = pos.y + jy;

    // Field direction — weighted sum of radials from centre + orbiting pole
    const dx1 = px - cx, dy1 = py - cy;
    const d1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) + 1;
    const dx2 = px - poleX, dy2 = py - poleY;
    const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) + 1;
    const w1 = 1 / d1;
    const w2 = (0.8 + pitchMass * 0.6) / d2;
    const ang1 = Math.atan2(dy1, dx1);
    const ang2 = Math.atan2(dy2, dx2);
    // Vector-average the two field angles
    const sx = Math.cos(ang1) * w1 + Math.cos(ang2) * w2;
    const sy = Math.sin(ang1) * w1 + Math.sin(ang2) * w2;
    let theta = Math.atan2(sy, sx) + swirl * Math.sin(d1 * 0.012 - phi);

    // Peak shockwave overrides toward pure radial alignment
    if (filingsShock > 0.05) {
      theta = ang1 * filingsShock + theta * (1 - filingsShock);
    }

    // Per-filament brightness + length from spectrum bin sampled at grid position
    const bin = (i * 7) % bins;
    const e = spec[bin] ?? 0;
    const fieldStrength = Math.min(1, (w1 + w2) * 60);
    const len = 5 + fieldStrength * 3 + e * 6 + a.rms * 3;
    const gray = Math.round(130 + e * 100 + a.peak * 40);
    ctx.strokeStyle = `rgb(${gray}, ${Math.min(255, gray - 5)}, ${Math.max(0, gray - 20)})`;
    ctx.lineWidth = 0.7 + e * 1.2;

    const hx = Math.cos(theta) * len * 0.5;
    const hy = Math.sin(theta) * len * 0.5;
    ctx.beginPath();
    ctx.moveTo(px - hx, py - hy);
    ctx.lineTo(px + hx, py + hy);
    ctx.stroke();
  }

  // Poles intentionally invisible — the field they shape reveals them.

  // Peak shockwave ring
  if (filingsShock > 0.05) {
    const shockR = (1 - filingsShock) * Math.min(w, h) * 0.55 + 8;
    ctx.strokeStyle = `rgba(240, 230, 210, ${filingsShock * 0.45})`;
    ctx.lineWidth = 1 + filingsShock * 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, shockR, 0, Math.PI * 2);
    ctx.stroke();
  }
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


// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// SPECTRAL PRAYER RUG — the spectrum weaves persistent thread rows.
// It is intentionally textile-like: slow, worn, symmetrical, accretive.
// ─────────────────────────────────────────────────────────────────────
let rugCanvas: HTMLCanvasElement | null = null;
let rugCtx: CanvasRenderingContext2D | null = null;
let rugOffset = 0;
export function drawPrayerRug(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  a: AudioFrame, p: PhaseClock,
): void {
  if (!rugCanvas || rugCanvas.width !== w || rugCanvas.height !== h) {
    rugCanvas = document.createElement("canvas");
    rugCanvas.width = w; rugCanvas.height = h;
    rugCtx = rugCanvas.getContext("2d");
    rugCtx?.fillRect(0, 0, w, h);
    rugOffset = 0;
  }
  const off = rugCtx!;
  rugOffset += 0.08 + a.rms * 0.16;
  const rows = Math.floor(rugOffset);
  rugOffset -= rows;
  if (rows > 0 && h - rows > 0) {
    const img = off.getImageData(0, rows, w, h - rows);
    off.putImageData(img, 0, 0);
    for (let y = h - rows; y < h; y++) {
      off.fillStyle = "#17100c";
      off.fillRect(0, y, w, 1);
      for (let x = 0; x < w / 2; x += 3) {
        const u = x / (w / 2);
        const bin = Math.min(31, Math.floor(u * a.spectrum.length));
        const e = a.spectrum[bin] ?? 0;
        const knot = Math.sin(u * Math.PI * (6 + Math.floor(p.growth * 8)) + p.t * 0.08);
        const lig = 13 + e * 38 + (knot > 0 ? 6 : 0);
        const hue = p.mood.hue + (u - 0.5) * 36;
        off.fillStyle = `hsla(${hue}, ${18 + e * 42}%, ${lig}%, ${0.45 + e * 0.45})`;
        off.fillRect(x, y, 2, 1);
        off.fillRect(w - x - 2, y, 2, 1);
      }
    }
  }
  ctx.drawImage(rugCanvas, 0, 0);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(0, 0, w, h);
}

// ═══════════════════════════════════════════════════════════════════════
// GAP-FILLING VISUALIZERS (2026-04)
// Phase-space / fluid / ritual construction / moiré / illuminated /
// mirror / incense / crystal.
// ═══════════════════════════════════════════════════════════════════════

// PHASE PORTRAIT — XY plot of waveform vs delayed self. Pure sine
// closes into an ellipse; rich drone traces a rosette; microtonal
// beating makes the curve slowly precess.
const PHASE_TRAIL = 1600;
// 3 floats per point (x, y, z). Samples are plotted in 3-space against
// two delay taps; a slowly-rotating projection gives the curve visible
// orientation change over time.
const phaseTrail = new Float32Array(PHASE_TRAIL * 3);
let phaseHead = 0, phaseLen = 0;
export function drawPhasePortrait(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)"; ctx.fillRect(0, 0, w, h);
  const wf = a.waveform;
  if (!wf || wf.length < 64) return;
  const cx = w / 2, cy = h / 2;
  const scale = Math.min(w, h) * 0.42;
  const tau1 = 12, tau2 = 27;
  for (let i = tau2; i < wf.length; i++) {
    const x = (wf[i] - 128) / 128;
    const y = (wf[i - tau1] - 128) / 128;
    const z = (wf[i - tau2] - 128) / 128;
    phaseTrail[phaseHead * 3] = x;
    phaseTrail[phaseHead * 3 + 1] = y;
    phaseTrail[phaseHead * 3 + 2] = z;
    phaseHead = (phaseHead + 1) % PHASE_TRAIL;
    if (phaseLen < PHASE_TRAIL) phaseLen++;
  }
  // 3D orientation — three incommensurate rotation rates so the axis
  // of rotation itself slowly drifts, never repeating. RMS accelerates
  // all three so louder drones tumble faster.
  const speed = 1 + a.rms * 2;
  const ax = p.t * 0.04 * speed;
  const ay = p.t * 0.029 * speed + Math.sin(p.t * 0.011) * 0.4;
  const az = p.t * 0.017 * speed;
  const cxR = Math.cos(ax), sxR = Math.sin(ax);
  const cyR = Math.cos(ay), syR = Math.sin(ay);
  const czR = Math.cos(az), szR = Math.sin(az);
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(225, 225, 225, ${0.35 + a.rms * 0.4})`;
  ctx.beginPath();
  for (let i = 0; i < phaseLen; i++) {
    const base = ((phaseHead - phaseLen + i + PHASE_TRAIL) % PHASE_TRAIL) * 3;
    let x = phaseTrail[base];
    let y = phaseTrail[base + 1];
    let z = phaseTrail[base + 2];
    // Rotate X then Y then Z
    let ny = y * cxR - z * sxR;
    let nz = y * sxR + z * cxR;
    y = ny; z = nz;
    let nx = x * cyR + z * syR;
    nz = -x * syR + z * cyR;
    x = nx; z = nz;
    nx = x * czR - y * szR;
    ny = x * szR + y * czR;
    x = nx; y = ny;
    const persp = 1 + z * 0.3;
    const px = cx + x * scale * persp;
    const py = cy + y * scale * persp;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 24);
  core.addColorStop(0, `rgba(240, 240, 240, ${0.5 + a.peak * 0.4})`);
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fill();
}

// PHASE MIRROR — 8-fold central mirror of the phase portrait. The 3D
// curve is rendered once per orthant with signs flipped on x, y, z,
// yielding triple-axis symmetry around the origin. Kaleidoscopic sibling
// of PHASE PORTRAIT — same data, eight views.
export function drawPhaseMirror(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)"; ctx.fillRect(0, 0, w, h);
  const wf = a.waveform;
  if (!wf || wf.length < 64) return;
  const cx = w / 2, cy = h / 2;
  const scale = Math.min(w, h) * 0.38;
  const tau1 = 12, tau2 = 27;
  for (let i = tau2; i < wf.length; i++) {
    const x = (wf[i] - 128) / 128;
    const y = (wf[i - tau1] - 128) / 128;
    const z = (wf[i - tau2] - 128) / 128;
    phaseTrail[phaseHead * 3] = x;
    phaseTrail[phaseHead * 3 + 1] = y;
    phaseTrail[phaseHead * 3 + 2] = z;
    phaseHead = (phaseHead + 1) % PHASE_TRAIL;
    if (phaseLen < PHASE_TRAIL) phaseLen++;
  }
  const speed = 1 + a.rms * 2;
  const ax = p.t * 0.04 * speed;
  const ay = p.t * 0.029 * speed;
  const az = p.t * 0.017 * speed;
  const cxR = Math.cos(ax), sxR = Math.sin(ax);
  const cyR = Math.cos(ay), syR = Math.sin(ay);
  const czR = Math.cos(az), szR = Math.sin(az);
  const mirrors: Array<[number, number, number]> = [
    [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1],
    [1, 1, -1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1],
  ];
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(220, 220, 220, ${0.18 + a.rms * 0.25})`;
  for (let m = 0; m < 8; m++) {
    const [mx, my, mz] = mirrors[m];
    ctx.beginPath();
    for (let i = 0; i < phaseLen; i++) {
      const base = ((phaseHead - phaseLen + i + PHASE_TRAIL) % PHASE_TRAIL) * 3;
      let x = phaseTrail[base] * mx;
      let y = phaseTrail[base + 1] * my;
      let z = phaseTrail[base + 2] * mz;
      let ny = y * cxR - z * sxR;
      let nz = y * sxR + z * cxR;
      y = ny; z = nz;
      let nx = x * cyR + z * syR;
      nz = -x * syR + z * cyR;
      x = nx; z = nz;
      nx = x * czR - y * szR;
      ny = x * szR + y * czR;
      x = nx; y = ny;
      const persp = 1 + z * 0.3;
      const px = cx + x * scale * persp;
      const py = cy + y * scale * persp;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
  core.addColorStop(0, `rgba(240, 240, 240, ${0.55 + a.peak * 0.35})`);
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
}



// MOIRÉ FIELD — two overlaid rotating grids. Differential rotation
// + spacing (driven by low/high spectrum bands) produce slow sweeping
// fringes across the whole canvas.
export function drawMoireField(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(7, 5, 5, 0.18)"; ctx.fillRect(0, 0, w, h);
  const spec = a.spectrum;
  let low = 0, high = 0;
  for (let i = 0; i < 8; i++) low += spec[i];
  for (let i = 16; i < 32; i++) high += spec[i];
  low /= 8; high /= 16;
  const drawGrid = (rot: number, spacing: number, alpha: number, gray: number) => {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rot);
    ctx.strokeStyle = `rgba(${gray},${gray},${gray},${alpha})`;
    ctx.lineWidth = 0.8;
    const reach = Math.hypot(w, h);
    for (let d = -reach; d <= reach; d += spacing) {
      ctx.beginPath();
      ctx.moveTo(-reach, d);
      ctx.lineTo(reach, d);
      ctx.stroke();
    }
    ctx.restore();
  };
  const base = 14 + Math.sin(p.t * 0.04) * 2;
  drawGrid(p.t * 0.008, base, 0.25 + a.rms * 0.2, 230);
  drawGrid(
    p.t * 0.008 + 0.03 + low * 0.04,
    base * (1 + 0.04 + high * 0.12),
    0.25 + a.rms * 0.2,
    190,
  );
}

// ILLUMINATED GLYPHS — gilt runes placed on dark vellum. 12 authored
// shapes (one per pitch class). Multi-pitch chords stack multiple
// glyphs; peaks fire a ring of smaller glyphs around the freshest
// one. Drifting gilt sparks keep the vellum alive between placements.
let glyphCanvas: HTMLCanvasElement | null = null;
let glyphCtx: CanvasRenderingContext2D | null = null;
let glyphLast = 0;
let glyphPrevPeak = 0;
// 24 rune shapes — two variants per pitch class. Each glyph is a
// list of poly-lines in normalized [-1, 1] space. Indexing: the
// first 12 are the original canonical runes (one per pc), the
// second 12 are alternates chosen 50/50 at placement time so the
// page accumulates visual variety.
const GLYPH_STROKES: number[][][] = [
  // ── Canonical 12 (original) ──────────────────────────────────
  [[0, -1, 0, 1]],
  [[-1, 0, 0, -1, 1, 0, 0, 1, -1, 0]],
  [[-1, -1, 1, 1], [-1, 1, 1, -1]],
  [[0, -1, 0, 0, -0.8, 0.8], [0, 0, 0.8, 0.8]],
  [[-0.9, -0.9, 0.9, -0.9, 0, 0.9, -0.9, -0.9]],
  [[-1, -1, 1, -1, 1, 1, -1, 1, -1, -1]],
  [[-1, 0, 1, 0], [0, -1, 0, 1]],
  [[-1, 1, 0, -1, 1, 1]],
  [[-0.7, -1, -0.7, 1], [0.7, -1, 0.7, 1], [-0.7, 0, 0.7, 0]],
  [[-1, -0.5, 0, -1, 1, -0.5, 0, 0.5, -1, -0.5], [0, 0.5, 0, 1]],
  [[-0.9, 0.9, 0, -0.9, 0.9, 0.9], [-0.5, 0, 0.5, 0]],
  [[-1, -1, 1, -1], [0, -1, 0, 1], [-0.6, 1, 0.6, 1]],
  // ── Alternates 12 ────────────────────────────────────────────
  // 12 ankh — small loop atop vertical + crossbar
  [[0, -0.6, 0.4, -0.3, 0.4, 0, 0, 0.2, -0.4, 0, -0.4, -0.3, 0, -0.6],
   [0, 0.2, 0, 1], [-0.6, 0.4, 0.6, 0.4]],
  // 13 three solid bars (I-Ching)
  [[-0.8, -0.6, 0.8, -0.6], [-0.8, 0, 0.8, 0], [-0.8, 0.6, 0.8, 0.6]],
  // 14 pentagram — single-line 5-point star
  [[0, -1, 0.588, 0.809, -0.951, -0.309, 0.951, -0.309, -0.588, 0.809, 0, -1]],
  // 15 inward zigzag spiral
  [[-0.9, 0.9, 0.9, 0.9, 0.9, -0.3, -0.3, -0.3, -0.3, 0.3, 0.3, 0.3]],
  // 16 double-V chevrons
  [[-0.8, -0.4, 0, 0.2, 0.8, -0.4], [-0.8, 0.2, 0, 0.8, 0.8, 0.2]],
  // 17 trident
  [[-0.5, -0.8, -0.5, 0], [0, -0.8, 0, 0.3], [0.5, -0.8, 0.5, 0],
   [-0.5, 0, 0.5, 0], [0, 0.3, 0, 1]],
  // 18 lightning bolt
  [[-0.4, -1, 0.2, -0.2, -0.3, 0.1, 0.4, 1]],
  // 19 crescent (outer arc)
  [[0.4, -0.9, -0.2, -0.6, -0.6, 0, -0.2, 0.6, 0.4, 0.9]],
  // 20 psychic cross (vertical + three equal horizontal bars)
  [[0, -1, 0, 1],
   [-0.55, -0.45, 0.55, -0.45],
   [-0.55, 0, 0.55, 0],
   [-0.55, 0.45, 0.55, 0.45]],
  // 21 eight-ray star (cross + X)
  [[0, -1, 0, 1], [-1, 0, 1, 0],
   [-0.7, -0.7, 0.7, 0.7], [-0.7, 0.7, 0.7, -0.7]],
  // 22 concentric diamonds
  [[0, -1, 1, 0, 0, 1, -1, 0, 0, -1],
   [0, -0.5, 0.5, 0, 0, 0.5, -0.5, 0, 0, -0.5]],
  // 23 sun — small square centre + 8 short rays
  [[-0.3, -0.3, 0.3, -0.3, 0.3, 0.3, -0.3, 0.3, -0.3, -0.3],
   [0, -0.7, 0, -0.45], [0, 0.45, 0, 0.7],
   [-0.7, 0, -0.45, 0], [0.45, 0, 0.7, 0],
   [-0.55, -0.55, -0.35, -0.35], [0.55, -0.55, 0.35, -0.35],
   [-0.55, 0.55, -0.35, 0.35], [0.55, 0.55, 0.35, 0.35]],
];
function pickGlyphIdx(pc: number): number {
  return (pc + (Math.random() < 0.5 ? 0 : 12)) % 24;
}
// Recent glyph placements — live overlay breathes halos around them.
interface RecentGlyph { x: number; y: number; sz: number; pc: number; age: number; }
const recentGlyphs: RecentGlyph[] = [];
// Drifting gilt sparks — ambient firefly layer so the vellum is
// never fully still.
interface GlyphSpark { x: number; y: number; vx: number; vy: number; life: number; }
const glyphSparks: GlyphSpark[] = [];
function ensureGlyph(w: number, h: number) {
  if (!glyphCanvas || glyphCanvas.width !== w || glyphCanvas.height !== h) {
    glyphCanvas = document.createElement("canvas");
    glyphCanvas.width = w; glyphCanvas.height = h;
    glyphCtx = glyphCanvas.getContext("2d");
    glyphCtx!.fillStyle = "#0d0906"; glyphCtx!.fillRect(0, 0, w, h);
    recentGlyphs.length = 0;
    glyphSparks.length = 0;
  }
}
function stampGlyph(
  g: CanvasRenderingContext2D,
  gx: number, gy: number, sz: number, pc: number, energy: number,
  growth: number,
) {
  const strokes = GLYPH_STROKES[pickGlyphIdx(pc)];
  g.save();
  g.translate(gx, gy);
  g.lineWidth = 1.4 + energy * 1.8;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = `hsla(42, ${60 + energy * 20}%, ${62 + energy * 12}%, 0.85)`;
  g.shadowColor = "rgba(240, 164, 91, 0.55)";
  g.shadowBlur = 8 + energy * 6;
  for (const path of strokes) {
    g.beginPath();
    for (let i = 0; i < path.length; i += 2) {
      const px = path[i] * sz;
      const py = path[i + 1] * sz;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
  }
  if (growth > 0.4) {
    g.strokeStyle = `hsla(38, 65%, 55%, ${0.3 + growth * 0.3})`;
    g.lineWidth = 0.8;
    g.shadowBlur = 2;
    g.beginPath();
    g.arc(0, 0, sz * 1.55, 0, Math.PI * 2);
    g.stroke();
  }
  // Growth tier 2 (>0.7): add a faint inner ring for extra decoration
  if (growth > 0.7) {
    g.strokeStyle = `hsla(45, 70%, 65%, ${(growth - 0.7) * 0.8})`;
    g.lineWidth = 0.6;
    g.shadowBlur = 1;
    g.beginPath();
    g.arc(0, 0, sz * 1.2, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}
export function drawIlluminatedGlyphs(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  ensureGlyph(w, h);
  const g = glyphCtx!;
  // Slow vellum fade — glyphs persist for many seconds but don't
  // saturate the canvas forever.
  g.fillStyle = "rgba(13, 9, 6, 0.012)";
  g.fillRect(0, 0, w, h);

  const now = p.t;
  const dt = p.dtScale ?? 1;

  // Spawn cadence — louder drones place glyphs more frequently.
  // Was 1.5 - rms*0.6 → min ~0.9s. Now 0.9 - rms*0.7 → min ~0.2s.
  const spawnEvery = Math.max(0.2, 0.9 - a.rms * 0.7);
  if (now - glyphLast > spawnEvery) {
    glyphLast = now;
    // Collect top 3 active pitches by energy (was only dominant),
    // so chord passages stack multiple glyphs per cycle.
    const order: { pc: number; e: number }[] = [];
    for (let i = 0; i < 12; i++) {
      if (p.activePitches[i] > 0.08) order.push({ pc: i, e: p.activePitches[i] });
    }
    order.sort((x, y) => y.e - x.e);
    const picks = order.slice(0, Math.min(3, order.length));
    for (let k = 0; k < picks.length; k++) {
      const { pc, e } = picks[k];
      // First pick is biggest; secondary picks render smaller
      const sz = (18 + e * 26) * (k === 0 ? 1 : 0.65 - k * 0.1);
      const gx = 60 + Math.random() * (w - 120);
      const gy = 60 + Math.random() * (h - 120);
      stampGlyph(g, gx, gy, sz, pc, e, p.growth);
      recentGlyphs.push({ x: gx, y: gy, sz, pc, age: 0 });
      if (recentGlyphs.length > 18) recentGlyphs.shift();
    }
  }

  // Peak burst — a ring of 6–8 small glyphs around the freshest
  // placement on each transient.
  if (a.peak > glyphPrevPeak + 0.08 && recentGlyphs.length > 0) {
    const last = recentGlyphs[recentGlyphs.length - 1];
    const count = 6 + Math.round(a.peak * 4);
    const rr = last.sz * 2.2;
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * Math.PI * 2;
      const bx = last.x + Math.cos(ang) * rr;
      const by = last.y + Math.sin(ang) * rr;
      if (bx < 30 || bx > w - 30 || by < 30 || by > h - 30) continue;
      // Small, bright, quick stamp — uses last glyph's pc for cohesion
      stampGlyph(g, bx, by, last.sz * 0.4, last.pc, Math.min(1, a.peak + 0.3), p.growth);
      recentGlyphs.push({ x: bx, y: by, sz: last.sz * 0.4, pc: last.pc, age: 0 });
    }
    if (recentGlyphs.length > 40) recentGlyphs.splice(0, recentGlyphs.length - 40);
  }
  glyphPrevPeak = a.peak;

  // Age recent glyphs for the live halo overlay
  for (let i = recentGlyphs.length - 1; i >= 0; i--) {
    recentGlyphs[i].age += 0.01 * dt;
    if (recentGlyphs[i].age > 3) recentGlyphs.splice(i, 1);
  }

  // Gilt sparks — drifting fireflies, audio-gated spawn
  if (a.rms > 0.03 && Math.random() < 0.25 + a.rms * 0.8 && glyphSparks.length < 60) {
    glyphSparks.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.1 - Math.random() * 0.3,
      life: 1,
    });
  }

  ctx.drawImage(glyphCanvas!, 0, 0);

  // Live breathing halos on recent glyphs — the freshest pulse hardest
  for (let i = 0; i < recentGlyphs.length; i++) {
    const r = recentGlyphs[i];
    const pulse = Math.max(0, 1 - r.age) * (0.35 + a.rms * 0.5);
    if (pulse < 0.02) continue;
    const haloR = r.sz * 1.8 * (1 + Math.sin(p.t * 1.5 + i) * 0.1);
    const halo = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, haloR);
    halo.addColorStop(0, `hsla(42, 70%, 78%, ${pulse * 0.4})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(r.x, r.y, haloR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Step + render sparks on the live overlay (not stamped into the
  // buffer, so they drift freely over the gilt runes).
  for (let i = glyphSparks.length - 1; i >= 0; i--) {
    const s = glyphSparks[i];
    s.x += s.vx;
    s.y += s.vy;
    s.vy -= 0.003;
    s.life -= 0.004;
    if (s.life <= 0 || s.y < -20) { glyphSparks.splice(i, 1); continue; }
    const alpha = s.life * 0.7 + a.peak * 0.2;
    ctx.fillStyle = `hsla(44, 80%, 72%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 1.1 + a.rms * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Peak flash — brief warm wash across the whole canvas on transients
  if (a.peak > 0.5) {
    ctx.fillStyle = `rgba(240, 180, 90, ${(a.peak - 0.5) * 0.18})`;
    ctx.fillRect(0, 0, w, h);
  }
}

// SCRYING MIRROR — bilateral symmetry. Ink blooms on the right half
// are mirrored to the left. Peak transients spawn new blooms; their
// hue rotates warm→cool with spectral centroid.
interface MirrorBloom { x: number; y: number; r: number; maxR: number; hue: number; age: number; }
const mirrorBlooms: MirrorBloom[] = [];
let mirrorLastPeak = 0;
let mirrorSpawnTimer = 0;
export function drawScryingMirror(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  // Cream card-stock background — classic Rorschach plate. Very slow
  // fade so ink blooms persist for many seconds; the card never clears.
  ctx.fillStyle = "rgba(239, 232, 220, 0.025)";
  ctx.fillRect(0, 0, w, h);

  let num = 0, den = 0;
  for (let i = 0; i < a.spectrum.length; i++) { num += i * a.spectrum[i]; den += a.spectrum[i]; }
  const centroid = den > 0 ? (num / den) / a.spectrum.length : 0.3;

  // Spawning is strictly audio-gated — no RMS, no new stains. Silence
  // means the card is held. Existing blooms continue their life cycle.
  if (a.rms > 0.03) {
    mirrorSpawnTimer += a.rms * 0.22;
    if (mirrorSpawnTimer > 1 && mirrorBlooms.length < 32) {
      mirrorSpawnTimer = 0;
      const coloured = Math.random() < 0.15;
      const hue = coloured
        ? (Math.random() < 0.5 ? 0 : 220) + (Math.random() - 0.5) * 20
        : 25;
      mirrorBlooms.push({
        x: w * 0.5 + Math.random() * w * 0.45,
        y: Math.random() * h,
        r: 8,
        maxR: 40 + Math.random() * 100 + a.rms * 100,
        hue: coloured ? hue : -1,
        age: 0,
      });
    }
  } else {
    mirrorSpawnTimer = 0;
  }
  // Peaks trigger bigger blooms regardless, but still require audible signal.
  if (a.rms > 0.03 && a.peak > mirrorLastPeak + 0.05 && mirrorBlooms.length < 42) {
    mirrorBlooms.push({
      x: w * 0.5 + Math.random() * w * 0.45,
      y: Math.random() * h,
      r: 10,
      maxR: 70 + Math.random() * 110 + a.peak * 70,
      hue: -1,
      age: 0,
    });
  }
  mirrorLastPeak = a.peak;
  // Suppress unused-var lint while keeping centroid read alive
  // (may drive future per-plate palette shifts).
  void centroid;

  const cx = w / 2;
  const dt = p.dtScale ?? 1;

  for (let i = mirrorBlooms.length - 1; i >= 0; i--) {
    const b = mirrorBlooms[i];
    // Age rate: blooms linger ~18s each — enough to accumulate
    // texture without the card getting completely crowded.
    b.age += 0.005 * dt;
    if (b.age > 1) { mirrorBlooms.splice(i, 1); continue; }
    b.r += (b.maxR - b.r) * 0.03;
    const alpha = Math.max(0, 0.6 * (1 - b.age));
    const stop = b.hue < 0
      ? `rgba(22, 18, 15, ${alpha})`              // ink-black
      : `hsla(${b.hue}, 55%, 35%, ${alpha})`;     // red / blue accent
    const gr = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    gr.addColorStop(0, stop);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    const mx = 2 * cx - b.x;
    const gL = ctx.createRadialGradient(mx, b.y, 0, mx, b.y, b.r);
    gL.addColorStop(0, stop);
    gL.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gL;
    ctx.beginPath(); ctx.arc(mx, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  }
}



// CRYSTAL LATTICE — persistent polygonal accretion. Facet shape /
// size / spawn rate all shift with the drone's character so different
// soundscapes grow visibly different crystals:
//   dominant pitch class → polygon sides (3 = sharp shard, 7 = chunk)
//   spectral centroid    → facet size (low centroid → big slabs,
//                                      high → tiny shards)
//   active-pitch mass    → spawn rate
interface Facet { x: number; y: number; size: number; angle: number; sides: number; light: number; parentIdx: number; }
const facets: Facet[] = [];
let crystalCanvas: HTMLCanvasElement | null = null;
let crystalCtx: CanvasRenderingContext2D | null = null;
let lastFacetSpawn = 0;
let prevCrystalRms = 0;
let lastSparkleT = 0;
function ensureCrystal(w: number, h: number) {
  if (!crystalCanvas || crystalCanvas.width !== w || crystalCanvas.height !== h) {
    crystalCanvas = document.createElement("canvas");
    crystalCanvas.width = w; crystalCanvas.height = h;
    crystalCtx = crystalCanvas.getContext("2d");
    crystalCtx!.fillStyle = "#0d0906"; crystalCtx!.fillRect(0, 0, w, h);
    facets.length = 0;
  }
}
function drawFacetInto(c: CanvasRenderingContext2D, facet: Facet) {
  c.save();
  c.translate(facet.x, facet.y);
  c.rotate(facet.angle);
  const s = facet.size;
  // Asymmetric gradient — catches "light" from upper-left so each
  // facet reads as a 3D gem rather than a flat polygon.
  const grad = c.createLinearGradient(-s * 0.7, -s, s * 0.7, s);
  const l1 = Math.min(255, Math.round(facet.light * 2.55 + 55));
  const l2 = Math.round(facet.light * 2.55);
  const l3 = Math.max(0, Math.round(facet.light * 2.55 - 45));
  grad.addColorStop(0, `rgba(${l1}, ${l1}, ${l1}, 0.92)`);
  grad.addColorStop(0.5, `rgba(${l2}, ${l2}, ${l2}, 0.85)`);
  grad.addColorStop(1, `rgba(${l3}, ${l3}, ${l3}, 0.92)`);
  c.fillStyle = grad;
  c.beginPath();
  for (let k = 0; k < facet.sides; k++) {
    const ang = (k / facet.sides) * Math.PI * 2 - Math.PI / 2;
    const vx = Math.cos(ang) * s;
    const vy = Math.sin(ang) * s;
    if (k === 0) c.moveTo(vx, vy); else c.lineTo(vx, vy);
  }
  c.closePath();
  c.fill();
  // Cleavage lines — centre to each vertex. Turns the flat polygon
  // into a visibly faceted gem.
  c.strokeStyle = "rgba(255, 255, 255, 0.18)";
  c.lineWidth = 0.6;
  for (let k = 0; k < facet.sides; k++) {
    const ang = (k / facet.sides) * Math.PI * 2 - Math.PI / 2;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(Math.cos(ang) * s, Math.sin(ang) * s);
    c.stroke();
  }
  // Edge
  c.strokeStyle = "rgba(230, 230, 230, 0.4)";
  c.lineWidth = 0.9;
  c.beginPath();
  for (let k = 0; k < facet.sides; k++) {
    const ang = (k / facet.sides) * Math.PI * 2 - Math.PI / 2;
    const vx = Math.cos(ang) * s;
    const vy = Math.sin(ang) * s;
    if (k === 0) c.moveTo(vx, vy); else c.lineTo(vx, vy);
  }
  c.closePath();
  c.stroke();
  // Light-catching diagonal — a short bright streak across the upper
  // left of the facet. Reads as specular glint.
  c.strokeStyle = "rgba(255, 255, 255, 0.45)";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(-s * 0.4, -s * 0.5);
  c.lineTo(s * 0.15, -s * 0.15);
  c.stroke();
  c.restore();
}
export function drawCrystalLattice(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  ensureCrystal(w, h);
  const c = crystalCtx!;
  const stability = 1 - Math.min(1, Math.abs(a.rms - prevCrystalRms) * 20);
  prevCrystalRms = a.rms;

  let num = 0, den = 0;
  for (let i = 0; i < a.spectrum.length; i++) { num += i * a.spectrum[i]; den += a.spectrum[i]; }
  const centroid = den > 0 ? (num / den) / a.spectrum.length : 0.3;
  const sizeScale = 1.4 - centroid * 0.9;

  let dom = 0, domE = 0, mass = 0;
  for (let i = 0; i < 12; i++) {
    mass += p.activePitches[i];
    if (p.activePitches[i] > domE) { domE = p.activePitches[i]; dom = i; }
  }
  const sides = 3 + (dom % 5);

  const spawnEvery = Math.max(0.1, 0.8 - mass * 0.25 - a.rms);
  if (stability > 0.55 && a.rms > 0.06 && p.t - lastFacetSpawn > spawnEvery) {
    lastFacetSpawn = p.t;
    let fx = w / 2, fy = h / 2;
    let parentIdx = -1;
    if (facets.length > 0) {
      // Cluster growth — 90% of the time the new facet sprouts from
      // one of the six most recent, so dendrites form. 10% nucleates
      // from any random existing facet, starting a new sub-cluster.
      if (Math.random() < 0.9) {
        const lookBack = Math.min(6, facets.length);
        parentIdx = facets.length - 1 - Math.floor(Math.random() * lookBack);
      } else {
        parentIdx = Math.floor(Math.random() * facets.length);
      }
      const parent = facets[parentIdx];
      const ang = Math.random() * Math.PI * 2;
      const d = parent.size * (1.35 + Math.random() * 0.35);
      fx = parent.x + Math.cos(ang) * d;
      fy = parent.y + Math.sin(ang) * d;
      if (fx < 20 || fy < 20 || fx > w - 20 || fy > h - 20) return;
    }
    const facet: Facet = {
      x: fx, y: fy,
      size: (6 + Math.random() * 10) * sizeScale,
      angle: Math.random() * Math.PI,
      sides,
      light: 45 + Math.random() * 25,
      parentIdx,
    };
    facets.push(facet);
    // Growth vein — a faint line from parent to child shows the
    // crystal's dendritic history.
    if (parentIdx >= 0) {
      const par = facets[parentIdx];
      c.strokeStyle = "rgba(180, 180, 180, 0.28)";
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(par.x, par.y);
      c.lineTo(facet.x, facet.y);
      c.stroke();
    }
    drawFacetInto(c, facet);
  }
  ctx.drawImage(crystalCanvas!, 0, 0);

  const last = facets[facets.length - 1];
  if (last) {
    const glow = ctx.createRadialGradient(last.x, last.y, 0, last.x, last.y, last.size * 3);
    glow.addColorStop(0, `rgba(240, 240, 240, ${0.25 + a.rms * 0.4})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(last.x, last.y, last.size * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Peak-triggered sparkles — bright flicker + cross-shine on a handful
  // of existing facets. The whole lattice appears to "flash through"
  // on transients.
  if (a.peak > 0.3 && facets.length > 0 && p.t - lastSparkleT > 0.08) {
    lastSparkleT = p.t;
    const count = 1 + Math.round(a.peak * 3);
    ctx.lineCap = "round";
    for (let k = 0; k < count; k++) {
      const f = facets[Math.floor(Math.random() * facets.length)];
      const spR = f.size * 2.2;
      const spg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, spR);
      spg.addColorStop(0, `rgba(255, 255, 255, ${a.peak * 0.8})`);
      spg.addColorStop(0.5, `rgba(255, 255, 255, ${a.peak * 0.3})`);
      spg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = spg;
      ctx.beginPath();
      ctx.arc(f.x, f.y, spR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${a.peak * 0.6})`;
      ctx.lineWidth = 0.8;
      for (let d = 0; d < 2; d++) {
        const ang = d * Math.PI / 2 + p.t;
        ctx.beginPath();
        ctx.moveTo(f.x - Math.cos(ang) * spR, f.y - Math.sin(ang) * spR);
        ctx.lineTo(f.x + Math.cos(ang) * spR, f.y + Math.sin(ang) * spR);
        ctx.stroke();
      }
    }
  }
}


// MIRROR GLYPHS — a cream Rorschach card where gilt illuminated
// glyphs AND bilateral ink blooms both accumulate. Fusion of the
// SCRYING MIRROR and ILLUMINATED GLYPHS visualizers. Reuses the
// GLYPH_STROKES authored for ILLUMINATED GLYPHS.
let mgCanvas: HTMLCanvasElement | null = null;
let mgCtx: CanvasRenderingContext2D | null = null;
let mgGlyphLast = 0;
let mgSpawnTimer = 0;
function ensureMg(w: number, h: number) {
  if (!mgCanvas || mgCanvas.width !== w || mgCanvas.height !== h) {
    mgCanvas = document.createElement("canvas");
    mgCanvas.width = w; mgCanvas.height = h;
    mgCtx = mgCanvas.getContext("2d");
    mgCtx!.fillStyle = "#efe8dc"; mgCtx!.fillRect(0, 0, w, h);
  }
}
export function drawMirrorGlyphs(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  ensureMg(w, h);
  const m = mgCtx!;
  // Very slow fade toward cream so both glyphs and ink persist.
  m.fillStyle = "rgba(239, 232, 220, 0.008)";
  m.fillRect(0, 0, w, h);

  const cx = w / 2;

  // Bilateral ink blooms — audio-gated so silence stops adding ink.
  if (a.rms > 0.03) {
    mgSpawnTimer += a.rms * 0.2;
    if (mgSpawnTimer > 1) {
      mgSpawnTimer = 0;
      const x = cx + 20 + Math.random() * (w * 0.45);
      const y = Math.random() * h;
      const r = 28 + Math.random() * 75 + a.rms * 70;
      const mx = 2 * cx - x;
      for (const bx of [x, mx]) {
        const gr = m.createRadialGradient(bx, y, 0, bx, y, r);
        gr.addColorStop(0, "rgba(22, 18, 15, 0.48)");
        gr.addColorStop(1, "rgba(0,0,0,0)");
        m.fillStyle = gr;
        m.beginPath(); m.arc(bx, y, r, 0, Math.PI * 2); m.fill();
      }
    }
  } else {
    mgSpawnTimer = 0;
  }

  // Bilateral gilt glyphs — each placement doubles across the seam.
  if (a.rms > 0.03 && p.t - mgGlyphLast > 1.8 - a.rms * 0.7) {
    mgGlyphLast = p.t;
    let pc = 0, best = 0;
    for (let i = 0; i < 12; i++) {
      if (p.activePitches[i] > best) { best = p.activePitches[i]; pc = i; }
    }
    if (best > 0.08) {
      const strokes = GLYPH_STROKES[pickGlyphIdx(pc)];
      const sz = 18 + best * 22;
      const gx = cx + 40 + Math.random() * (w * 0.35);
      const gy = 60 + Math.random() * (h - 120);
      for (const xx of [gx, 2 * cx - gx]) {
        m.save();
        m.translate(xx, gy);
        m.lineWidth = 1.4 + best * 1.5;
        m.lineCap = "round";
        m.lineJoin = "round";
        m.strokeStyle = `hsla(42, ${55 + best * 25}%, ${52 + best * 10}%, 0.85)`;
        m.shadowColor = "rgba(200, 140, 60, 0.5)";
        m.shadowBlur = 5 + best * 6;
        for (const path of strokes) {
          m.beginPath();
          for (let i = 0; i < path.length; i += 2) {
            const px = path[i] * sz;
            const py = path[i + 1] * sz;
            if (i === 0) m.moveTo(px, py); else m.lineTo(px, py);
          }
          m.stroke();
        }
        m.restore();
      }
    }
  }

  ctx.drawImage(mgCanvas!, 0, 0);
}

// ═══════════════════════════════════════════════════════════════════════
// NEW VISUALIZERS (2026-04 wave) — resonantBody, tapeDecay,
// voidMonolith, beatingField, tuningManuscript,
// feedbackTunnelBW. All follow the ember/copper/bone palette and
// accrete slowly; no rainbow spectra, no neon glow.
// ═══════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// RESONANT BODY — instrument anatomy blend. Each active voice layer
// contributes a silhouette weighted by its mixer level. Draws on a
// persistent offscreen so repeated passes deepen the ink; we wash the
// buffer each frame with a faint dark overlay so silhouettes settle.
// ─────────────────────────────────────────────────────────────────────
let bodyCanvas: HTMLCanvasElement | null = null;
let bodyCtx: CanvasRenderingContext2D | null = null;
// Persistent per-voice reactive state — plucks/pings/rib-lights that
// decay between peaks so transients show as visible events.
const bodyTanpuraPluck = new Float32Array(4);
const bodyTanpuraPhase = new Float32Array(4);
const bodyMetalPing = new Float32Array(5);
const bodyPianoRib = new Float32Array(7);
const bodyAmpPulse = new Float32Array(1);
const bodyReedAperture = new Float32Array(1);
// Air wisps: x,y,vy,life (persistent, respawn from bottom)
const BODY_WISP_N = 18;
const bodyWisps = new Float32Array(BODY_WISP_N * 4);
let bodyWispsInit = false;
let bodyPrevPeak = 0;
let bodyFmPhase = 0;

export function drawResonantBody(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  if (!bodyCanvas || bodyCanvas.width !== w || bodyCanvas.height !== h) {
    bodyCanvas = document.createElement("canvas");
    bodyCanvas.width = w; bodyCanvas.height = h;
    bodyCtx = bodyCanvas.getContext("2d");
    if (bodyCtx) { bodyCtx.fillStyle = "#0b0805"; bodyCtx.fillRect(0, 0, w, h); }
  }
  const off = bodyCtx!;
  const dt = p.dtScale ?? 1;
  // Wash modulated by rms — loud passages leave stronger ink, quiet
  // passages clear faster so motion stays legible.
  off.fillStyle = `rgba(11, 8, 5, ${(0.05 + a.rms * 0.12) * dt})`;
  off.fillRect(0, 0, w, h);

  const v = p.voices;
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.38;

  // ── Spectral bands (single pass, shared by all voices) ───────────
  let low = 0, mid = 0, high = 0;
  for (let i = 0; i < 8; i++) low += a.spectrum[i] ?? 0;
  for (let i = 8; i < 20; i++) mid += a.spectrum[i] ?? 0;
  for (let i = 20; i < 32; i++) high += a.spectrum[i] ?? 0;
  low /= 8; mid /= 12; high /= 12;

  // ── Transient detection — rising edge on peak triggers events ────
  const peakDelta = a.peak - bodyPrevPeak;
  const transient = peakDelta > 0.08;
  bodyPrevPeak = a.peak * 0.85 + bodyPrevPeak * 0.15;

  // Silence baseline — faint bone ring breathing with rms
  const baseRing = R * (1 + a.rms * 0.02 + Math.sin(p.t * 0.25) * 0.01);
  off.strokeStyle = `rgba(190, 170, 140, ${0.06 + a.rms * 0.06})`;
  off.lineWidth = 1;
  off.beginPath();
  off.arc(cx, cy, baseRing, 0, Math.PI * 2);
  off.stroke();
  if (!v) { ctx.drawImage(bodyCanvas, 0, 0); return; }

  const rms = a.rms;

  // Decay persistent excitations (framerate-independent)
  for (let i = 0; i < 4; i++) {
    bodyTanpuraPluck[i] *= Math.pow(0.94, dt);
    bodyTanpuraPhase[i] += dt * (6 + i * 0.7);
  }
  for (let i = 0; i < 5; i++) bodyMetalPing[i] *= Math.pow(0.93, dt);
  for (let i = 0; i < 7; i++) bodyPianoRib[i] *= Math.pow(0.92, dt);
  bodyAmpPulse[0] *= Math.pow(0.88, dt);
  bodyReedAperture[0] *= Math.pow(0.93, dt);

  // TANPURA — 4 strings, transients pluck one. Pluck selection biased
  // by active pitch class so the string that "fires" corresponds to
  // whichever note just came in. Shape = travelling quadratic lobe
  // whose amplitude = pluck energy.
  if (v.tanpura > 0.02) {
    const baseAl = v.tanpura * (0.28 + rms * 0.55);
    if (transient) {
      // Pick a string from loudest active pitch class
      let pc = 0, best = 0;
      for (let i = 0; i < 12; i++) if (p.activePitches[i] > best) { best = p.activePitches[i]; pc = i; }
      const sIdx = pc % 4;
      bodyTanpuraPluck[sIdx] = Math.max(bodyTanpuraPluck[sIdx], a.peak * (0.6 + v.tanpura * 0.5));
    }
    off.lineWidth = 1;
    for (let s = 0; s < 4; s++) {
      const x = cx + (s - 1.5) * (R * 0.18);
      const pluck = bodyTanpuraPluck[s];
      const ph = bodyTanpuraPhase[s];
      const pluckWob = Math.sin(ph) * pluck * R * 0.18;
      const breath = Math.sin(p.t * (0.9 + s * 0.11) + s) * (1.2 + low * 4);
      const midY = cy + pluckWob;
      // Brighter amber on loaded strings, tawny base otherwise
      const gl = 0.5 + Math.min(0.45, pluck * 1.2);
      off.strokeStyle = `rgba(${210 + Math.round(pluck * 40)}, ${170 + Math.round(pluck * 30)}, ${110 + Math.round(pluck * 20)}, ${baseAl * gl})`;
      off.beginPath();
      off.moveTo(x, cy - R);
      off.quadraticCurveTo(x + breath + pluckWob, midY, x, cy + R);
      off.stroke();
    }
    // Jawari bridge — brighter when any string is excited
    const jh = cy + R * 0.62;
    const pluckSum = bodyTanpuraPluck[0] + bodyTanpuraPluck[1] + bodyTanpuraPluck[2] + bodyTanpuraPluck[3];
    off.fillStyle = `rgba(240, 205, 140, ${baseAl * (0.35 + Math.min(0.55, pluckSum * 0.4))})`;
    off.fillRect(cx - R * 0.3, jh, R * 0.6, 1.2 + pluckSum * 1.2);
  }

  // REED — bellows breathe on rms; slat spread tied to mid band;
  // aperture opens on transients and decays.
  if (v.reed > 0.02) {
    const baseAl = v.reed * (0.28 + rms * 0.5);
    if (transient) bodyReedAperture[0] = Math.min(1, bodyReedAperture[0] + a.peak * 0.8);
    off.strokeStyle = `rgba(200, 150, 100, ${baseAl})`;
    off.lineWidth = 1;
    const slats = 9;
    const bx = cx - R * 0.8, by = cy - R * 0.25;
    const bellowsW = R * 0.5;
    // Breath cycle — RMS drives inhale depth, not just sine
    const inhale = 0.85 + rms * 0.35 + Math.sin(p.t * 0.9) * 0.06;
    for (let i = 0; i < slats; i++) {
      const t = i / (slats - 1);
      const spread = 1 + mid * 0.6;
      const y = by + t * R * 0.5 * inhale * spread;
      const ax = (Math.sin(p.t * 1.4 + t * 3) * mid * bellowsW * 0.06);
      off.beginPath();
      off.moveTo(bx + ax, y);
      off.lineTo(bx + bellowsW - ax, y);
      off.stroke();
    }
    // Aperture — ring + filled dot whose radius spikes on transient
    const apBase = R * 0.06 * (0.85 + rms * 0.4);
    const apR = apBase * (1 + bodyReedAperture[0] * 1.6);
    off.strokeStyle = `rgba(230, 180, 120, ${baseAl * (0.7 + bodyReedAperture[0] * 0.3)})`;
    off.lineWidth = 1;
    off.beginPath(); off.arc(cx + R * 0.1, cy, apR, 0, Math.PI * 2); off.stroke();
    if (bodyReedAperture[0] > 0.15) {
      off.fillStyle = `rgba(245, 210, 150, ${bodyReedAperture[0] * 0.5 * baseAl})`;
      off.beginPath(); off.arc(cx + R * 0.1, cy, apR * 0.4, 0, Math.PI * 2); off.fill();
    }
  }

  // METAL — 5 bowl rings. Transient pings a ring chosen by spectral
  // centroid (low=inner, high=outer). Pinged ring radius+brightness
  // briefly swells. Silent rings very faint.
  if (v.metal > 0.02) {
    const baseAl = v.metal * (0.25 + rms * 0.55);
    if (transient) {
      const brightness = (low + mid + high) > 1e-3
        ? high / (low + mid + high + 1e-6) : 0.5;
      const idx = Math.max(0, Math.min(4, Math.floor(brightness * 5)));
      bodyMetalPing[idx] = Math.min(1, bodyMetalPing[idx] + a.peak * 0.9);
    }
    off.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const ping = bodyMetalPing[i];
      const rr = R * (0.2 + (i / 5) * 0.72) * (1 + ping * 0.12 + Math.sin(p.t * 0.8 + i) * 0.01);
      off.strokeStyle = `rgba(${170 + Math.round(ping * 40)}, ${195 + Math.round(ping * 30)}, ${205 + Math.round(ping * 30)}, ${baseAl * (0.45 + ping * 0.55)})`;
      off.lineWidth = 0.8 + ping * 1.4;
      off.beginPath();
      off.arc(cx, cy, rr, 0, Math.PI * 2);
      off.stroke();
    }
  }

  // AIR — pipe + persistent wisps with audio-driven spawn rate and
  // speed. Wisps rise, wrap around; high-band energy thickens the
  // column of wisps, rms speeds them.
  if (v.air > 0.02) {
    const baseAl = v.air * (0.28 + rms * 0.5);
    const px = cx + R * 0.6;
    // Column — lateral tremble tied to rms
    off.strokeStyle = `rgba(200, 210, 200, ${baseAl})`;
    off.lineWidth = 1;
    off.beginPath();
    const trem = Math.sin(p.t * 4) * rms * 1.4;
    off.moveTo(px + trem, cy - R * 0.85);
    off.lineTo(px - trem, cy + R * 0.85);
    off.stroke();
    // Init wisps
    if (!bodyWispsInit) {
      for (let i = 0; i < BODY_WISP_N; i++) {
        const o = i * 4;
        bodyWisps[o] = px + (Math.random() - 0.5) * 8;
        bodyWisps[o + 1] = cy + (Math.random() - 0.5) * R * 1.6;
        bodyWisps[o + 2] = 0.5 + Math.random() * 0.8;
        bodyWisps[o + 3] = Math.random();
      }
      bodyWispsInit = true;
    }
    const visible = Math.floor(BODY_WISP_N * (0.3 + v.air * 0.4 + high * 1.2));
    const rise = 0.8 + rms * 3.2 + high * 2.0;
    off.strokeStyle = `rgba(210, 220, 210, ${baseAl * 0.6})`;
    off.lineWidth = 0.8;
    for (let i = 0; i < Math.min(visible, BODY_WISP_N); i++) {
      const o = i * 4;
      bodyWisps[o + 1] -= bodyWisps[o + 2] * rise;
      if (bodyWisps[o + 1] < cy - R * 0.9) {
        bodyWisps[o] = px + (Math.random() - 0.5) * 10;
        bodyWisps[o + 1] = cy + R * 0.9;
        bodyWisps[o + 2] = 0.5 + Math.random() * 0.8;
      }
      const wx = bodyWisps[o] + Math.sin(bodyWisps[o + 1] * 0.08 + p.t) * 1.5;
      off.beginPath();
      off.moveTo(wx, bodyWisps[o + 1]);
      off.lineTo(wx + 4, bodyWisps[o + 1] - 5);
      off.stroke();
    }
  }

  // PIANO — ribs light up from low→high: each rib is tied to a
  // spectrum band. Peak articulation boosts the loudest band's rib.
  if (v.piano > 0.02) {
    const baseAl = v.piano * (0.28 + rms * 0.5);
    const ribs = 7;
    // Bind ribs to spectrum thirds
    const bandVals = [
      a.spectrum[2] ?? 0, a.spectrum[5] ?? 0, a.spectrum[9] ?? 0,
      a.spectrum[13] ?? 0, a.spectrum[18] ?? 0, a.spectrum[23] ?? 0, a.spectrum[28] ?? 0,
    ];
    if (transient) {
      let bestI = 0, bestV = 0;
      for (let i = 0; i < 7; i++) if (bandVals[i] > bestV) { bestV = bandVals[i]; bestI = i; }
      bodyPianoRib[bestI] = Math.min(1, bodyPianoRib[bestI] + a.peak * 0.9);
    }
    off.lineWidth = 0.8;
    for (let i = 0; i < ribs; i++) {
      const ry = cy - R * 0.4 + (i / (ribs - 1)) * R * 0.8;
      const lit = Math.min(1, bandVals[i] * 2.2 + bodyPianoRib[i]);
      off.strokeStyle = `rgba(${180 + Math.round(lit * 50)}, ${150 + Math.round(lit * 40)}, ${120 + Math.round(lit * 25)}, ${baseAl * (0.4 + lit * 0.6)})`;
      off.lineWidth = 0.7 + lit * 1.2;
      off.beginPath();
      off.moveTo(cx - R * 0.8, ry);
      off.lineTo(cx + R * 0.8, ry);
      off.stroke();
    }
  }

  // FM — carrier orbit speed tracks low band (fundamental energy);
  // modulator orbit speed tracks high band (inharmonic sidebands);
  // radii track rms. Connector brightens on peaks (sidebanding).
  if (v.fm > 0.02) {
    const baseAl = v.fm * (0.32 + rms * 0.5);
    const carrierRate = 0.3 + low * 3.0;
    const modRate = 0.6 + high * 6.0;
    bodyFmPhase += dt * 0.02;
    const orbC = R * (0.22 + rms * 0.1);
    const orbM = R * (0.3 + mid * 0.25);
    const ax = p.t * carrierRate + bodyFmPhase;
    const bx = p.t * modRate * 1.7 + bodyFmPhase;
    const cx2 = cx + Math.cos(ax) * orbC;
    const cy2 = cy + Math.sin(ax) * orbC;
    const mx = cx + Math.cos(bx) * orbM;
    const my = cy + Math.sin(bx) * orbM;
    off.strokeStyle = `rgba(210, 160, 100, ${baseAl * (0.7 + a.peak * 0.3)})`;
    off.lineWidth = 1 + a.peak * 0.8;
    off.beginPath(); off.arc(cx2, cy2, R * (0.08 + rms * 0.04), 0, Math.PI * 2); off.stroke();
    off.strokeStyle = `rgba(160, 180, 210, ${baseAl * (0.65 + high * 0.4)})`;
    off.beginPath(); off.arc(mx, my, R * (0.06 + high * 0.08), 0, Math.PI * 2); off.stroke();
    off.strokeStyle = `rgba(200, 180, 140, ${baseAl * (0.15 + a.peak * 0.45)})`;
    off.lineWidth = 0.7 + a.peak;
    off.beginPath(); off.moveTo(cx2, cy2); off.lineTo(mx, my); off.stroke();
    // Faint carrier/modulator orbit traces
    off.strokeStyle = `rgba(190, 170, 140, ${baseAl * 0.12})`;
    off.lineWidth = 0.5;
    off.beginPath(); off.arc(cx, cy, orbC, 0, Math.PI * 2); off.stroke();
    off.beginPath(); off.arc(cx, cy, orbM, 0, Math.PI * 2); off.stroke();
  }

  // AMP — speaker cone swells with rms, peak triggers a radiating
  // shockwave ring. Cabinet vertical resonance line on strong lows.
  if (v.amp > 0.02) {
    const baseAl = v.amp * (0.3 + rms * 0.55);
    if (transient) bodyAmpPulse[0] = Math.min(1, bodyAmpPulse[0] + a.peak);
    const acx = cx - R * 0.3;
    const acy = cy + R * 0.25;
    const coneR = R * (0.22 + rms * 0.14 + bodyAmpPulse[0] * 0.18);
    off.strokeStyle = `rgba(180, 130, 90, ${baseAl})`;
    off.lineWidth = 1.2 + bodyAmpPulse[0] * 1.2;
    off.beginPath(); off.arc(acx, acy, coneR, 0, Math.PI * 2); off.stroke();
    off.lineWidth = 0.7;
    off.beginPath(); off.arc(acx, acy, coneR * 0.55, 0, Math.PI * 2); off.stroke();
    // Shockwave — drawn at coneR * (1 + pulse * 1.5), fades as pulse decays
    if (bodyAmpPulse[0] > 0.05) {
      off.strokeStyle = `rgba(230, 170, 110, ${bodyAmpPulse[0] * 0.55})`;
      off.lineWidth = 0.9;
      off.beginPath(); off.arc(acx, acy, coneR * (1 + bodyAmpPulse[0] * 1.6), 0, Math.PI * 2); off.stroke();
    }
    // Cabinet low resonance vertical when lows are hot
    if (low > 0.25) {
      off.strokeStyle = `rgba(160, 110, 70, ${baseAl * low * 0.8})`;
      off.lineWidth = 0.8;
      off.beginPath();
      off.moveTo(acx - coneR * 1.15, acy - coneR * 1.1);
      off.lineTo(acx - coneR * 1.15, acy + coneR * 1.1);
      off.stroke();
    }
  }

  // NOISE — density tracks high-band, scatter radius tracks rms.
  // Transients place a dense cluster to mark excitation.
  if (v.noise > 0.02) {
    const baseAl = v.noise * (0.35 + rms * 0.45);
    const grains = Math.floor(40 + v.noise * 40 + high * 120);
    off.fillStyle = `rgba(200, 180, 150, ${baseAl * 0.5})`;
    for (let i = 0; i < grains; i++) {
      off.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    if (transient) {
      off.fillStyle = `rgba(235, 210, 170, ${a.peak * 0.6 * baseAl})`;
      const clx = Math.random() * w;
      const cly = Math.random() * h;
      for (let i = 0; i < 30 + Math.floor(a.peak * 30); i++) {
        off.fillRect(clx + (Math.random() - 0.5) * 20, cly + (Math.random() - 0.5) * 20, 1, 1);
      }
    }
  }

  // ── Whole-assembly breathing — the organism itself swells with rms
  //    and gets a tiny rotational drift so it feels alive. Compose the
  //    offscreen onto the main canvas under this transform.
  const breath = 1 + a.rms * 0.06 + Math.sin(p.t * 0.4) * 0.012;
  const spin = Math.sin(p.t * 0.06) * 0.008 + a.peak * 0.004;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin);
  ctx.scale(breath, breath);
  ctx.translate(-cx, -cy);
  ctx.drawImage(bodyCanvas, 0, 0);
  ctx.restore();

  // ── Baseline peak-pulse — a bright bone ring that blooms on every
  //    transient. Drawn live (not stamped) so it fades cleanly.
  if (a.peak > 0.08) {
    const ringR = R * (1 + a.peak * 0.15);
    const ringAl = 0.12 + a.peak * 0.5;
    ctx.strokeStyle = `rgba(230, 210, 180, ${ringAl * 0.45})`;
    ctx.lineWidth = 0.9 + a.peak * 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Pitch-centroid amber sweep — the strongest active pitch class
  //    tilts a long faint wedge from the centre outward, pointing to
  //    its position on the circle of fifths. Shows what note is
  //    dominating without needing a legend.
  let bestPc = -1, bestE = 0.1;
  for (let i = 0; i < 12; i++) {
    if (p.activePitches[i] > bestE) { bestE = p.activePitches[i]; bestPc = i; }
  }
  if (bestPc >= 0) {
    const fifth = (bestPc * 7) % 12;
    const ang = (fifth / 12) * Math.PI * 2 - Math.PI / 2;
    const tipX = cx + Math.cos(ang) * R * 1.05;
    const tipY = cy + Math.sin(ang) * R * 1.05;
    const wedge = ctx.createLinearGradient(cx, cy, tipX, tipY);
    wedge.addColorStop(0, `hsla(30, 70%, 55%, ${bestE * 0.45 + a.peak * 0.15})`);
    wedge.addColorStop(1, "rgba(0,0,0,0)");
    ctx.strokeStyle = wedge;
    ctx.lineWidth = 1.6 + bestE * 2.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  }

  // ── Cross-voice chord diagram — each active voice anchors a node on
  //    a faint circle at R*0.85. Pairs of simultaneously-lit voices
  //    connect with soft arcs whose brightness scales with the product
  //    of their levels. Turns chord structure on the voice mixer into
  //    a literal chord diagram over the body.
  const voiceOrder: Array<{ key: keyof VoiceWeights; ang: number }> = [
    { key: "tanpura", ang: -Math.PI * 0.5 },
    { key: "reed",    ang: -Math.PI * 0.25 },
    { key: "metal",   ang: 0 },
    { key: "air",     ang: Math.PI * 0.25 },
    { key: "piano",   ang: Math.PI * 0.5 },
    { key: "fm",      ang: Math.PI * 0.75 },
    { key: "amp",     ang: Math.PI },
    { key: "noise",   ang: -Math.PI * 0.75 },
  ];
  const diagramR = R * 0.85;
  // Collect lit voices
  const lit: { x: number; y: number; lvl: number }[] = [];
  for (const vo of voiceOrder) {
    const lvl = v[vo.key];
    if (lvl < 0.02) continue;
    lit.push({
      x: cx + Math.cos(vo.ang) * diagramR,
      y: cy + Math.sin(vo.ang) * diagramR,
      lvl,
    });
  }
  // Faint ring
  ctx.strokeStyle = `rgba(140, 120, 90, ${0.06 + a.rms * 0.05})`;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(cx, cy, diagramR, 0, Math.PI * 2);
  ctx.stroke();
  // Nodes
  for (const n of lit) {
    const nr = 2 + n.lvl * 4 + a.peak * 2;
    const ng = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, nr * 3);
    ng.addColorStop(0, `hsla(30, 65%, 58%, ${0.45 + n.lvl * 0.35 + a.peak * 0.2})`);
    ng.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ng;
    ctx.fillRect(n.x - nr * 3, n.y - nr * 3, nr * 6, nr * 6);
  }
  // Chord arcs — pairs of lit voices, curved toward the centre
  if (lit.length >= 2) {
    for (let i = 0; i < lit.length; i++) {
      for (let j = i + 1; j < lit.length; j++) {
        const a1 = lit[i], a2 = lit[j];
        const pairStrength = Math.min(1, a1.lvl * a2.lvl * 3);
        const arcAl = (0.1 + pairStrength * 0.4) * (0.6 + a.rms * 0.5) + a.peak * 0.12;
        if (arcAl < 0.04) continue;
        ctx.strokeStyle = `hsla(28, 55%, 55%, ${arcAl})`;
        ctx.lineWidth = 0.7 + pairStrength * 1.2;
        ctx.beginPath();
        ctx.moveTo(a1.x, a1.y);
        // Quadratic control point pulled toward centre, plus a beat
        // wobble so chords breathe rather than stay rigid.
        const wobX = Math.sin(p.t * 0.8 + i * 0.7) * 3 * a.rms;
        const wobY = Math.cos(p.t * 0.8 + j * 0.7) * 3 * a.rms;
        ctx.quadraticCurveTo(cx + wobX, cy + wobY, a2.x, a2.y);
        ctx.stroke();
      }
    }
  }
}


// ─────────────────────────────────────────────────────────────────────
// TAPE DECAY — archival oxide degradation. Offscreen loop buffer that
// accumulates scars, splice seams, dropout specks, and slow scan
// bands. Not glitchy EDM — feels archival, like a long loop losing
// magnetization over hours.
// ─────────────────────────────────────────────────────────────────────
let tapeCanvas: HTMLCanvasElement | null = null;
let tapeCtx: CanvasRenderingContext2D | null = null;
let tapeSeamPhase = 0;
export function drawTapeDecay(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  if (!tapeCanvas || tapeCanvas.width !== w || tapeCanvas.height !== h) {
    tapeCanvas = document.createElement("canvas");
    tapeCanvas.width = w; tapeCanvas.height = h;
    tapeCtx = tapeCanvas.getContext("2d");
    if (tapeCtx) { tapeCtx.fillStyle = "#0e0a07"; tapeCtx.fillRect(0, 0, w, h); }
  }
  const off = tapeCtx!;
  const dt = p.dtScale ?? 1;
  // Very slow fade — damage persists minutes, not seconds.
  off.fillStyle = `rgba(14, 10, 7, ${0.018 * dt})`;
  off.fillRect(0, 0, w, h);

  // Base oxide bands — horizontal streaks, spectral energy scars them
  const bands = 40;
  const bandH = h / bands;
  for (let i = 0; i < bands; i++) {
    const u = i / bands;
    const bin = Math.min(31, Math.floor(u * 32));
    const e = a.spectrum[bin] ?? 0;
    if (e < 0.06) continue;
    const y = i * bandH + Math.random() * bandH;
    const alpha = 0.04 + e * 0.12;
    const hue = 25 + p.mood.warmth * 12;
    const lig = 30 + e * 30;
    off.fillStyle = `hsla(${hue}, ${40 + e * 25}%, ${lig}%, ${alpha})`;
    const segs = 1 + Math.floor(e * 4);
    for (let s = 0; s < segs; s++) {
      const x = Math.random() * w;
      const len = 20 + Math.random() * 180 * e;
      off.fillRect(x, y, len, 1);
    }
  }

  // Loop seam — a vertical line slowly travelling across the tape
  // (one "pass" every ~45 s). Each pass stamps a brighter scar where
  // the splice is, so older passes show as dimmer ghost seams.
  tapeSeamPhase += (0.006 + a.rms * 0.012) * dt;
  if (tapeSeamPhase > 1) tapeSeamPhase -= 1;
  const seamX = tapeSeamPhase * w;
  off.fillStyle = `rgba(220, 180, 130, ${0.12 + a.peak * 0.2})`;
  off.fillRect(seamX, 0, 1, h);

  // Dropout constellations — tiny bright specks that remain in place
  const drops = 2 + Math.floor(a.peak * 8);
  for (let i = 0; i < drops; i++) {
    off.fillStyle = `rgba(235, 210, 170, ${0.35 + Math.random() * 0.25})`;
    off.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  // Occasional degraded scan band — a slow wide horizontal sweep
  if (p.growth > 0.2) {
    const bandY = (Math.sin(p.t * 0.03) * 0.5 + 0.5) * h;
    const bandHigh = h * 0.04;
    const bg = off.createLinearGradient(0, bandY - bandHigh, 0, bandY + bandHigh);
    bg.addColorStop(0, "rgba(0,0,0,0)");
    bg.addColorStop(0.5, `rgba(180, 140, 90, ${0.08 * p.growth})`);
    bg.addColorStop(1, "rgba(0,0,0,0)");
    off.fillStyle = bg;
    off.fillRect(0, bandY - bandHigh, w, bandHigh * 2);
  }

  ctx.drawImage(tapeCanvas, 0, 0);
  // Live grain on top — very fine live noise
  ctx.fillStyle = "rgba(200, 170, 130, 0.02)";
  for (let i = 0; i < 60; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
}

// ─────────────────────────────────────────────────────────────────────
// VOID MONOLITH — a tall dark slab under standing-wave pressure.
// Slab width breathes with low-band energy. Standing-wave nodes along
// the slab brighten at y-positions of active pitch classes. Transients
// emit horizontal shockwave rings across the field and send travelling
// pulses down the slab. Pointer/hover raises pressure ripples at the
// cursor X so the canvas reads as responsive to touch.
// Still the quietest visualizer — huge negative space, but alive.
// ─────────────────────────────────────────────────────────────────────
const VOID_WAVE_N = 6;
const voidWaves = new Float32Array(VOID_WAVE_N * 2);       // y, life
let voidWaveCursor = 0;
const VOID_SHOCK_N = 5;
const voidShocks = new Float32Array(VOID_SHOCK_N * 2);     // radius (px), life
let voidShockCursor = 0;
const VOID_CRACK_N = 3;
const voidCracks = new Float32Array(VOID_CRACK_N * 2);     // y-norm, life
let voidCrackCursor = 0;
// Pointer ripples — hover leaves faint waves at the cursor X.
const VOID_POINTER_N = 4;
const voidPointerRipples = new Float32Array(VOID_POINTER_N * 3); // xNorm, radius, life
let voidPointerCursor = 0;
let voidPointerDownPrev = false;
let voidPointerLastSpawn = 0;
// Sparse falling dust — a handful of grains drifting down the field.
const VOID_DUST_N = 28;
const voidDust = new Float32Array(VOID_DUST_N * 3); // x, y, vy
let voidDustInit = false;
let voidEmberGlow = 0;
let voidPrevPeak = 0;

export function drawVoidMonolith(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  const dt = p.dtScale ?? 1;
  ctx.fillStyle = "#050302";
  ctx.fillRect(0, 0, w, h);

  // Spectral bands — low governs monolith width, mid governs travelling
  // pulse speed, high governs dust density and pointer-ripple colour.
  let low = 0, mid = 0, high = 0;
  for (let i = 0; i < 8; i++) low += a.spectrum[i] ?? 0;
  for (let i = 8; i < 20; i++) mid += a.spectrum[i] ?? 0;
  for (let i = 20; i < 32; i++) high += a.spectrum[i] ?? 0;
  low /= 8; mid /= 12; high /= 12;

  // Transient detection with hysteresis
  const peakDelta = a.peak - voidPrevPeak;
  const transient = peakDelta > 0.09;
  voidPrevPeak = a.peak * 0.85 + voidPrevPeak * 0.15;

  // ── Event spawns ───────────────────────────────────────────────
  if (transient) {
    voidWaves[voidWaveCursor * 2] = 0;
    voidWaves[voidWaveCursor * 2 + 1] = 1;
    voidWaveCursor = (voidWaveCursor + 1) % VOID_WAVE_N;
    voidEmberGlow = Math.min(1, voidEmberGlow + a.peak * 0.9);
    if (a.peak > 0.3) {
      // Horizontal shockwave ring — crosses the field, fades
      voidShocks[voidShockCursor * 2] = 0;
      voidShocks[voidShockCursor * 2 + 1] = Math.min(1, 0.4 + a.peak);
      voidShockCursor = (voidShockCursor + 1) % VOID_SHOCK_N;
    }
    if (a.peak > 0.5) {
      voidCracks[voidCrackCursor * 2] = Math.random();
      voidCracks[voidCrackCursor * 2 + 1] = 1;
      voidCrackCursor = (voidCrackCursor + 1) % VOID_CRACK_N;
    }
  }
  voidEmberGlow *= Math.pow(0.94, dt);

  // Pointer interaction — hover spawns faint ripples at cursor X
  // (rate-limited); pointerDown latches a stronger ripple.
  if (p.pointer) {
    voidPointerLastSpawn -= dt;
    const spawnThresh = p.pointerDown ? 6 : 22;
    if (voidPointerLastSpawn <= 0) {
      voidPointerRipples[voidPointerCursor * 3] = p.pointer.x;
      voidPointerRipples[voidPointerCursor * 3 + 1] = 0;
      voidPointerRipples[voidPointerCursor * 3 + 2] = p.pointerDown ? 1 : 0.5;
      voidPointerCursor = (voidPointerCursor + 1) % VOID_POINTER_N;
      voidPointerLastSpawn = spawnThresh;
    }
    // Release click → add a small peak boost (tactile)
    if (!voidPointerDownPrev && p.pointerDown) {
      voidEmberGlow = Math.min(1, voidEmberGlow + 0.35);
    }
  }
  voidPointerDownPrev = p.pointerDown;

  // ── Monolith slab — vertical narrow rectangle. Width breathes with
  //    low-band; right edge fills slightly brighter (amber rim).
  const mx = w * 0.38 + Math.sin(p.t * 0.05) * 2;
  const topY = h * 0.08;
  const botY = h * 0.92;
  const lineH = botY - topY;
  const slabW = 1.6 + low * 5.6 + a.rms * 2.2;
  const slabAl = 0.08 + low * 0.3 + a.rms * 0.12;
  // Body
  ctx.fillStyle = `rgba(40, 34, 26, ${slabAl})`;
  ctx.fillRect(mx - slabW / 2, topY, slabW, lineH);
  // Amber rim (right edge)
  ctx.fillStyle = `rgba(180, 160, 130, ${slabAl * 1.8})`;
  ctx.fillRect(mx + slabW / 2 - 0.7, topY, 0.7, lineH);
  // Cool rim (left edge)
  ctx.fillStyle = `rgba(110, 100, 95, ${slabAl * 0.9})`;
  ctx.fillRect(mx - slabW / 2, topY, 0.6, lineH);

  // Buckling spine — a centre line running through the slab, sinusoid
  // amplitude scales with low-band so strong subs warp the column.
  const bend = low * 14 + a.rms * 6;
  ctx.strokeStyle = `rgba(200, 180, 150, ${0.22 + low * 0.5})`;
  ctx.lineWidth = 0.8 + low * 0.8;
  ctx.beginPath();
  const SEGS = 24;
  for (let s = 0; s <= SEGS; s++) {
    const t = s / SEGS;
    const y = topY + t * lineH;
    let x = mx + Math.sin(t * Math.PI * (1.5 + low * 2) + p.t * 0.3) * bend;
    x += (Math.random() - 0.5) * a.peak * 0.8;
    if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ── Standing-wave nodes — for each lit pitch class, draw a small
  //    bright dot on the slab at that pc's y-position. Dot radius +
  //    brightness scale with pitch energy, so the chord is literally
  //    etched onto the monolith.
  for (let pc = 0; pc < 12; pc++) {
    const e = p.activePitches[pc];
    if (e < 0.1) continue;
    const ty = topY + (pc / 11) * lineH;
    const nx = mx + Math.sin((pc / 11) * Math.PI * (1.5 + low * 2) + p.t * 0.3) * bend;
    const nr = 1.4 + e * 3.2 + a.peak * 1.5;
    const ng = ctx.createRadialGradient(nx, ty, 0, nx, ty, nr * 3);
    ng.addColorStop(0, `hsla(28, 70%, 70%, ${0.55 + e * 0.35})`);
    ng.addColorStop(0.5, `hsla(22, 50%, 40%, ${e * 0.2})`);
    ng.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ng;
    ctx.fillRect(nx - nr * 3, ty - nr * 3, nr * 6, nr * 6);
    // Right-edge tick — all active pitches show, not just strongest
    ctx.fillStyle = `rgba(170, 150, 120, ${0.3 + e * 0.5})`;
    ctx.fillRect(w * 0.9, ty, 4 + e * 6, 1);
  }

  // ── Horizontal shockwave rings — ellipses centred on the slab,
  //    expand outward across the canvas, fade. Loud peaks push rings
  //    farther.
  for (let i = 0; i < VOID_SHOCK_N; i++) {
    const r = voidShocks[i * 2];
    const life = voidShocks[i * 2 + 1];
    if (life <= 0) continue;
    const rx = r * w * 0.75;
    const ry = r * h * 0.35;
    ctx.strokeStyle = `rgba(180, 160, 130, ${life * 0.18})`;
    ctx.lineWidth = 0.7 + life * 0.9;
    ctx.beginPath();
    ctx.ellipse(mx, h * 0.58, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    voidShocks[i * 2] += (0.010 + a.rms * 0.014) * dt;
    voidShocks[i * 2 + 1] *= Math.pow(0.975, dt);
  }

  // ── Travelling pressure pulses along the slab (seismograph beads)
  for (let i = 0; i < VOID_WAVE_N; i++) {
    const life = voidWaves[i * 2 + 1];
    if (life <= 0) continue;
    const yNorm = voidWaves[i * 2];
    const y = topY + yNorm * lineH;
    const xAtY = mx + Math.sin(yNorm * Math.PI * (1.5 + low * 2) + p.t * 0.3) * bend;
    const pulseH = 18 + life * 12;
    const g = ctx.createLinearGradient(xAtY, y - pulseH, xAtY, y + pulseH);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, `rgba(230, 200, 160, ${life * 0.75})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4 + life;
    ctx.beginPath();
    ctx.moveTo(xAtY, y - pulseH);
    ctx.lineTo(xAtY, y + pulseH);
    ctx.stroke();
    voidWaves[i * 2] += (0.02 + mid * 0.05 + a.rms * 0.03) * dt;
    voidWaves[i * 2 + 1] *= Math.pow(0.985, dt);
    if (voidWaves[i * 2] > 1.05) voidWaves[i * 2 + 1] = 0;
  }

  // ── Horizontal pressure cracks — still rare, still quiet
  for (let i = 0; i < VOID_CRACK_N; i++) {
    const life = voidCracks[i * 2 + 1];
    if (life <= 0) continue;
    const y = topY + voidCracks[i * 2] * lineH;
    ctx.strokeStyle = `rgba(170, 150, 120, ${life * 0.22})`;
    ctx.lineWidth = 0.7;
    const x0 = w * (0.12 + Math.random() * 0.04);
    const x1 = w * (0.78 - Math.random() * 0.04);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y + (Math.random() - 0.5) * 0.8);
    ctx.stroke();
    voidCracks[i * 2 + 1] *= Math.pow(0.975, dt);
  }

  // ── Pointer ripples — concentric faint circles at cursor X. Colour
  //    tint modulated by high-band so different drone colours feel
  //    different to touch.
  for (let i = 0; i < VOID_POINTER_N; i++) {
    const life = voidPointerRipples[i * 3 + 2];
    if (life <= 0) continue;
    const xpx = voidPointerRipples[i * 3] * w;
    const r = voidPointerRipples[i * 3 + 1];
    const rpx = r * Math.max(w, h) * 0.45;
    ctx.strokeStyle = `hsla(${26 + high * 8}, 45%, 55%, ${life * 0.18})`;
    ctx.lineWidth = 0.7 + life * 0.6;
    ctx.beginPath();
    ctx.arc(xpx, h * 0.5, rpx, 0, Math.PI * 2);
    ctx.stroke();
    voidPointerRipples[i * 3 + 1] += 0.012 * dt;
    voidPointerRipples[i * 3 + 2] *= Math.pow(0.965, dt);
  }

  // ── Ember — afterglow on peaks. Position nudged by rms.
  const ex = w * 0.62 + Math.sin(p.t * 0.05) * 1.5;
  const ey = h * 0.58 + Math.sin(p.t * 0.2) * 1.2 + a.rms * 2;
  const er = 1.2 + a.peak * 2.2 + voidEmberGlow * 2.5;
  const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, er * 9);
  g.addColorStop(0, `hsla(26, 80%, 65%, ${0.45 + voidEmberGlow * 0.4 + a.peak * 0.2})`);
  g.addColorStop(0.5, `hsla(22, 60%, 35%, ${0.08 + voidEmberGlow * 0.12})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ex, ey, er * 9, 0, Math.PI * 2);
  ctx.fill();

  // ── Rare arc — on strong transient with ember already glowing, a
  //    faint filament connects the monolith to the ember. Fades fast.
  if (voidEmberGlow > 0.35) {
    const arcAl = (voidEmberGlow - 0.35) * 0.3;
    ctx.strokeStyle = `rgba(220, 190, 150, ${arcAl})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(mx + slabW / 2, ey);
    ctx.quadraticCurveTo((mx + ex) / 2, ey - 30 * voidEmberGlow, ex, ey);
    ctx.stroke();
  }

  // ── Sparse falling dust — a few grains drifting down, barely
  //    visible. Density scales with p.growth so it accrues over time.
  if (!voidDustInit) {
    for (let i = 0; i < VOID_DUST_N; i++) {
      voidDust[i * 3] = Math.random() * w;
      voidDust[i * 3 + 1] = Math.random() * h;
      voidDust[i * 3 + 2] = 0.1 + Math.random() * 0.3;
    }
    voidDustInit = true;
  }
  const dustVisible = Math.floor(VOID_DUST_N * (0.3 + p.growth * 0.6));
  ctx.fillStyle = `rgba(170, 150, 120, ${0.12 + high * 0.08})`;
  for (let i = 0; i < dustVisible; i++) {
    voidDust[i * 3 + 1] += voidDust[i * 3 + 2] * dt;
    if (voidDust[i * 3 + 1] > h) {
      voidDust[i * 3] = Math.random() * w;
      voidDust[i * 3 + 1] = -2;
    }
    ctx.fillRect(voidDust[i * 3], voidDust[i * 3 + 1], 1, 1);
  }

  // ── Patience reward — second tiny ember after long view
  if (p.growth > 0.7) {
    const fade = (p.growth - 0.7) / 0.3;
    const ex2 = w * 0.24;
    const ey2 = h * 0.32;
    const g2 = ctx.createRadialGradient(ex2, ey2, 0, ex2, ey2, 22);
    g2.addColorStop(0, `hsla(30, 50%, 60%, ${0.18 * fade + voidEmberGlow * 0.1})`);
    g2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(ex2 - 22, ey2 - 22, 44, 44);
  }
}

// ─────────────────────────────────────────────────────────────────────
// BEATING FIELD — binaural / microtonal interference bands. Uses the
// active pitch classes to drive slow beat frequencies; close pitches
// produce visible slow moving bands, wide intervals produce stable
// stripes. Feels drone-native, not FFT-reactive.
// ─────────────────────────────────────────────────────────────────────
export function drawBeatingField(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  ctx.fillStyle = "rgba(6, 5, 4, 0.35)";
  ctx.fillRect(0, 0, w, h);

  // Sample the waveform crudely when available; otherwise fall back
  // to a synthetic beat from active pitches.
  const energies = p.activePitches;
  // Gather up to 4 strongest pitch classes
  const picks: { pc: number; e: number }[] = [];
  for (let i = 0; i < 12; i++) {
    if (energies[i] > 0.08) picks.push({ pc: i, e: energies[i] });
  }
  picks.sort((x, y) => y.e - x.e);
  const active = picks.slice(0, 4);

  // Render horizontal bands. The band intensity at row y is sum of
  // cos(k_i * y + phi_i) across pitch classes — close pitches beat
  // where their phases align and cancel, producing slow travelling
  // stripes (that's exactly what binaural beating looks like).
  const bandCount = 90;
  const bandH = h / bandCount;
  const hueBase = 28 + (p.mood.warmth - 0.5) * 18;

  for (let i = 0; i < bandCount; i++) {
    const y = i * bandH;
    // Base pressure from rms so silent state still shows a faint field
    let amp = 0.18 + a.rms * 0.4;
    if (active.length === 0) {
      amp *= 0.6 * (0.5 + 0.5 * Math.cos(i * 0.18 + p.t * 0.2));
    } else {
      let v = 0;
      for (const pk of active) {
        // Each pc maps to a spatial frequency and a slow phase drift.
        // Incommensurate phases so interference truly beats.
        const k = 0.08 + (pk.pc + 1) * 0.022;
        const phi = p.t * (0.25 + pk.pc * 0.017);
        v += Math.cos(k * i + phi) * pk.e;
      }
      amp *= 0.4 + Math.abs(v) * 0.6;
    }
    const lig = 14 + amp * 34;
    ctx.fillStyle = `hsla(${hueBase + i * 0.05}, 28%, ${lig}%, 0.85)`;
    ctx.fillRect(0, y, w, bandH + 1);
  }

  // Phantom centre seam — thin vertical line where in a binaural
  // rig the "phantom image" would sit. Intensifies on peaks.
  ctx.strokeStyle = `rgba(220, 180, 130, ${0.14 + a.peak * 0.35})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();

  // Slow vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2,
                                      w / 2, h / 2, Math.max(w, h) * 0.7);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// ─────────────────────────────────────────────────────────────────────
// TUNING MANUSCRIPT — ritual score of the current tuning. Unequal
// horizontal rules (cents grid) on a dark parchment, ink marks where
// active pitch classes sit, a few quiet numerals, drift lines tracing
// interval motion. Accretes marks on the offscreen buffer so the
// manuscript reads as written, not animated.
// ─────────────────────────────────────────────────────────────────────
let manuscriptCanvas: HTMLCanvasElement | null = null;
let manuscriptCtx: CanvasRenderingContext2D | null = null;
let manuscriptColX = 0;
export function drawTuningManuscript(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  if (!manuscriptCanvas || manuscriptCanvas.width !== w || manuscriptCanvas.height !== h) {
    manuscriptCanvas = document.createElement("canvas");
    manuscriptCanvas.width = w; manuscriptCanvas.height = h;
    manuscriptCtx = manuscriptCanvas.getContext("2d");
    if (manuscriptCtx) {
      manuscriptCtx.fillStyle = "#14100a"; // warm parchment-dark
      manuscriptCtx.fillRect(0, 0, w, h);
    }
    manuscriptColX = 20;
  }
  const off = manuscriptCtx!;
  // Very slow wash — older ink fades over minutes, not seconds.
  off.fillStyle = "rgba(20, 16, 10, 0.008)";
  off.fillRect(0, 0, w, h);

  // Cents grid — 12 horizontal rules at pitch-class heights, spaced
  // by cents (so minor seconds sit closer than tritone↔fifth). Rules
  // are drawn every frame but very thin so they read as the paper
  // ruling, not as active motion.
  const topY = h * 0.12;
  const botY = h * 0.88;
  const span = botY - topY;
  // Map pc 0..11 to cents 0..1100 position
  for (let pc = 0; pc < 12; pc++) {
    const y = topY + (pc / 11) * span;
    off.strokeStyle = `rgba(190, 170, 140, ${0.06 + (pc % 5 === 0 ? 0.04 : 0)})`;
    off.lineWidth = 0.6;
    off.beginPath();
    off.moveTo(30, y);
    off.lineTo(w - 30, y);
    off.stroke();
  }

  // Advance the ink column slowly — every ~3 seconds a new stroke
  // column is written at the current X, and it wraps around when it
  // hits the right margin.
  const writeRate = 0.04 + a.rms * 0.12;
  manuscriptColX += writeRate;
  if (manuscriptColX > w - 20) manuscriptColX = 20;

  // Ink marks — for each pitch class with energy > threshold, place
  // a short horizontal tick at its rule, with jitter proportional to
  // detune (we don't know exact cents here so we use peak as a stand-
  // in for articulation strength).
  const energies = p.activePitches;
  for (let pc = 0; pc < 12; pc++) {
    const e = energies[pc];
    if (e < 0.08) continue;
    const y = topY + (pc / 11) * span;
    const len = 2 + e * 8;
    const al = 0.25 + e * 0.4;
    off.strokeStyle = `rgba(215, 180, 130, ${al})`;
    off.lineWidth = 0.8 + e * 0.6;
    // Jitter with peak so articulation feels hand-written
    const jy = (a.peak - 0.5) * 1.2;
    off.beginPath();
    off.moveTo(manuscriptColX, y + jy);
    off.lineTo(manuscriptColX + len, y + jy);
    off.stroke();
    // Occasional tiny dot above the tick — cents marking
    if (e > 0.3 && Math.random() < 0.08) {
      off.fillStyle = `rgba(215, 180, 130, ${al * 0.8})`;
      off.fillRect(manuscriptColX + len - 1, y - 2, 1, 1);
    }
  }

  // Interval traces — thin lines between consecutive active pitches,
  // drawn occasionally so the manuscript gets interval curves on top
  // of the ticks. Only when two or more classes are lit.
  if (Math.random() < 0.06) {
    const lit: number[] = [];
    for (let pc = 0; pc < 12; pc++) if (energies[pc] > 0.15) lit.push(pc);
    if (lit.length >= 2) {
      off.strokeStyle = "rgba(200, 160, 120, 0.18)";
      off.lineWidth = 0.7;
      off.beginPath();
      for (let i = 0; i < lit.length; i++) {
        const y = topY + (lit[i] / 11) * span;
        const x = manuscriptColX - 1 - i * 0.4;
        if (i === 0) off.moveTo(x, y); else off.lineTo(x, y);
      }
      off.stroke();
    }
  }

  ctx.drawImage(manuscriptCanvas, 0, 0);

  // Vignette — parchment corners dim
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35,
                                      w / 2, h / 2, Math.max(w, h) * 0.8);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}


// ─────────────────────────────────────────────────────────────────────
// FEEDBACK TUNNEL · B&W — same accumulating-zoom mechanic as the
// coloured version, but in pure grayscale. Warm off-white core, peak-
// triggered ring stamp, live vignette. Separate offscreen so it
// doesn't clobber the coloured tunnel's buffer.
// ─────────────────────────────────────────────────────────────────────
let feedbackBWCanvas: HTMLCanvasElement | null = null;
let feedbackBWCtx: CanvasRenderingContext2D | null = null;
export function drawFeedbackTunnelBW(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  if (!feedbackBWCanvas || feedbackBWCanvas.width !== w || feedbackBWCanvas.height !== h) {
    feedbackBWCanvas = document.createElement("canvas");
    feedbackBWCanvas.width = w; feedbackBWCanvas.height = h;
    feedbackBWCtx = feedbackBWCanvas.getContext("2d");
    if (feedbackBWCtx) { feedbackBWCtx.fillStyle = "#0a0a0a"; feedbackBWCtx.fillRect(0, 0, w, h); }
  }
  const off = feedbackBWCtx;
  if (!off || !feedbackBWCanvas) return;

  off.fillStyle = `rgba(6, 6, 6, ${0.05 + a.rms * 0.04})`;
  off.fillRect(0, 0, w, h);

  off.save();
  off.translate(w / 2, h / 2);
  off.rotate(0.004 + a.rms * 0.008 + Math.sin(p.t * 0.07) * 0.002);
  const zoom = 1.015 + a.rms * 0.01 + p.growth * 0.002;
  off.scale(zoom, zoom);
  off.translate(-w / 2, -h / 2);
  off.globalAlpha = 0.9;
  off.drawImage(feedbackBWCanvas, 0, 0);
  off.globalAlpha = 1;
  off.restore();

  const pulseR = Math.min(w, h) * (0.04 + a.peak * 0.1 + a.rms * 0.05);
  const coreBright = Math.min(255, 230 + Math.round(a.peak * 25));
  const midBright = 140 + Math.round(a.rms * 50);
  const grad = off.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, pulseR * 3);
  grad.addColorStop(0, `rgba(${coreBright}, ${coreBright}, ${Math.max(0, coreBright - 14)}, ${0.55 + a.peak * 0.4})`);
  grad.addColorStop(0.5, `rgba(${midBright}, ${midBright}, ${Math.max(0, midBright - 8)}, ${0.22 + a.peak * 0.2})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  off.fillStyle = grad;
  off.fillRect(0, 0, w, h);

  if (a.peak > 0.3) {
    off.strokeStyle = `rgba(255, 250, 240, ${a.peak * 0.6})`;
    off.lineWidth = 1 + a.peak * 2;
    off.beginPath();
    off.arc(w / 2, h / 2, pulseR * 1.3, 0, Math.PI * 2);
    off.stroke();
  }

  ctx.drawImage(feedbackBWCanvas, 0, 0);

  const vign = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.3,
    w / 2, h / 2, Math.max(w, h) * 0.6,
  );
  vign.addColorStop(0, "rgba(0,0,0,0)");
  vign.addColorStop(1, `rgba(0,0,0,${0.3 + a.rms * 0.15})`);
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, w, h);
}

// ─────────────────────────────────────────────────────────────────────
// PETROGLYPHS · Valcamonica rock art — prehistoric Alpine rock carvings
// (4th millennium BCE → Iron Age). Ochre/terracotta symbols pecked into
// slate. Same accretion mechanic as illuminatedGlyphs but with a
// different palette and a 16-shape library drawn from documented
// Camunian motifs: orante (praying figure), warrior, archer, stag,
// rosa camuna, sun wheel, hut, ladder (scalariform), labyrinth spiral,
// axe, footprint, lozenge shuttle, hand, cup-mark rosette, meander
// snake, topographic map. Each polyline is in normalized [-1, 1].
// ─────────────────────────────────────────────────────────────────────
// All 16 glyphs are authentic Camunian motifs per Anati / CCSP / Parco
// Nazionale Naquane documentation. Coordinates: canvas [-1,1] with +y
// pointing DOWN (standard Canvas). No swastika-adjacent forms.
const PETRO_GLYPHS: number[][][] = [
  // 0 Orante — authentic Camunian stick figure, headless, with
  // characteristic bent-elbow arms raised (shoulder → elbow → raised
  // hand). Match the Naquane/Foppe di Nadro form shown in field
  // photography: no circular head, arms form distinct L-shapes.
  [[0, -0.5, 0, 0.3],                         // body (shoulder-line to hip)
   [0, -0.5, -0.3, -0.68, -0.3, -0.98],       // left bent arm: shoulder → elbow → raised hand
   [0, -0.5, 0.3, -0.68, 0.3, -0.98],         // right bent arm: mirror
   [0, 0.3, -0.35, 0.95],                     // left splayed leg
   [0, 0.3, 0.35, 0.95]],                     // right splayed leg
  // 1 Warrior — orante stance + round shield + vertical spear
  [[0, -0.3, 0, 0.2],                         // body
   [0.11, -0.48, 0.06, -0.58, 0, -0.62, -0.06, -0.58, -0.11, -0.48, -0.06, -0.38, 0, -0.34, 0.06, -0.38, 0.11, -0.48], // head
   [0, -0.2, 0.55, -0.2],                     // right arm horizontal (spear grip)
   [0.55, -0.75, 0.55, 0.3],                  // spear (vertical)
   [0, -0.2, -0.35, -0.1],                    // left arm to shield
   // shield (round, offset left) — octagon
   [-0.42, -0.1, -0.48, -0.22, -0.58, -0.25, -0.68, -0.22, -0.72, -0.1, -0.68, 0.02, -0.58, 0.05, -0.48, 0.02, -0.42, -0.1],
   [0, 0.2, -0.25, 0.8],                      // left leg
   [0, 0.2, 0.25, 0.8]],                      // right leg
  // 2 Archer — profile figure drawing a bow. Body left of centre, bow
  // on right, drawn bowstring + horizontal arrow.
  [[-0.25, -0.3, -0.25, 0.2],                 // body
   [-0.12, -0.48, -0.18, -0.58, -0.25, -0.62, -0.32, -0.58, -0.38, -0.48, -0.32, -0.38, -0.25, -0.34, -0.18, -0.38, -0.12, -0.48], // head
   [-0.25, -0.2, 0.22, -0.2],                 // forward arm gripping bow
   [-0.25, -0.2, -0.45, -0.12],               // rear arm pulling string
   // bow — semicircle opening right (polyline arc)
   [0.22, -0.62, 0.42, -0.52, 0.55, -0.35, 0.6, -0.2, 0.55, -0.05, 0.42, 0.12, 0.22, 0.22],
   [0.22, -0.62, 0.22, 0.22],                 // bowstring (chord)
   [-0.45, -0.2, 0.9, -0.2],                  // arrow (from draw hand out through bow)
   [-0.25, 0.2, -0.45, 0.8],
   [-0.25, 0.2, -0.05, 0.8]],
  // 3 Stag — horizontal body, 4 legs, neck + branched antlers, short tail.
  [[-0.6, 0.0, 0.5, 0.0, 0.5, 0.25, -0.6, 0.25, -0.6, 0.0],
   [-0.48, 0.25, -0.48, 0.75],                // front-left leg
   [-0.25, 0.25, -0.25, 0.75],
   [0.22, 0.25, 0.22, 0.75],
   [0.45, 0.25, 0.45, 0.75],                  // back-right leg
   [0.5, 0.05, 0.72, -0.22],                  // neck
   // antlers — 2 main forks + 3 tines
   [0.72, -0.22, 0.68, -0.8],
   [0.72, -0.22, 0.9, -0.75],
   [0.75, -0.5, 0.62, -0.58],                 // tine
   [0.78, -0.4, 0.9, -0.4],                   // tine
   [0.82, -0.58, 0.95, -0.52],                // tine
   [-0.6, 0.0, -0.75, -0.18]],                // tail flick
  // 4 Rosa Camuna — sentinel; real rendering in stampRosaCamuna
  // (Type 2: X-saltire meander + 9 cup marks on a 3x3 grid).
  [[0, 0]],
  // 5 Sun wheel / cross-in-circle — the canonical Camunian 4-spoked
  // wheel. Outer circle + horizontal+vertical diameters + 4 short
  // diagonal outer rays.
  [[0.5, 0, 0.35, 0.35, 0, 0.5, -0.35, 0.35, -0.5, 0, -0.35, -0.35, 0, -0.5, 0.35, -0.35, 0.5, 0],
   [-0.5, 0, 0.5, 0],                         // horizontal diameter
   [0, -0.5, 0, 0.5],                         // vertical diameter
   [0.6, -0.6, 0.85, -0.85],                  // NE outer ray
   [-0.6, -0.6, -0.85, -0.85],                // NW
   [0.6, 0.6, 0.85, 0.85],                    // SE
   [-0.6, 0.6, -0.85, 0.85]],                 // SW
  // 6 Hut — pile-dwelling / pitched-roof house. Base rectangle +
  // triangular roof overhanging + central door. Optional stilts.
  [[-0.5, 0.4, 0.5, 0.4, 0.5, -0.2, -0.5, -0.2, -0.5, 0.4],
   [-0.7, -0.2, 0, -0.8, 0.7, -0.2],          // roof triangle (overhangs eaves)
   [-0.12, 0.4, -0.12, 0.05, 0.12, 0.05, 0.12, 0.4], // door
   [-0.3, 0.4, -0.3, 0.9],                    // stilt left
   [0.3, 0.4, 0.3, 0.9]],                     // stilt right
  // 7 Scalariform — ladder, 2 rails + 5 rungs
  [[-0.3, -0.9, -0.3, 0.9],
   [0.3, -0.9, 0.3, 0.9],
   [-0.3, -0.55, 0.3, -0.55],
   [-0.3, -0.2, 0.3, -0.2],
   [-0.3, 0.15, 0.3, 0.15],
   [-0.3, 0.5, 0.3, 0.5],
   [-0.3, 0.85, 0.3, 0.85]],
  // 8 Labyrinth — squared 3-circuit, entering from the bottom-left.
  // Continuous polyline threading inward.
  [[-0.85, 0.85, -0.85, -0.65, 0.85, -0.65, 0.85, 0.4, -0.55, 0.4, -0.55, -0.35, 0.55, -0.35, 0.55, 0.1, -0.25, 0.1, -0.25, -0.05, 0.25, -0.05]],
  // 9 Axe — hafted bronze axe. Vertical haft + flared trapezoidal
  // blade head attached to the right.
  [[0, 0.9, 0, -0.6]],    // haft
  // ...plus blade as its own shape appended in a separate entry? No —
  // glyph is one logical unit. Append the blade as a second polyline:
  // ATT: each polyline in the array is rendered as one `beginPath`/
  // `stroke`, so multiple shapes per glyph is fine. Splitting here:
  // (blade trapezoid)
  // Done in sequel line below.
  // NOTE: combining in single glyph entry:
  // The entry below replaces the two-line version.
  // 9 Axe — combined entry:
  // (overwrite note above)
  // 10 Footprint — oval sole + 5 small toe circles above
  // (entry 10)
  // 11 Shield — round studded
  // (entry 11)
  // 12 Chariot — 2 wheels + platform + draft pole
  // (entry 12)
  // 13 Plough scene — ox + beam + plough + ploughman
  // (entry 13)
  // 14 Duellists — 2 mirrored warriors, crossed weapons
  // (entry 14)
  // 15 Bedolina map — irregular rectangular fields + cup-dot interiors + connectors
  // (entry 15)
];

// Append complete multi-part glyphs inline (not split across commits)
// — array positions 9–15 overwritten here for clarity:
PETRO_GLYPHS[9] = [
  // Axe — haft + flared blade trapezoid to the right
  [0, 0.9, 0, -0.6],                           // haft
  [0, -0.3, 0.7, -0.5, 0.7, -0.1, 0, -0.3],    // blade trapezoid flared
];
PETRO_GLYPHS[10] = [
  // Footprint — oval sole outline + 5 small toe circles
  [-0.25, -0.45, -0.2, -0.4, 0.2, -0.4, 0.28, -0.25, 0.28, 0.3, 0.2, 0.65, 0.05, 0.8, -0.12, 0.8, -0.25, 0.65, -0.3, 0.3, -0.3, -0.25, -0.25, -0.45],
  // toes as tiny circles (approx 6-gon each)
  [-0.2, -0.5, -0.15, -0.54, -0.08, -0.54, -0.05, -0.5, -0.08, -0.46, -0.15, -0.46, -0.2, -0.5],
  [-0.08, -0.58, -0.03, -0.62, 0.04, -0.62, 0.07, -0.58, 0.04, -0.54, -0.03, -0.54, -0.08, -0.58],
  [0.04, -0.58, 0.09, -0.62, 0.16, -0.62, 0.19, -0.58, 0.16, -0.54, 0.09, -0.54, 0.04, -0.58],
  [0.16, -0.54, 0.21, -0.57, 0.27, -0.56, 0.3, -0.52, 0.27, -0.48, 0.21, -0.48, 0.16, -0.52, 0.16, -0.54],
  [0.26, -0.44, 0.3, -0.46, 0.35, -0.43, 0.36, -0.39, 0.33, -0.36, 0.28, -0.37, 0.25, -0.4, 0.26, -0.44],
];
PETRO_GLYPHS[11] = [
  // Shield — round, 12-gon outer edge + central boss + 6 studs ring
  [0.7, 0, 0.6, 0.35, 0.35, 0.6, 0, 0.7, -0.35, 0.6, -0.6, 0.35, -0.7, 0, -0.6, -0.35, -0.35, -0.6, 0, -0.7, 0.35, -0.6, 0.6, -0.35, 0.7, 0],
  // central boss (small octagon, will read as filled dot with stroke)
  [0.12, 0, 0.08, 0.08, 0, 0.12, -0.08, 0.08, -0.12, 0, -0.08, -0.08, 0, -0.12, 0.08, -0.08, 0.12, 0],
  // 6 studs around mid-ring at r=0.4, each a tiny hex
  [0.4, 0, 0.42, 0.04, 0.42, 0.08, 0.4, 0.1, 0.38, 0.08, 0.38, 0.04, 0.4, 0],
  [0.2, 0.346, 0.24, 0.36, 0.24, 0.4, 0.2, 0.42, 0.16, 0.4, 0.16, 0.36, 0.2, 0.346],
  [-0.2, 0.346, -0.16, 0.36, -0.16, 0.4, -0.2, 0.42, -0.24, 0.4, -0.24, 0.36, -0.2, 0.346],
  [-0.4, 0, -0.38, 0.04, -0.38, 0.08, -0.4, 0.1, -0.42, 0.08, -0.42, 0.04, -0.4, 0],
  [-0.2, -0.346, -0.16, -0.33, -0.16, -0.29, -0.2, -0.27, -0.24, -0.29, -0.24, -0.33, -0.2, -0.346],
  [0.2, -0.346, 0.24, -0.33, 0.24, -0.29, 0.2, -0.27, 0.16, -0.29, 0.16, -0.33, 0.2, -0.346],
];
PETRO_GLYPHS[12] = [
  // Chariot — 2 wheels (cross-in-circle) + platform + draft pole + yoke
  // Left wheel
  [-0.45, 0.15, -0.55, 0.28, -0.75, 0.4, -0.55, 0.52, -0.45, 0.65, -0.35, 0.52, -0.25, 0.4, -0.35, 0.28, -0.45, 0.15],
  [-0.75, 0.4, -0.25, 0.4],                   // left wheel horizontal
  [-0.5, 0.15, -0.5, 0.65],                   // left wheel vertical
  // Right wheel
  [0.45, 0.15, 0.35, 0.28, 0.25, 0.4, 0.35, 0.52, 0.45, 0.65, 0.55, 0.52, 0.75, 0.4, 0.55, 0.28, 0.45, 0.15],
  [0.25, 0.4, 0.75, 0.4],
  [0.5, 0.15, 0.5, 0.65],
  // Platform connecting wheel tops
  [-0.5, 0.15, 0.5, 0.15],
  // Draft pole + yoke (extending forward)
  [0, 0.15, 0, -0.5],
  [-0.25, -0.5, 0.25, -0.5],
];
PETRO_GLYPHS[13] = [
  // Plough scene — one quadruped ox (left) + diagonal beam + plough + ploughman (right)
  // Ox body
  [-0.9, 0.1, -0.25, 0.1, -0.25, 0.4, -0.9, 0.4, -0.9, 0.1],
  [-0.8, 0.4, -0.8, 0.75],                    // front leg
  [-0.5, 0.4, -0.5, 0.75],                    // rear leg
  // Ox head + horns
  [-0.9, 0.2, -1.0, 0.05, -0.9, -0.05, -0.9, 0.2],
  [-1.0, 0.05, -1.08, -0.1],                  // horn up-left
  [-0.9, -0.05, -0.82, -0.2],                 // horn up-right
  // Plough beam: diagonal from ox rear down-right
  [-0.3, 0.2, 0.45, 0.55],
  // Ploughshare (triangle) at end of beam
  [0.45, 0.55, 0.65, 0.55, 0.55, 0.78, 0.45, 0.55],
  // Ploughman stick figure handling plough
  [0.55, 0.4, 0.55, 0.78],                     // body
  [0.55, 0.4, 0.45, 0.55],                     // arm down to plough
  [0.58, 0.3, 0.55, 0.25, 0.52, 0.3, 0.5, 0.35, 0.55, 0.4, 0.6, 0.35, 0.58, 0.3], // head
];
PETRO_GLYPHS[14] = [
  // Duellists — two mirrored warriors, crossed weapons meeting at centre
  // Left warrior
  [-0.55, -0.3, -0.55, 0.2],                   // body
  [-0.43, -0.45, -0.48, -0.55, -0.55, -0.58, -0.62, -0.55, -0.67, -0.45, -0.62, -0.35, -0.55, -0.32, -0.48, -0.35, -0.43, -0.45],
  [-0.55, 0.2, -0.75, 0.7],                    // left leg
  [-0.55, 0.2, -0.35, 0.7],                    // right leg
  // Left weapon (crossing to centre)
  [-0.55, -0.2, 0, 0.0],                       // spear/sword
  // Left shield (outer)
  [-0.78, -0.1, -0.83, -0.18, -0.92, -0.2, -0.97, -0.12, -0.95, -0.02, -0.88, 0.02, -0.8, 0, -0.78, -0.1],
  [-0.55, -0.15, -0.78, -0.1],                 // outer arm to shield

  // Right warrior (mirror)
  [0.55, -0.3, 0.55, 0.2],
  [0.43, -0.45, 0.48, -0.55, 0.55, -0.58, 0.62, -0.55, 0.67, -0.45, 0.62, -0.35, 0.55, -0.32, 0.48, -0.35, 0.43, -0.45],
  [0.55, 0.2, 0.75, 0.7],
  [0.55, 0.2, 0.35, 0.7],
  [0.55, -0.2, 0, 0.0],                        // sword crossing
  [0.78, -0.1, 0.83, -0.18, 0.92, -0.2, 0.97, -0.12, 0.95, -0.02, 0.88, 0.02, 0.8, 0, 0.78, -0.1],
  [0.55, -0.15, 0.78, -0.1],
];
PETRO_GLYPHS[15] = [
  // Bedolina-type map — 4 irregular rectangular fields with cup-dot
  // interiors + 2 connector paths. Authentic to the Bedolina Rock 1
  // topographic carving.
  [-0.85, -0.55, -0.15, -0.55, -0.15, 0.05, -0.85, 0.05, -0.85, -0.55],
  [-0.1, -0.3, 0.5, -0.3, 0.5, 0.25, -0.1, 0.25, -0.1, -0.3],
  [-0.5, 0.3, -0.5, 0.78, 0.35, 0.78, 0.35, 0.3, -0.5, 0.3],
  [0.55, 0.3, 0.85, 0.3, 0.85, 0.78, 0.55, 0.78, 0.55, 0.3],
  // cup dots inside fields (tiny closed triangles read as dots)
  [-0.55, -0.3, -0.5, -0.28, -0.55, -0.25, -0.6, -0.28, -0.55, -0.3],
  [-0.35, -0.2, -0.3, -0.18, -0.35, -0.15, -0.4, -0.18, -0.35, -0.2],
  [0.15, 0.0, 0.2, 0.02, 0.15, 0.05, 0.1, 0.02, 0.15, 0.0],
  [0.3, -0.15, 0.35, -0.13, 0.3, -0.1, 0.25, -0.13, 0.3, -0.15],
  [-0.2, 0.55, -0.15, 0.57, -0.2, 0.6, -0.25, 0.57, -0.2, 0.55],
  [0.7, 0.5, 0.75, 0.52, 0.7, 0.55, 0.65, 0.52, 0.7, 0.5],
  // connector paths
  [-0.4, 0.05, -0.4, 0.3],
  [0.3, 0.25, 0.3, 0.3],
  [0.35, 0.55, 0.55, 0.55],
];

let petroCanvas: HTMLCanvasElement | null = null;
let petroCtx: CanvasRenderingContext2D | null = null;
let petroLast = 0;
let petroPrevPeak = 0;
interface RecentPetro { x: number; y: number; sz: number; gi: number; pc: number; age: number; }
const recentPetro: RecentPetro[] = [];
// Rising incense wisps — slow upward smoke instead of falling dust.
// x, y, vx, vy, life (life decays).
interface PetroWisp { x: number; y: number; vx: number; vy: number; life: number; size: number; }
const petroWisps: PetroWisp[] = [];
// Pointer inscription cooldown so hover-drags don't carpet the rock.
let petroPointerCd = 0;
let petroPointerWasDown = false;
// Procession state — accumulates when rms is sustained + one pitch
// dominates. When full, triggers a row of orantes / warriors.
let petroProcessionGauge = 0;
// Lamp flicker — low-pass random walk drives the firelight source.
let petroLamp = 0.5;

function ensurePetro(w: number, h: number) {
  if (!petroCanvas || petroCanvas.width !== w || petroCanvas.height !== h) {
    petroCanvas = document.createElement("canvas");
    petroCanvas.width = w; petroCanvas.height = h;
    petroCtx = petroCanvas.getContext("2d");
    const g = petroCtx!;
    // Deep umber sacred-cave base — richer and darker than before
    g.fillStyle = "#140c08";
    g.fillRect(0, 0, w, h);
    // Dense rock texture — more grains, varied warmth, so the stone
    // has real weathered body under the glyphs.
    for (let i = 0; i < 2600; i++) {
      const lig = 6 + Math.random() * 18;
      const hue = 18 + Math.random() * 12;
      g.fillStyle = `hsla(${hue}, 22%, ${lig}%, 0.55)`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    // Fissure lines — deeper cracks + some hair-thin ones
    g.strokeStyle = "rgba(50, 32, 22, 0.4)";
    g.lineWidth = 0.6;
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * w * 0.12;
        y += (Math.random() - 0.5) * h * 0.12;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Hair-thin weathering cracks
    g.strokeStyle = "rgba(70, 46, 30, 0.22)";
    g.lineWidth = 0.4;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (Math.random() - 0.5) * w * 0.08;
        y += (Math.random() - 0.5) * h * 0.08;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Lichen / patina patches — sparse darker blotches
    for (let i = 0; i < 26; i++) {
      const bx = Math.random() * w;
      const by = Math.random() * h;
      const br = 6 + Math.random() * 20;
      const grd = g.createRadialGradient(bx, by, 0, bx, by, br);
      grd.addColorStop(0, "rgba(25, 18, 14, 0.6)");
      grd.addColorStop(1, "rgba(25, 18, 14, 0)");
      g.fillStyle = grd;
      g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    recentPetro.length = 0;
    petroWisps.length = 0;
  }
}

function pickPetroIdx(pc: number): number {
  // 16 glyphs for 12 pitch classes — pc maps to canonical slot, but
  // 50/50 chance to pick one of the four "advanced" alternates
  // (12-15: hand, rosette, meander, map). Gives pc-stability with
  // visual variety.
  if (Math.random() < 0.25) return 12 + (pc % 4);
  return pc % 12;
}

// Rosa Camuna Type 2 — one arm of the saltire meander, drawn from
// centre cup (0,0) outward through the adjacent cardinal cup and
// terminating at a corner cup (0.6, -0.6). Rotated 4× for the full
// X-shape. The S-curve passes near the cardinal cup so the ribbon
// "swallows" all 9 grid points.
const ROSA_ARM_PATH: readonly (readonly [number, number])[] = [
  [ 0.05, -0.02],
  [ 0.15, -0.22],
  [ 0.05, -0.40],
  [ 0.00, -0.58],   // brush past the top cardinal cup
  [ 0.18, -0.62],
  [ 0.40, -0.55],
  [ 0.55, -0.52],
  [ 0.62, -0.62],   // terminate at NE corner cup
];
// 9 cup marks on a 3x3 grid — the canonical Rosa Camuna Type 2
// layout (Regione Lombardia logo form). Cups sit at the 9 intersections
// of a 3x3 grid; the saltire meander weaves between them.
const ROSA_CUPS: readonly (readonly [number, number, number])[] = [
  // central (largest)
  [ 0.00,  0.00, 0.10],
  // 4 cardinal (top/bottom/left/right of grid)
  [ 0.00, -0.60, 0.065],
  [ 0.60,  0.00, 0.065],
  [ 0.00,  0.60, 0.065],
  [-0.60,  0.00, 0.065],
  // 4 corners (NE, SE, SW, NW)
  [ 0.60, -0.60, 0.07],
  [ 0.60,  0.60, 0.07],
  [-0.60,  0.60, 0.07],
  [-0.60, -0.60, 0.07],
];
function stampRosaCamuna(
  g: CanvasRenderingContext2D,
  sz: number, energy: number, growth: number, phaseT: number,
) {
  // Very slow rotation captured per-stamp — each stamp is frozen into
  // the offscreen buffer at a slightly different orientation, so the
  // long-view field reads as hand-carved variants rather than a
  // spinning animation.
  const rot = phaseT * 0.008 + (Math.random() - 0.5) * 0.15;
  g.save();
  g.rotate(rot);
  // Ribbon thickness scales with energy + rms-proxy (passed via energy)
  const ribbonW = Math.max(2.2, sz * 0.16 + energy * sz * 0.12);
  g.lineWidth = ribbonW;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = `hsla(${18 + energy * 6}, ${58 + energy * 18}%, ${40 + energy * 14}%, 0.90)`;
  g.shadowColor = "rgba(120, 60, 22, 0.22)";
  g.shadowBlur = 1.2 + energy * 1.4;

  // 4 arms rotated by 90° around the centre. Adds small random jitter
  // per stamping so successive carvings look hand-made.
  for (let r = 0; r < 4; r++) {
    const ang = r * (Math.PI / 2);
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    g.beginPath();
    for (let i = 0; i < ROSA_ARM_PATH.length; i++) {
      const x = ROSA_ARM_PATH[i][0] * sz + (Math.random() - 0.5) * 0.9;
      const y = ROSA_ARM_PATH[i][1] * sz + (Math.random() - 0.5) * 0.9;
      const rx = x * cosA - y * sinA;
      const ry = x * sinA + y * cosA;
      if (i === 0) g.moveTo(rx, ry); else g.lineTo(rx, ry);
    }
    g.stroke();
    // Terminal lobe — filled circle at each arm's tip
    const tx = ROSA_ARM_PATH[ROSA_ARM_PATH.length - 1][0] * sz;
    const ty = ROSA_ARM_PATH[ROSA_ARM_PATH.length - 1][1] * sz;
    const lx = tx * cosA - ty * sinA;
    const ly = tx * sinA + ty * cosA;
    g.fillStyle = `hsla(${16 + energy * 6}, ${55 + energy * 18}%, ${34 + energy * 12}%, 0.92)`;
    g.beginPath();
    g.arc(lx, ly, ribbonW * 0.75 + sz * 0.04, 0, Math.PI * 2);
    g.fill();
  }

  // Cup marks — filled circles on top of the ribbon. Central cup is
  // larger and slightly brighter. Cup size pulses very faintly with
  // energy (the carver's sureness of hand).
  g.shadowBlur = 0;
  for (let i = 0; i < ROSA_CUPS.length; i++) {
    const [cx, cy, cr] = ROSA_CUPS[i];
    const r = cr * sz * (1 + energy * 0.22);
    // Jitter per stamp
    const jx = (Math.random() - 0.5) * 0.8;
    const jy = (Math.random() - 0.5) * 0.8;
    const lig = i === 0 ? 30 + energy * 16 : 22 + energy * 10;
    g.fillStyle = `hsla(14, 40%, ${lig}%, 0.95)`;
    g.beginPath();
    g.arc(cx * sz + jx, cy * sz + jy, r, 0, Math.PI * 2);
    g.fill();
    // Thin lighter rim for depth
    g.strokeStyle = `hsla(22, 45%, ${lig + 18}%, 0.5)`;
    g.lineWidth = 0.5;
    g.beginPath();
    g.arc(cx * sz + jx, cy * sz + jy, r + 0.4, 0, Math.PI * 2);
    g.stroke();
  }

  // Growth accretion — pecked weathered border (same spirit as other
  // petroglyphs but at Rosa Camuna's bbox radius)
  if (growth > 0.55) {
    g.strokeStyle = `hsla(20, 40%, 32%, ${(growth - 0.55) * 0.45})`;
    g.lineWidth = 0.6;
    const ringR = sz * 1.35;
    g.beginPath();
    const pts = 32;
    for (let i = 0; i < pts; i++) {
      const th = (i / pts) * Math.PI * 2;
      const rr = ringR + (Math.random() - 0.5) * 1.6;
      const x = Math.cos(th) * rr;
      const y = Math.sin(th) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
  }
  g.restore();
}

function stampPetro(
  g: CanvasRenderingContext2D,
  gx: number, gy: number, sz: number, gi: number, energy: number,
  growth: number, phaseT: number,
) {
  // Rosa Camuna takes the bespoke renderer
  if (gi === 4) {
    g.save();
    g.translate(gx, gy);
    stampRosaCamuna(g, sz, energy, growth, phaseT);
    g.restore();
    return;
  }
  const strokes = PETRO_GLYPHS[gi];
  g.save();
  g.translate(gx, gy);
  // Pecked-line feel — slight jitter per vertex, ochre on slate. No
  // heavy blur (not gilt; these are chisel scars, not gold leaf).
  g.lineWidth = 1.6 + energy * 1.4;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = `hsla(${18 + energy * 6}, ${55 + energy * 20}%, ${42 + energy * 14}%, 0.88)`;
  g.shadowColor = "rgba(140, 70, 30, 0.25)";
  g.shadowBlur = 1.5 + energy * 1.5;
  for (const path of strokes) {
    g.beginPath();
    for (let i = 0; i < path.length; i += 2) {
      const jx = (Math.random() - 0.5) * 0.9;
      const jy = (Math.random() - 0.5) * 0.9;
      const px = path[i] * sz + jx;
      const py = path[i + 1] * sz + jy;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
  }
  // Secondary darker pass — double-pecked line for stronger stamps
  if (energy > 0.4) {
    g.strokeStyle = `hsla(14, 45%, 26%, ${(energy - 0.4) * 0.9})`;
    g.lineWidth = 0.7;
    g.shadowBlur = 0;
    for (const path of strokes) {
      g.beginPath();
      for (let i = 0; i < path.length; i += 2) {
        const px = path[i] * sz + (Math.random() - 0.5) * 0.6;
        const py = path[i + 1] * sz + (Math.random() - 0.5) * 0.6;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  // Growth accretion — a pecked border ring appears after long view
  if (growth > 0.55) {
    g.strokeStyle = `hsla(20, 40%, 32%, ${(growth - 0.55) * 0.5})`;
    g.lineWidth = 0.6;
    const ringR = sz * 1.35;
    const pts = 28;
    g.beginPath();
    for (let i = 0; i < pts; i++) {
      const th = (i / pts) * Math.PI * 2;
      const rr = ringR + (Math.random() - 0.5) * 1.5;
      const x = Math.cos(th) * rr;
      const y = Math.sin(th) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
  }
  g.restore();
}

// Persistent "heat" counter — on every peak, spikes. Decays over ~3s.
// Used to ripple halos across recently-carved glyphs so the whole
// cliff face visibly responds to transients, not just the fresh stamp.
let petroHeat = 0;
// Pitch-centroid-biased placement — a hot-zone anchor that drifts.
let petroAnchorX = 0.5;
let petroAnchorY = 0.5;

export function drawPetroglyphs(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  ensurePetro(w, h);
  const g = petroCtx!;
  // Very slow wash — carvings persist like ancient stone
  g.fillStyle = "rgba(20, 12, 8, 0.004)";
  g.fillRect(0, 0, w, h);

  const now = p.t;
  const dt = p.dtScale ?? 1;

  // ── Spectral bands (mid not used yet; kept for band-weighted motif)
  let low = 0, high = 0;
  for (let i = 0; i < 8; i++) low += a.spectrum[i] ?? 0;
  for (let i = 20; i < 32; i++) high += a.spectrum[i] ?? 0;
  low /= 8; high /= 12;

  // Transient heat — spike on peaks, decay every frame
  if (a.peak > petroPrevPeak + 0.08) {
    petroHeat = Math.min(1, petroHeat + a.peak * 0.9);
  }
  petroHeat *= Math.pow(0.965, dt);

  // Oil-lamp flicker driving the firelight source — low-pass random
  // walk, not a sine, so the fire never feels mechanical.
  const lampTarget = 0.35 + Math.random() * 0.65 + a.rms * 0.2;
  petroLamp += (lampTarget - petroLamp) * 0.06 * dt;

  // Pitch-centroid anchor
  let pitchCx = 0, pitchCy = 0, pitchMass = 0;
  for (let i = 0; i < 12; i++) {
    const e = p.activePitches[i];
    const ang = (i / 12) * Math.PI * 2;
    pitchCx += Math.cos(ang) * e;
    pitchCy += Math.sin(ang) * e;
    pitchMass += e;
  }
  const targetX = pitchMass > 0.05 ? 0.5 + (pitchCx / pitchMass) * 0.25 : 0.5;
  const targetY = pitchMass > 0.05 ? 0.5 + (pitchCy / pitchMass) * 0.25 : 0.5;
  const k = 1 - Math.pow(0.985, dt);
  petroAnchorX += (targetX - petroAnchorX) * k;
  petroAnchorY += (targetY - petroAnchorY) * k;

  // ── Pointer inscription — click/tap on the rock carves a glyph at
  //    the cursor. Hover with no press shows a faint preview halo.
  //    Cooldown prevents carpeting during drags.
  petroPointerCd -= dt;
  const pointerDown = p.pointerDown;
  if (p.pointer && pointerDown && !petroPointerWasDown && petroPointerCd <= 0) {
    const px = p.pointer.x * w;
    const py = p.pointer.y * h;
    // Prefer the strongest active pitch class for the glyph selection;
    // if no pitches lit, fall back to a random authentic motif.
    let bestPc = -1, bestE = 0.08;
    for (let i = 0; i < 12; i++) {
      if (p.activePitches[i] > bestE) { bestE = p.activePitches[i]; bestPc = i; }
    }
    const gi = bestPc >= 0 ? pickPetroIdx(bestPc) : Math.floor(Math.random() * 16);
    stampPetro(g, px, py, 28 + a.rms * 24, gi, Math.max(0.3, bestE), p.growth, now);
    recentPetro.push({ x: px, y: py, sz: 28 + a.rms * 24, gi, pc: bestPc >= 0 ? bestPc : gi % 12, age: 0 });
    if (recentPetro.length > 20) recentPetro.shift();
    // Burst of rising wisps — the chisel stirred the dust
    for (let w0 = 0; w0 < 8; w0++) {
      petroWisps.push({
        x: px + (Math.random() - 0.5) * 12,
        y: py + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.3 - Math.random() * 0.8,
        life: 1,
        size: 0.8 + Math.random() * 1.2,
      });
    }
    petroPointerCd = 10; // frames
  }
  petroPointerWasDown = pointerDown;

  // ── Procession gauge — builds when a dominant pitch is sustained.
  //    When it fills, triggers a ROW of orantes (authentic Naquane
  //    scene composition).
  const dominantE = pitchMass > 0.05 ? (pitchCx * pitchCx + pitchCy * pitchCy) / (pitchMass * pitchMass) : 0;
  if (a.rms > 0.08 && dominantE > 0.25) {
    petroProcessionGauge += 0.004 * dt * (0.3 + a.rms);
  } else {
    petroProcessionGauge *= Math.pow(0.985, dt);
  }
  if (petroProcessionGauge > 1) {
    petroProcessionGauge = 0;
    // Spawn 4-5 orantes (gi 0) in a row at a random y. The row is
    // centred on the pitch-centroid anchor X.
    const count = 4 + Math.floor(Math.random() * 2);
    const rowY = h * (0.25 + Math.random() * 0.5);
    const rowSz = 28;
    const spacing = rowSz * 1.8;
    const cxRow = Math.max(spacing * count * 0.5 + 20, Math.min(w - spacing * count * 0.5 - 20, petroAnchorX * w));
    const xStart = cxRow - ((count - 1) / 2) * spacing;
    for (let i = 0; i < count; i++) {
      const px = xStart + i * spacing + (Math.random() - 0.5) * 4;
      const py = rowY + (Math.random() - 0.5) * 6;
      stampPetro(g, px, py, rowSz, 0, 0.6, p.growth, now);
      recentPetro.push({ x: px, y: py, sz: rowSz, gi: 0, pc: 0, age: 0 });
    }
    if (recentPetro.length > 22) recentPetro.splice(0, recentPetro.length - 22);
  }

  // ── Spawn cadence — louder drones carve faster
  const spawnEvery = Math.max(0.35, 1.3 - a.rms * 0.9);
  if (now - petroLast > spawnEvery) {
    petroLast = now;
    const order: { pc: number; e: number }[] = [];
    for (let i = 0; i < 12; i++) {
      if (p.activePitches[i] > 0.08) order.push({ pc: i, e: p.activePitches[i] });
    }
    order.sort((x, y) => y.e - x.e);
    const picks = order.slice(0, Math.min(3, order.length));
    for (let kk = 0; kk < picks.length; kk++) {
      const { pc, e } = picks[kk];
      // Band-weighted motif selection — low frequencies weight toward
      // weighty symbols (axe/shield/duellists), high toward airy
      // (orante/sun/archer), mid toward narrative (stag/warrior/plough).
      let gi: number;
      const r = Math.random();
      if (r < low * 0.6) gi = [9, 11, 14][Math.floor(Math.random() * 3)];
      else if (r < low * 0.6 + high * 0.7) gi = [0, 2, 5][Math.floor(Math.random() * 3)];
      else if (r < 0.6) gi = [1, 3, 13][Math.floor(Math.random() * 3)];
      else gi = pickPetroIdx(pc);
      const sz = (22 + e * 28) * (kk === 0 ? 1 : 0.6 - kk * 0.08);
      let gx: number, gy: number;
      if (Math.random() < 0.6) {
        const ax = petroAnchorX * w;
        const ay = petroAnchorY * h;
        const spread = Math.min(w, h) * (0.15 + p.growth * 0.1);
        gx = Math.max(60, Math.min(w - 60, ax + (Math.random() - 0.5) * spread));
        gy = Math.max(60, Math.min(h - 60, ay + (Math.random() - 0.5) * spread));
      } else {
        gx = 60 + Math.random() * (w - 120);
        gy = 60 + Math.random() * (h - 120);
      }
      stampPetro(g, gx, gy, sz, gi, e, p.growth, now);
      recentPetro.push({ x: gx, y: gy, sz, gi, pc, age: 0 });
      if (recentPetro.length > 20) recentPetro.shift();
      // Dust puff on every stamp — rising wisps seeded at glyph centre
      for (let wk = 0; wk < 3 + Math.floor(e * 4); wk++) {
        petroWisps.push({
          x: gx + (Math.random() - 0.5) * sz * 0.5,
          y: gy + (Math.random() - 0.5) * sz * 0.5,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -0.2 - Math.random() * 0.6,
          life: 0.8 + Math.random() * 0.3,
          size: 0.6 + Math.random() * 1.0,
        });
      }
    }
  }

  // ── Peak transient — single larger "action" glyph; very loud peaks
  //    scatter a footprint trail. Heat boost triggers resonance bloom.
  if (a.peak > petroPrevPeak + 0.08) {
    const actionGi = [1, 2, 3, 9, 11, 14][Math.floor(Math.random() * 6)];
    const bx = 80 + Math.random() * (w - 160);
    const by = 80 + Math.random() * (h - 160);
    stampPetro(g, bx, by, 30 + a.peak * 30, actionGi, Math.min(1, a.peak + 0.2), p.growth, now);
    recentPetro.push({ x: bx, y: by, sz: 30 + a.peak * 30, gi: actionGi, pc: actionGi % 12, age: 0 });
    if (a.peak > 0.55) {
      const tx0 = 60 + Math.random() * (w - 240);
      const ty0 = 60 + Math.random() * (h - 120);
      for (let i = 0; i < 4; i++) {
        stampPetro(g, tx0 + i * 36, ty0 + (i % 2) * 8, 14, 10, 0.5, p.growth, now);
      }
    }
  }
  petroPrevPeak = a.peak;

  for (let i = recentPetro.length - 1; i >= 0; i--) {
    recentPetro[i].age += 0.012 * dt;
    if (recentPetro[i].age > 4) recentPetro.splice(i, 1);
  }

  // ── Rising incense wisps — slow upward drift from ground level up,
  //    plus audio-gated spawns from the bottom edge. Replaces the old
  //    falling-chips motion with a more sacred rising smoke.
  if (a.rms > 0.03 && Math.random() < 0.25 + a.rms * 0.9 && petroWisps.length < 80) {
    petroWisps.push({
      x: Math.random() * w,
      y: h + 4,
      vx: (Math.random() - 0.5) * 0.2,
      vy: -0.4 - Math.random() * 0.6,
      life: 1,
      size: 1 + Math.random() * 2,
    });
  }

  // ── Compose the offscreen rock face with a whole-wall breathing
  //    offset driven by low-band energy (seismic rumble) + slow sine.
  const shakeX = Math.sin(p.t * 0.18) * 1.2 + low * (Math.random() - 0.5) * 3;
  const shakeY = Math.cos(p.t * 0.14) * 0.8 + low * (Math.random() - 0.5) * 2;
  ctx.save();
  ctx.translate(shakeX, shakeY);
  ctx.drawImage(petroCanvas!, 0, 0);
  ctx.restore();

  // ── Firelight source — warm radial glow from bottom-centre. Flickers
  //    with the lamp walk + rms. The cave is lit by fire.
  const lampCy = h * 0.92;
  const lampR = Math.max(w, h) * (0.35 + petroLamp * 0.12 + a.rms * 0.1);
  const fireBright = 0.28 + petroLamp * 0.32 + a.rms * 0.25 + petroHeat * 0.18;
  const fire = ctx.createRadialGradient(w / 2, lampCy, 0, w / 2, lampCy, lampR);
  fire.addColorStop(0, `hsla(26, 75%, 50%, ${fireBright * 0.45})`);
  fire.addColorStop(0.4, `hsla(22, 65%, 32%, ${fireBright * 0.2})`);
  fire.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fire;
  ctx.fillRect(0, 0, w, h);

  // ── Sacred constellation threads — connect recent glyphs sharing
  //    a pitch class, coloured amber-gold. Brighten with rms + heat.
  ctx.lineWidth = 0.7;
  for (let i = 0; i < recentPetro.length; i++) {
    for (let j = i + 1; j < recentPetro.length; j++) {
      const a1 = recentPetro[i], a2 = recentPetro[j];
      if (a1.pc !== a2.pc) continue;
      const dx = a2.x - a1.x, dy = a2.y - a1.y;
      const dist = Math.hypot(dx, dy);
      if (dist > Math.max(w, h) * 0.55) continue;
      const ageMax = Math.max(a1.age, a2.age);
      const al = Math.max(0, 1 - ageMax / 3) * (0.10 + a.rms * 0.22 + petroHeat * 0.35);
      if (al < 0.02) continue;
      ctx.strokeStyle = `hsla(34, 60%, 55%, ${al})`;
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.stroke();
    }
  }

  // ── Resonance bloom — on strong transient, every recent glyph gets
  //    a brief bright aura. Spirits animating the carvings.
  const bloomGate = petroHeat > 0.35 ? (petroHeat - 0.35) / 0.65 : 0;

  // ── Live halos + peak ripple — breathing golden auras over each
  //    fresh carving. Rosa Camuna also gets the live-cup pulse.
  for (let i = 0; i < recentPetro.length; i++) {
    const r = recentPetro[i];
    const personalBreath = 0.5 + 0.5 * Math.sin(p.t * 0.8 + i * 1.3);
    const pulse = Math.max(0, 1 - r.age / 2) * (0.14 + a.rms * 0.22 + petroHeat * 0.4 + bloomGate * 0.35) * personalBreath;
    if (pulse < 0.02) continue;
    const haloR = r.sz * (1.5 + petroHeat * 0.5 + bloomGate * 0.4);
    const halo = ctx.createRadialGradient(r.x, r.y, r.sz * 0.55, r.x, r.y, haloR);
    halo.addColorStop(0, "rgba(0,0,0,0)");
    halo.addColorStop(0.5, `hsla(${28 + petroHeat * 10}, 65%, 55%, ${pulse * 0.3})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(r.x, r.y, haloR, 0, Math.PI * 2);
    ctx.fill();
    // Rosa Camuna cup pulse
    if (r.gi === 4) {
      const cupAl = (0.4 + a.rms * 0.55 + petroHeat * 0.3) * Math.max(0, 1 - r.age / 3);
      if (cupAl > 0.05) {
        const rot = now * 0.008;
        const cosA = Math.cos(rot), sinA = Math.sin(rot);
        ctx.fillStyle = `hsla(30, 75%, 58%, ${cupAl * 0.5})`;
        for (let c = 0; c < ROSA_CUPS.length; c++) {
          const [cx, cy, cr] = ROSA_CUPS[c];
          const lx = r.x + (cx * r.sz) * cosA - (cy * r.sz) * sinA;
          const ly = r.y + (cx * r.sz) * sinA + (cy * r.sz) * cosA;
          const rad = cr * r.sz * (1 + petroHeat * 0.6 + a.rms * 0.3);
          ctx.beginPath();
          ctx.arc(lx, ly, rad * 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // ── Pointer preview — faint amber ring at cursor when hovering
  if (p.pointer && !pointerDown) {
    const px = p.pointer.x * w;
    const py = p.pointer.y * h;
    ctx.strokeStyle = "rgba(200, 150, 90, 0.2)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(px, py, 14 + Math.sin(p.t * 2) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Rising wisps (render + advect)
  for (let i = petroWisps.length - 1; i >= 0; i--) {
    const s = petroWisps[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    // Very slight buoyancy acceleration
    s.vy -= 0.004 * dt;
    s.life -= 0.006 * dt;
    if (s.life <= 0 || s.y < -10) { petroWisps.splice(i, 1); continue; }
    // Render as soft amber radial blob
    const sz = s.size * (1 + (1 - s.life) * 0.6);
    const al = s.life * 0.25;
    const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, sz * 3);
    gr.addColorStop(0, `hsla(26, 55%, 55%, ${al})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(s.x - sz * 3, s.y - sz * 3, sz * 6, sz * 6);
  }

  // ── Time-of-day patina — deeper ember at "dusk", cooler mineral
  //    tones at "dawn". Slow 10-minute cycle.
  const dayPhase = (p.t * 0.004) % (Math.PI * 2);
  const daySat = 0.5 + 0.5 * Math.sin(dayPhase);
  const dayHue = 16 + daySat * 14;
  ctx.fillStyle = `hsla(${dayHue}, 30%, 20%, ${0.03 + a.rms * 0.025})`;
  ctx.fillRect(0, 0, w, h);

  // ── Cave-mouth vignette — deeper than before, more sacred darkness
  const vg = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.28,
                                      w / 2, h * 0.55, Math.max(w, h) * 0.72);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.68)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // ── Peak flash — warm ember, subtle
  if (a.peak > 0.55) {
    ctx.fillStyle = `rgba(180, 90, 40, ${(a.peak - 0.55) * 0.09})`;
    ctx.fillRect(0, 0, w, h);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// NEW (2026-04 curation wave) — stereoVectorscope,
// copper / bone palette, no rainbow.
// ═══════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// STEREO VECTORSCOPE — X/Y oscilloscope showing stereo correlation.
// Since mdrone's engine produces a mono sum at the master analyser,
// we synthesise a pseudo-stereo image from two time-offset samples of
// the waveform (30-sample lag) so the trace actually moves on sustained
// notes. Monochrome greyscale phosphor, persistent trail.
// ─────────────────────────────────────────────────────────────────────
let vsCanvas: HTMLCanvasElement | null = null;
let vsCtx: CanvasRenderingContext2D | null = null;
export function drawStereoVectorscope(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  if (!vsCanvas || vsCanvas.width !== w || vsCanvas.height !== h) {
    vsCanvas = document.createElement("canvas");
    vsCanvas.width = w; vsCanvas.height = h;
    vsCtx = vsCanvas.getContext("2d");
    if (vsCtx) { vsCtx.fillStyle = "#06070a"; vsCtx.fillRect(0, 0, w, h); }
  }
  const off = vsCtx!;
  const dt = p.dtScale ?? 1;
  // Phosphor persistence — very slow decay so trails accumulate
  off.fillStyle = `rgba(6, 7, 10, ${0.04 * dt})`;
  off.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const rad = Math.min(w, h) * 0.42;
  const wf = a.waveform;

  if (wf && wf.length > 128) {
    const LAG = 30; // samples of right-channel delay vs left
    const step = Math.max(1, Math.floor(wf.length / 600));
    const bright = 195 + Math.round(a.rms * 40 + a.peak * 20);
    off.strokeStyle = `rgba(${bright}, ${bright}, ${bright}, ${0.55 + a.rms * 0.4})`;
    off.lineWidth = 0.8 + a.rms * 0.8;
    off.beginPath();
    let first = true;
    for (let i = 0; i < wf.length - LAG; i += step) {
      const l = (wf[i] - 128) / 128;          // "left"
      const r = (wf[i + LAG] - 128) / 128;    // "right" (time-lagged)
      // ±45° rotation — classic vectorscope orientation (M/S axes)
      const vx = (l + r) * 0.707;
      const vy = (l - r) * 0.707;
      const x = cx + vx * rad;
      const y = cy + vy * rad;
      if (first) { off.moveTo(x, y); first = false; } else off.lineTo(x, y);
    }
    off.stroke();
  }

  ctx.drawImage(vsCanvas, 0, 0);

  // Vignette
  const vg = ctx.createRadialGradient(cx, cy, rad * 0.4, cx, cy, Math.max(w, h) * 0.7);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}


// ─────────────────────────────────────────────────────────────────────
// HARMONIC EMBER — polar log plot of the actual harmonic series.
// Each harmonic partial n (of a pitched drone) burns as an arc at
// log-mapped radius. Burns are persistent: the buffer accumulates
// so sustained notes inscribe a fixed pattern; glissando blurs it.
// ─────────────────────────────────────────────────────────────────────
let embCanvas: HTMLCanvasElement | null = null;
let embCtx: CanvasRenderingContext2D | null = null;
export function drawHarmonicEmber(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  if (!embCanvas || embCanvas.width !== w || embCanvas.height !== h) {
    embCanvas = document.createElement("canvas");
    embCanvas.width = w; embCanvas.height = h;
    embCtx = embCanvas.getContext("2d");
    if (embCtx) { embCtx.fillStyle = "#0a0604"; embCtx.fillRect(0, 0, w, h); }
  }
  const off = embCtx!;
  const dt = p.dtScale ?? 1;
  // Very slow wash — ember marks persist
  off.fillStyle = `rgba(10, 6, 4, ${0.01 * dt})`;
  off.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const rMin = Math.min(w, h) * 0.08;
  const rMax = Math.min(w, h) * 0.48;
  // Log map: harmonic n → radius = rMin + (rMax - rMin) * log2(n) / log2(N_MAX)
  const N_MAX = 16;
  const logMax = Math.log2(N_MAX);

  // For each active pitch class weighted by its energy, burn an arc
  // on the harmonic whose root is that pc.
  for (let pc = 0; pc < 12; pc++) {
    const e = p.activePitches[pc];
    if (e < 0.08) continue;
    // Root angle comes from pitch class (circle of fifths)
    const fifth = (pc * 7) % 12;
    const rootAng = (fifth / 12) * Math.PI * 2 - Math.PI / 2;
    for (let n = 1; n <= N_MAX; n++) {
      // Each harmonic sits at a fraction of a turn from root angle
      const harmAng = rootAng + Math.log2(n) * Math.PI * 0.35;
      const rr = rMin + (rMax - rMin) * (Math.log2(n) / logMax);
      // Arc thickness + brightness decrease with n (1/n falloff)
      const arcAl = e * (1 / n) * (0.6 + a.rms * 0.5);
      const arcLen = 0.12 + e * 0.18;
      off.strokeStyle = `hsla(${24 + n}, 70%, ${50 + e * 20 - n}%, ${arcAl})`;
      off.lineWidth = 1 + (e / n) * 3;
      off.beginPath();
      off.arc(cx, cy, rr, harmAng - arcLen * 0.5, harmAng + arcLen * 0.5);
      off.stroke();
    }
  }

  // Centre ember — pulses with rms, burns the origin as a dot
  const coreR = 2 + a.rms * 4 + a.peak * 4;
  const cg = off.createRadialGradient(cx, cy, 0, cx, cy, coreR * 5);
  cg.addColorStop(0, `hsla(28, 85%, 62%, ${0.7 + a.peak * 0.2})`);
  cg.addColorStop(0.5, `hsla(22, 65%, 35%, 0.25)`);
  cg.addColorStop(1, "rgba(0,0,0,0)");
  off.fillStyle = cg;
  off.fillRect(cx - coreR * 5, cy - coreR * 5, coreR * 10, coreR * 10);

  ctx.drawImage(embCanvas, 0, 0);

  // Thin reference log-radius rings (very faint) — octaves
  ctx.strokeStyle = "rgba(140, 110, 80, 0.08)";
  ctx.lineWidth = 0.4;
  for (let oct = 1; oct <= 4; oct++) {
    const rr = rMin + (rMax - rMin) * (oct / logMax);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Vignette
  const vg = ctx.createRadialGradient(cx, cy, rMax * 0.6, cx, cy, Math.max(w, h) * 0.7);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}


// ─────────────────────────────────────────────────────────────────────
// SHORTWAVE STATIC — 12 fixed "station carriers" across the dial, one
// per pitch class. Active pitches brighten their stations (signal =
// pitch energy); the rest is hissing noise whose density tracks rms.
// The tuning dial sweeps slowly and gains a "locked" glow as it
// passes a strong station. Peaks fire horizontal interference bars;
// strong high-band content fires Morse-like dot bursts near carriers.
// Below the waterfall, a thin live oscilloscope trace decodes the
// currently-tuned station (reads the waveform as if demodulated).
// ─────────────────────────────────────────────────────────────────────
let swCanvas: HTMLCanvasElement | null = null;
let swCtx: CanvasRenderingContext2D | null = null;
const SW_ROWS = 3;       // rows added to waterfall per frame
// Station carriers — fixed positions, one per pitch class.
// Rendered as persistent bright columns in the waterfall.
const SW_STATIONS = 12;
// Running smoothed energy per station, so carriers don't flicker.
const swStationE = new Float32Array(SW_STATIONS);
let swPrevPeak = 0;
// Morse-burst queue: each entry = {x, rows left}
interface SwMorse { x: number; rows: number; }
const swMorse: SwMorse[] = [];
export function drawShortwaveStatic(
  ctx: CanvasRenderingContext2D, w: number, h: number, a: AudioFrame, p: PhaseClock,
): void {
  if (!swCanvas || swCanvas.width !== w || swCanvas.height !== h) {
    swCanvas = document.createElement("canvas");
    swCanvas.width = w; swCanvas.height = h;
    swCtx = swCanvas.getContext("2d");
    if (swCtx) { swCtx.fillStyle = "#07060a"; swCtx.fillRect(0, 0, w, h); }
    swMorse.length = 0;
  }
  const off = swCtx!;
  const dt = p.dtScale ?? 1;

  // Bands for Morse + haze modulation
  let high = 0;
  for (let i = 20; i < 32; i++) high += a.spectrum[i] ?? 0;
  high /= 12;

  // Transient detection
  const peakDelta = a.peak - swPrevPeak;
  const transient = peakDelta > 0.08;
  swPrevPeak = a.peak * 0.85 + swPrevPeak * 0.15;

  // Waterfall scroll
  const img = off.getImageData(0, SW_ROWS, w, h - SW_ROWS);
  off.putImageData(img, 0, 0);
  off.fillStyle = "#07060a";
  off.fillRect(0, h - SW_ROWS, w, SW_ROWS);

  // Tuning dial position — slow drift + slight pull toward the
  // strongest active station, so the dial feels drawn to strong
  // signals rather than completely independent.
  let pullX = 0, pullMass = 0;
  for (let s = 0; s < SW_STATIONS; s++) {
    const e = p.activePitches[s];
    const sx = ((s + 0.5) / SW_STATIONS) * w;
    pullX += sx * e;
    pullMass += e;
  }
  const driftX = (w * 0.5) + Math.sin(p.t * 0.035) * (w * 0.35);
  const targetX = pullMass > 0.08 ? driftX * 0.65 + (pullX / pullMass) * 0.35 : driftX;
  // Ease dial toward target
  const dialX = targetX;   // already-smoothed via targetX calc; could store if jumpy
  const dialW = 40 + a.rms * 30;

  // Smooth per-station energies (attack fast, release slow)
  for (let s = 0; s < SW_STATIONS; s++) {
    const e = p.activePitches[s];
    const k = e > swStationE[s] ? 0.25 : 0.05;
    swStationE[s] += (e - swStationE[s]) * (1 - Math.pow(1 - k, dt));
  }

  // How strongly the dial is "locked" to the nearest strong station
  let lockedE = 0, lockedSx = 0;
  for (let s = 0; s < SW_STATIONS; s++) {
    const sx = ((s + 0.5) / SW_STATIONS) * w;
    const d = Math.abs(sx - dialX);
    const prox = d < dialW ? 1 - d / dialW : 0;
    const sig = swStationE[s] * prox;
    if (sig > lockedE) { lockedE = sig; lockedSx = sx; }
  }

  // Render bottom band — static + carriers
  for (let x = 0; x < w; x++) {
    // Nearest station energy at this x
    const stationIdx = Math.min(SW_STATIONS - 1, Math.floor(x / w * SW_STATIONS));
    const stationE = swStationE[stationIdx];
    const sxStation = ((stationIdx + 0.5) / SW_STATIONS) * w;
    const stationW = w / SW_STATIONS * 0.35;
    const distS = Math.abs(x - sxStation);
    const carrier = distS < stationW ? (1 - distS / stationW) * stationE : 0;

    // Dial proximity (makes dial-region brighter, like a tuning sweep)
    const dx = Math.abs(x - dialX);
    const dialProx = dx < dialW ? 1 - dx / dialW : 0;

    const noise = Math.random();
    const sig = noise * (0.18 + a.rms * 0.45) + carrier * (0.55 + a.peak * 0.45) + dialProx * 0.12;
    const lig = Math.min(96, 12 + sig * 78);
    const al = 0.2 + carrier * 0.55 + sig * 0.25 + dialProx * 0.12;
    // Amber bias on strong carriers, cool grey on pure noise
    const hue = 30 + carrier * 10 - dialProx * 6;
    const sat = 6 + carrier * 40 + dialProx * 8;
    off.fillStyle = `hsla(${hue}, ${sat}%, ${lig}%, ${al})`;
    off.fillRect(x, h - SW_ROWS, 1, SW_ROWS);
  }

  // Interference bars — peak-triggered
  if (transient && a.peak > 0.4) {
    const bars = 1 + Math.floor(a.peak * 2);
    for (let b = 0; b < bars; b++) {
      const barY = h - SW_ROWS - Math.floor(Math.random() * 14);
      off.fillStyle = `hsla(28, 22%, 72%, ${a.peak * 0.5})`;
      off.fillRect(0, barY, w, 1);
    }
  }

  // Morse dot bursts — spawned by high-band transients. Each burst
  // stamps a short dot / dash sequence at a randomly-chosen lit
  // station's x-column over the next N scrolling rows.
  if (transient && high > 0.1 && Math.random() < 0.6) {
    // Pick a lit station
    let bestS = -1, bestE = 0.12;
    for (let s = 0; s < SW_STATIONS; s++) if (swStationE[s] > bestE) { bestE = swStationE[s]; bestS = s; }
    if (bestS >= 0) {
      const sx = ((bestS + 0.5) / SW_STATIONS) * w;
      swMorse.push({ x: sx, rows: 6 + Math.floor(Math.random() * 14) });
    }
  }
  for (let i = swMorse.length - 1; i >= 0; i--) {
    const m = swMorse[i];
    // Stamp a short bright dot this frame
    off.fillStyle = `hsla(36, 50%, 80%, 0.8)`;
    off.fillRect(m.x - 1, h - SW_ROWS, 3, SW_ROWS);
    m.rows -= 1;
    if (m.rows <= 0) swMorse.splice(i, 1);
  }

  ctx.drawImage(swCanvas, 0, 0);

  // ── Dial indicator — thin vertical, brighter when locked
  const lockStrength = Math.min(1, lockedE * 2.5);
  ctx.strokeStyle = `hsla(${28 - lockStrength * 6}, ${50 + lockStrength * 35}%, ${55 + a.rms * 15 + lockStrength * 10}%, ${0.45 + a.peak * 0.3 + lockStrength * 0.3})`;
  ctx.lineWidth = 1 + lockStrength * 1.2;
  ctx.beginPath();
  ctx.moveTo(dialX, 0);
  ctx.lineTo(dialX, h);
  ctx.stroke();

  // Tuning-lock glyph: small diamond at the top of the dial when
  // locked to a station, scaled by lock strength.
  if (lockStrength > 0.15) {
    const dy = 10;
    const ds = 4 + lockStrength * 6;
    ctx.fillStyle = `hsla(34, 65%, 70%, ${lockStrength * 0.7})`;
    ctx.beginPath();
    ctx.moveTo(dialX, dy - ds);
    ctx.lineTo(dialX + ds, dy);
    ctx.lineTo(dialX, dy + ds);
    ctx.lineTo(dialX - ds, dy);
    ctx.closePath();
    ctx.fill();
  }

  // ── Station tick marks (top scale). Stations glow when lit.
  const tickY = 8;
  for (let s = 0; s < SW_STATIONS; s++) {
    const sx = ((s + 0.5) / SW_STATIONS) * w;
    const e = swStationE[s];
    ctx.strokeStyle = `hsla(28, ${20 + e * 45}%, ${45 + e * 30}%, ${0.3 + e * 0.6})`;
    ctx.lineWidth = 0.6 + e * 1.1;
    ctx.beginPath();
    ctx.moveTo(sx, tickY - 3 - e * 4);
    ctx.lineTo(sx, tickY + 3 + e * 4);
    ctx.stroke();
  }

  // ── Live oscilloscope — thin trace at the bottom 18px that shows
  //    the "demodulated" waveform. Only drawn when dial is locked,
  //    otherwise replaced with flat static hiss. The station's sx
  //    determines the hue tint so different stations sound different.
  const scopeH = 18;
  const scopeY = h - SW_ROWS - scopeH - 8;
  if (lockStrength > 0.2 && a.waveform) {
    const wf = a.waveform;
    ctx.strokeStyle = `hsla(${30 - lockStrength * 4}, 55%, ${60 + lockStrength * 15}%, ${0.5 + lockStrength * 0.4})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(wf.length / w));
    for (let x = 0; x < w; x += 2) {
      const idx = Math.min(wf.length - 1, x * step);
      const v = (wf[idx] - 128) / 128;
      const y = scopeY + scopeH * 0.5 + v * scopeH * 0.45;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Subtle horizontal guide line at the scope centre
    ctx.strokeStyle = "rgba(120, 100, 80, 0.15)";
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(0, scopeY + scopeH * 0.5);
    ctx.lineTo(w, scopeY + scopeH * 0.5);
    ctx.stroke();
    // Current-station colour tag on the left
    ctx.fillStyle = `hsla(30, 55%, 60%, ${lockStrength * 0.8})`;
    ctx.fillRect(4, scopeY + scopeH * 0.5 - 1, 14, 2);
  }

  // Suppress unused-var linter on lockedSx (kept for potential future
  // visual use — station-centre marker).
  void lockedSx;

  // Vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}
