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
  // ── Spectral character — split the spectrum into low / mid / high
  // thirds and compute a spectral centroid (0..1). Each of the halo's
  // visual layers reacts to a specific band so the halo responds to
  // the *kind* of drone, not just its loudness:
  //   low   → bass swell ring + background depth
  //   mid   → flame ring intensity (core + tongues)
  //   high  → sparkle density + treble-ward hue shift
  //   centroid → global hue tilt (bass-heavy leans red, treble leans white/gold)
  const bins = a.spectrum.length;
  let lowE = 0, midE = 0, highE = 0, wSum = 0, wIdx = 0;
  const thirdA = Math.floor(bins / 3);
  const thirdB = Math.floor((bins * 2) / 3);
  for (let i = 0; i < thirdA; i++) lowE += a.spectrum[i];
  for (let i = thirdA; i < thirdB; i++) midE += a.spectrum[i];
  for (let i = thirdB; i < bins; i++) highE += a.spectrum[i];
  for (let i = 0; i < bins; i++) { wSum += a.spectrum[i] * i; wIdx += a.spectrum[i]; }
  lowE /= Math.max(1, thirdA);
  midE /= Math.max(1, thirdB - thirdA);
  highE /= Math.max(1, bins - thirdB);
  const centroid = wIdx > 0.01 ? (wSum / wIdx) / bins : 0.5; // 0..1

  // Mood-aware palette tilted by spectral character. Centroid near 0
  // (bass-dominant) pulls the palette toward deep red; centroid near
  // 1 (treble-rich) pulls it toward gold/white.
  const baseHue = p.mood.hue;
  const centroidTilt = (centroid - 0.5) * 40; // ±20°
  const haloHue = (baseHue + 5 + centroidTilt + 360) % 360;
  const ringHue = (baseHue + 20 + centroidTilt * 0.8 + 360) % 360;

  // Warm dark persistence wash so trails linger
  ctx.fillStyle = "rgba(8, 5, 2, 0.3)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const side = Math.min(w, h);

  // ── Background radial glow — deepened by low-band energy so
  // bass-heavy drones fill the whole frame with halo light.
  const bgR = side * (0.82 + lowE * 0.15);
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, bgR);
  bgGrad.addColorStop(0, `hsla(${haloHue}, 75%, ${55 + lowE * 10}%, ${0.28 + a.rms * 0.2 + lowE * 0.15})`);
  bgGrad.addColorStop(0.5, `hsla(${haloHue}, 65%, 30%, ${0.14 + lowE * 0.1})`);
  bgGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Low-band bass swell ring — a thick soft ring that inflates and
  // contracts with low-band energy. Sits just outside the halo.
  if (lowE > 0.05) {
    const swellR = side * (0.35 + lowE * 0.25);
    const swellW = side * (0.04 + lowE * 0.08);
    const sg = ctx.createRadialGradient(cx, cy, swellR - swellW, cx, cy, swellR + swellW);
    sg.addColorStop(0, "rgba(0,0,0,0)");
    sg.addColorStop(0.5, `hsla(${(haloHue - 10 + 360) % 360}, 70%, 45%, ${Math.min(0.35, lowE * 0.7)})`);
    sg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(cx, cy, swellR + swellW, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Outer flame-ray ring — each ray's tip is modulated by the
  //     matching spectrum bin, so harmonics push individual flames
  //     outward. Rich drones get a spiky halo; pure tones sit quiet.
  const ringR = side * (0.38 + p.slow * 0.04 + midE * 0.06);
  const flameCount = 84;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.t * 0.012 + centroid * 0.4);
  for (let i = 0; i < flameCount; i++) {
    const ang = (i / flameCount) * Math.PI * 2;
    const binE = a.spectrum[Math.floor((i / flameCount) * bins)] ?? 0;
    const len = ringR * (0.9 + Math.sin(ang * 7 + p.t * 0.5) * 0.05 + a.rms * 0.07);
    const lenTip = ringR * (1.22 + Math.sin(ang * 5 + p.t * 0.7 + i) * 0.08 + a.peak * 0.12 + binE * 0.45);
    const x0 = Math.cos(ang) * len;
    const y0 = Math.sin(ang) * len;
    const x1 = Math.cos(ang) * lenTip;
    const y1 = Math.sin(ang) * lenTip;
    // Deep-contrast B&W rays — pure white at the inner end fades to
    // transparent at the tip. Reads sharp against the dark halo
    // background regardless of the colour palette around it.
    const rayGrad = ctx.createLinearGradient(x0, y0, x1, y1);
    const wAlpha = Math.min(1, 0.85 + a.rms * 0.15 + binE * 0.4);
    rayGrad.addColorStop(0, `rgba(255, 255, 255, ${wAlpha})`);
    rayGrad.addColorStop(0.6, `rgba(255, 255, 255, ${wAlpha * 0.45})`);
    rayGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.strokeStyle = rayGrad;
    ctx.lineWidth = 1.6 + binE * 1.4 + a.peak * 0.6;
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

  // Flame tongues — 360° around the core. Per-tongue height now
  // reacts to its matching spectrum bin so tongues individually
  // lick out where the drone has energy. Mid-band + RMS set the
  // global vigour of the fire.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.t * 0.12);
  const tongueCount = 18;
  for (let i = 0; i < tongueCount; i++) {
    const phaseI = p.t * 3 + i * 1.3;
    const sway = Math.sin(phaseI) * 0.12 + Math.sin(phaseI * 0.7) * 0.06;
    const baseAng = (i / tongueCount) * Math.PI * 2 + sway;
    const binE = a.spectrum[Math.floor((i / tongueCount) * bins)] ?? 0;
    const height = coreR * (1.8 + Math.sin(phaseI * 0.9 + i) * 0.5 + a.rms * 1.2 + midE * 1.1 + binE * 1.3);
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

  // Bright sparks popping out of the fire — density scales with
  // high-band energy (treble/partials) so rich timbres shower sparks,
  // pure fundamentals show few. Peak still tugs them up.
  const sparkCount = 4 + Math.round(a.peak * 8 + highE * 28);
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

  // ── Growth-gated ornament tiers — the halo accrues layers as
  //     the user sits with it. Each tier fades in over a 0.1-wide
  //     growth range so transitions are not cliff-edges.

  // Tier 1 (growth > 0.3): inner counter-rotating flame ring at
  // ~0.75× the outer ring radius. Gives the halo a double-walled
  // fire skeleton.
  if (p.growth > 0.3) {
    const g = Math.min(1, (p.growth - 0.3) / 0.1);
    const innerRingR = side * 0.28;
    const innerFlames = 60;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-p.t * 0.018);
    for (let i = 0; i < innerFlames; i++) {
      const ang = (i / innerFlames) * Math.PI * 2;
      const binE = a.spectrum[Math.floor((i / innerFlames) * bins)] ?? 0;
      const len = innerRingR * 0.94;
      const lenTip = innerRingR * (1.08 + Math.sin(ang * 9 + p.t * 0.6) * 0.04 + binE * 0.25);
      const x0 = Math.cos(ang) * len, y0 = Math.sin(ang) * len;
      const x1 = Math.cos(ang) * lenTip, y1 = Math.sin(ang) * lenTip;
      const ig = ctx.createLinearGradient(x0, y0, x1, y1);
      ig.addColorStop(0, `hsla(${haloHue}, 95%, 82%, ${(0.4 + a.rms * 0.25) * g})`);
      ig.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = ig;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.restore();
  }

  // Tier 2 (growth > 0.5): three concentric dotted aureoles at 1.10 /
  // 1.18 / 1.28× haloR — the mandala-style layered rings a meditation
  // image gains with contemplation.
  if (p.growth > 0.5) {
    const g = Math.min(1, (p.growth - 0.5) / 0.12);
    const aureoles = [
      { r: haloR * 1.10, count: 48, hueOff: 30 },
      { r: haloR * 1.18, count: 72, hueOff: 60 },
      { r: haloR * 1.28, count: 96, hueOff: 90 },
    ];
    for (let t = 0; t < aureoles.length; t++) {
      const layer = aureoles[t];
      const spin = p.t * (0.01 + t * 0.004) * (t % 2 === 0 ? 1 : -1);
      const dr = 0.9 + g * 0.5;
      ctx.fillStyle = `hsla(${(haloHue + layer.hueOff) % 360}, 85%, 78%, ${(0.22 + g * 0.25) * (1 - t * 0.18)})`;
      for (let i = 0; i < layer.count; i++) {
        const ang = (i / layer.count) * Math.PI * 2 + spin;
        const dx = cx + Math.cos(ang) * layer.r;
        const dy = cy + Math.sin(ang) * layer.r;
        ctx.beginPath();
        ctx.arc(dx, dy, dr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Tier 3 (growth > 0.7): twelve additional finer god-rays slotted
  // between the six original ones, so the whole sky is a fan of
  // light. Narrower and dimmer than the primary rays.
  if (p.growth > 0.7) {
    const g = Math.min(1, (p.growth - 0.7) / 0.12);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-p.t * 0.015);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + Math.PI / 12; // offset between the 6 primary rays
      ctx.rotate(ang);
      const gr = ctx.createLinearGradient(0, -side * 0.72, 0, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(0.5, `hsla(${ringHue}, 80%, 86%, ${(0.04 + a.rms * 0.04) * g})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-side * 0.18, -side * 0.72);
      ctx.lineTo(side * 0.18, -side * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-ang);
    }
    ctx.restore();
  }

  // Tier 4 (growth > 0.85): lotus-petal corona around the central
  // core. 16 pointed petals drawn as Bézier teardrops — the halo's
  // last ornament, appearing only after ~3.5 min of viewing.
  if (p.growth > 0.85) {
    const g = Math.min(1, (p.growth - 0.85) / 0.15);
    const petals = 16;
    const petalInner = coreR * 1.4;
    const petalOuter = coreR * (2.8 + a.rms * 0.6);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.t * 0.05);
    for (let i = 0; i < petals; i++) {
      const ang = (i / petals) * Math.PI * 2;
      const half = (Math.PI / petals) * 0.58;
      const tipX = Math.cos(ang) * petalOuter;
      const tipY = Math.sin(ang) * petalOuter;
      const bLx = Math.cos(ang - half) * petalInner;
      const bLy = Math.sin(ang - half) * petalInner;
      const bRx = Math.cos(ang + half) * petalInner;
      const bRy = Math.sin(ang + half) * petalInner;
      const pg = ctx.createLinearGradient(0, 0, tipX, tipY);
      pg.addColorStop(0, `hsla(48, 100%, 75%, ${0.35 * g})`);
      pg.addColorStop(0.7, `hsla(${(haloHue + 20) % 360}, 90%, 65%, ${0.25 * g})`);
      pg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(bLx, bLy);
      ctx.quadraticCurveTo(tipX * 0.55 + bLx * 0.2, tipY * 0.55 + bLy * 0.2, tipX, tipY);
      ctx.quadraticCurveTo(tipX * 0.55 + bRx * 0.2, tipY * 0.55 + bRy * 0.2, bRx, bRy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
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

  // ── Floating embers drifting around the halo — high-band energy
  //     adds more embers and pulls them outward (treble = flying).
  const emberCount = 28 + Math.round(p.growth * 24 + highE * 48);
  for (let i = 0; i < emberCount; i++) {
    const seed = (p.t * 0.25 + i * 37) % 1;
    const ang = (i / emberCount) * Math.PI * 2 + p.t * 0.06;
    const rr = side * (0.18 + seed * 0.42 + highE * 0.12);
    const ex = cx + Math.cos(ang) * rr;
    const ey = cy + Math.sin(ang) * rr - seed * side * 0.12;
    const emberAlpha = (1 - seed) * 0.5 + a.peak * 0.22 + highE * 0.2;
    ctx.fillStyle = `hsla(${ringHue}, 95%, 78%, ${emberAlpha})`;
    ctx.beginPath();
    ctx.arc(ex, ey, 1.2 + (1 - seed) * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// HALO BW — grayscale sibling of drawHaloGlow. Uses Canvas 2D's
// `filter` to desaturate everything drawn by the halo this frame,
// so the exact same math produces a pure-grayscale sibling without
// duplicating 400 lines of rendering code.
