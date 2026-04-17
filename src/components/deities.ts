/**
 * HALO & RAYS visualizer (formerly the deity gallery).
 *
 * A central glowing core surrounded by a rotating flame-ray ring,
 * two concentric rotating rim dashes, six slow god-rays sweeping
 * through the scene, expanding meditation rings, and tiny drifting
 * embers. Audio-reactive on every element. No image assets, no
 * figure — just the light.
 */

import type { AudioFrame, PhaseClock } from "./visualizers";

/** Kept as module-level stubs so older MeditateView state using the
 *  deity-preview buttons still links. The preview is a no-op now. */
export function cycleDeityPreview(): string { return "halo"; }
export function clearDeityPreview(): void { /* no-op */ }
export function getDeityPreview(): string | null { return null; }

export function drawHaloGlow(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  a: AudioFrame, p: PhaseClock,
): void {
  // Mood-aware palette — every element hues off phase.mood.hue so
  // the palette shifts with the playing preset.
  const baseHue = p.mood.hue;
  const haloHue = (baseHue + 5) % 360;
  const ringHue = (baseHue + 20) % 360;

  // Warm dark persistence wash so trails linger
  ctx.fillStyle = "rgba(8, 5, 2, 0.3)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const side = Math.min(w, h);

  // ── Background radial glow (huge, slow breath) ─────────────────
  const bgR = side * 0.82;
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, bgR);
  bgGrad.addColorStop(0, `hsla(${haloHue}, 75%, 55%, ${0.28 + a.rms * 0.2})`);
  bgGrad.addColorStop(0.5, `hsla(${haloHue}, 65%, 30%, 0.14)`);
  bgGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // ── Outer flame-ray ring (Nataraja-style) ─────────────────────
  const ringR = side * (0.38 + p.slow * 0.04);
  const flameCount = 84;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.t * 0.012);
  for (let i = 0; i < flameCount; i++) {
    const ang = (i / flameCount) * Math.PI * 2;
    const len = ringR * (0.9 + Math.sin(ang * 7 + p.t * 0.5) * 0.05 + a.rms * 0.07);
    const lenTip = ringR * (1.22 + Math.sin(ang * 5 + p.t * 0.7 + i) * 0.08 + a.peak * 0.12);
    const x0 = Math.cos(ang) * len;
    const y0 = Math.sin(ang) * len;
    const x1 = Math.cos(ang) * lenTip;
    const y1 = Math.sin(ang) * lenTip;
    const rayGrad = ctx.createLinearGradient(x0, y0, x1, y1);
    rayGrad.addColorStop(0, `hsla(${ringHue}, 90%, 72%, ${0.55 + a.rms * 0.3})`);
    rayGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.strokeStyle = rayGrad;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();

  // ── Pulsing head halo — two-layer pulse (fast heartbeat on top
  //     of the slow breath). Inner pulse drifts in and out 3× per
  //     second-scale so the halo itself feels alive.
  const innerPulse = 0.5 + 0.5 * Math.sin(p.t * 2.4 + p.slow * 3);
  const haloR = side * (0.28 + a.rms * 0.06 + p.slow * 0.04 + innerPulse * 0.015);
  const haloGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  haloGrad.addColorStop(0, `hsla(${haloHue}, 90%, ${78 + innerPulse * 8}%, ${0.85 + innerPulse * 0.1})`);
  haloGrad.addColorStop(0.45, `hsla(${haloHue}, 85%, ${55 + innerPulse * 10}%, 0.45)`);
  haloGrad.addColorStop(0.75, `hsla(${haloHue}, 80%, 45%, 0.22)`);
  haloGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();

  // Inner second pulse — a tighter bright ring that breathes at a
  // different rate so the halo has internal movement instead of a
  // single flat breath.
  const pulse2 = 0.5 + 0.5 * Math.sin(p.t * 1.3 + 1.7);
  const haloR2 = haloR * (0.7 + pulse2 * 0.08);
  const hg2 = ctx.createRadialGradient(cx, cy, haloR2 * 0.5, cx, cy, haloR2);
  hg2.addColorStop(0, "rgba(0,0,0,0)");
  hg2.addColorStop(1, `hsla(${haloHue}, 95%, 85%, ${0.2 + pulse2 * 0.15 + a.rms * 0.1})`);
  ctx.fillStyle = hg2;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR2, 0, Math.PI * 2);
  ctx.fill();

  // ── Rotating rim dashes (two concentric bands, opposite dirs) ─
  ctx.save();
  ctx.translate(cx, cy);
  // Outer dashes
  ctx.strokeStyle = `hsla(${ringHue}, 80%, 70%, 0.55)`;
  ctx.lineWidth = 1.2;
  const outerDashes = 72;
  for (let i = 0; i < outerDashes; i++) {
    const ang = (i / outerDashes) * Math.PI * 2 + p.t * 0.045;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * haloR * 0.98, Math.sin(ang) * haloR * 0.98);
    ctx.lineTo(Math.cos(ang) * haloR * 1.06, Math.sin(ang) * haloR * 1.06);
    ctx.stroke();
  }
  // Inner dashes rotating the other way
  ctx.strokeStyle = `hsla(${haloHue}, 90%, 82%, 0.4)`;
  const innerDashes = 40;
  for (let i = 0; i < innerDashes; i++) {
    const ang = (i / innerDashes) * Math.PI * 2 - p.t * 0.06;
    const r0 = haloR * 0.78;
    const r1 = haloR * 0.84;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
    ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
    ctx.stroke();
  }
  ctx.restore();

  // ── Six god-rays sweeping through the whole scene ─────────────
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.t * 0.02);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    ctx.rotate(ang);
    const grd = ctx.createLinearGradient(0, -side * 0.65, 0, 0);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(0.5, `hsla(${haloHue}, 85%, 88%, ${0.06 + a.rms * 0.06})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-side * 0.3, -side * 0.65);
    ctx.lineTo(side * 0.3, -side * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-ang);
  }
  ctx.restore();

  // ── Central fire core ─────────────────────────────────────────
  // Not a static bright dot — a licking flame made of several
  // layered flickers with short-period noise, yellow-orange-red
  // hue banding and audio-reactive amplitude. Radius wobbles like
  // a candle flame.
  const coreBaseR = side * 0.065 * (1 + a.rms * 0.45 + p.slow * 0.1);
  // Short-period flicker that makes the whole core "breathe like fire"
  const flicker =
    0.6 +
    0.25 * Math.sin(p.t * 7.3) +
    0.15 * Math.sin(p.t * 13.1 + 1.4);
  const coreR = coreBaseR * (0.85 + flicker * 0.4);
  // Deepest core — near white/yellow
  const c0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  c0.addColorStop(0, `hsla(50, 100%, 96%, ${0.9 + a.rms * 0.1})`);
  c0.addColorStop(0.4, `hsla(38, 100%, 75%, ${0.65 + flicker * 0.15})`);
  c0.addColorStop(0.8, `hsla(${14 + Math.sin(p.t * 2) * 6}, 95%, 55%, 0.45)`);
  c0.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = c0;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  // Flame tongues — 360° around the core, every direction. Each
  // tongue has its own phase, sways independently, and audio-
  // reacts in height. Slow global rotation on top so the fire is
  // never still.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.t * 0.12);
  const tongueCount = 18;
  for (let i = 0; i < tongueCount; i++) {
    const phaseI = p.t * 3 + i * 1.3;
    const sway = Math.sin(phaseI) * 0.12 + Math.sin(phaseI * 0.7) * 0.06;
    const baseAng = (i / tongueCount) * Math.PI * 2 + sway;
    const height = coreR * (2.3 + Math.sin(phaseI * 0.9 + i) * 0.5 + a.rms * 1.6);
    const width = coreR * (0.4 + Math.sin(phaseI * 1.3 + i * 0.6) * 0.1);
    // Perpendicular unit for the tongue's width base
    const perpX = -Math.sin(baseAng);
    const perpY = Math.cos(baseAng);
    const x1 = Math.cos(baseAng) * height;
    const y1 = Math.sin(baseAng) * height;
    // Tongue gradient — hot yellow base → orange middle → red tip
    const tg = ctx.createLinearGradient(0, 0, x1, y1);
    tg.addColorStop(0, `hsla(50, 100%, 85%, ${0.7 + a.rms * 0.25})`);
    tg.addColorStop(0.4, `hsla(30, 100%, 65%, 0.55)`);
    tg.addColorStop(0.8, `hsla(${10 + i * 2}, 95%, 50%, 0.22)`);
    tg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.moveTo(-perpX * width, -perpY * width);
    ctx.quadraticCurveTo(
      x1 * 0.4 - perpX * width * 0.6,
      y1 * 0.4 - perpY * width * 0.6,
      x1,
      y1,
    );
    ctx.quadraticCurveTo(
      x1 * 0.4 + perpX * width * 0.6,
      y1 * 0.4 + perpY * width * 0.6,
      perpX * width,
      perpY * width,
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Occasional bright sparks popping out of the fire
  const sparkCount = 6 + Math.round(a.peak * 8);
  for (let i = 0; i < sparkCount; i++) {
    const sSeed = (p.t * 1.7 + i * 0.61) % 1;
    const ang = (i * 0.917 + p.t * 0.4) % (Math.PI * 2) - Math.PI / 2;
    const rr = coreR * (1.5 + sSeed * 4);
    const sx = cx + Math.cos(ang) * rr;
    const sy = cy + Math.sin(ang) * rr - sSeed * coreR * 5;
    ctx.fillStyle = `hsla(${40 + i * 4}, 100%, 80%, ${(1 - sSeed) * 0.8})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.2 + (1 - sSeed) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Foreground meditation rings — expand from center forever ──
  const rings = 9;
  for (let i = 0; i < rings; i++) {
    const rr = (side * 0.7) * ((p.t * 0.05 + i / rings) % 1);
    const alpha = 0.18 * (1 - (rr / (side * 0.7)));
    ctx.strokeStyle = `hsla(${haloHue}, 85%, 78%, ${alpha + a.rms * 0.08})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Floating embers drifting around the halo ──────────────────
  const emberCount = 28 + Math.round(p.growth * 24);
  for (let i = 0; i < emberCount; i++) {
    const seed = (p.t * 0.25 + i * 37) % 1;
    const ang = (i / emberCount) * Math.PI * 2 + p.t * 0.06;
    const rr = side * (0.18 + seed * 0.42);
    const ex = cx + Math.cos(ang) * rr;
    const ey = cy + Math.sin(ang) * rr - seed * side * 0.12;
    const emberAlpha = (1 - seed) * 0.5 + a.peak * 0.22;
    ctx.fillStyle = `hsla(${ringHue}, 95%, 78%, ${emberAlpha})`;
    ctx.beginPath();
    ctx.arc(ex, ey, 1.2 + (1 - seed) * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
