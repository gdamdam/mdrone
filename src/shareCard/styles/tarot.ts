import type { ShareCardContext } from "../svgBuilder";
import type { PitchClass } from "../../types";
import { rngPick, rngRange } from "../rng";

/**
 * Rider-Waite — inspired tarot card, night variant, square (800×800).
 *
 * Layout (top → bottom):
 *   · Roman-numeral medallion
 *   · Card slug: "XVIII · THE MOON"
 *   · Horizon band (mountains / waves / stars / dunes) picked from climate
 *   · Central pictogram (one of 16, each bound to a specific arcana)
 *   · Keyword ribbon from voice layers
 *   · Name banner
 *
 * Per-pitch-class tarot-warm palette; aged-paper speckle pattern; light
 * woodcut hatching on glyph bodies for a printed-engraving feel.
 *
 * All randomness flows through ctx.rng — same payload → byte-identical SVG.
 */

/* ─── Palette ──────────────────────────────────────────────────────────── */

type Palette = {
  bg: string;          // outer vignette
  card: string;        // card body
  cardEdge: string;    // radial wash edge (slightly brighter)
  gold: string;        // primary ornament
  goldDim: string;     // secondary thin lines
  ivory: string;       // banner text
  accent: string;      // small coloured detail (iris, liquid, flame)
  hatch: string;       // hatching ink
};

/** 12 palettes. All stay in the tarot-warm register: deep card backgrounds,
 *  gold/bronze/brass ornament, small accent per key. */
const PALETTES: Record<PitchClass, Palette> = {
  C:    { bg: "#05040a", card: "#16100a", cardEdge: "#1e1812", gold: "#c89838", goldDim: "#6a4820", ivory: "#e8d4a0", accent: "#a84028", hatch: "#2a1c10" },
  "C#": { bg: "#040708", card: "#0f1418", cardEdge: "#161d22", gold: "#8abcc4", goldDim: "#3e6870", ivory: "#d6ecf0", accent: "#4a8090", hatch: "#0f1a20" },
  D:    { bg: "#040706", card: "#101812", cardEdge: "#16221a", gold: "#a8b068", goldDim: "#506030", ivory: "#d8e2b4", accent: "#4a6a3a", hatch: "#101a10" },
  "D#": { bg: "#070404", card: "#1a100e", cardEdge: "#221814", gold: "#c88050", goldDim: "#6a3e22", ivory: "#e8c8a8", accent: "#a8402a", hatch: "#2a1410" },
  E:    { bg: "#04050a", card: "#121424", cardEdge: "#181a2e", gold: "#9ea8d0", goldDim: "#4a528a", ivory: "#d4d8f0", accent: "#586ab0", hatch: "#141828" },
  F:    { bg: "#06050a", card: "#1a140a", cardEdge: "#221a10", gold: "#d0a038", goldDim: "#6e4a18", ivory: "#ecd29e", accent: "#c06030", hatch: "#2a1c0c" },
  "F#": { bg: "#040806", card: "#101c16", cardEdge: "#182820", gold: "#80b0a0", goldDim: "#3a5e50", ivory: "#c8e2d6", accent: "#40786a", hatch: "#0e1e18" },
  G:    { bg: "#07050a", card: "#161014", cardEdge: "#201820", gold: "#b88860", goldDim: "#6a4830", ivory: "#e0c4a8", accent: "#9058a0", hatch: "#241420" },
  "G#": { bg: "#060606", card: "#181418", cardEdge: "#221c24", gold: "#a88ac0", goldDim: "#5a446c", ivory: "#dccae4", accent: "#6a4a90", hatch: "#1e182a" },
  A:    { bg: "#070404", card: "#1a1008", cardEdge: "#22180c", gold: "#e0a030", goldDim: "#7a5414", ivory: "#f0d286", accent: "#b04820", hatch: "#2c1a0a" },
  "A#": { bg: "#040806", card: "#10181a", cardEdge: "#182426", gold: "#80b0b8", goldDim: "#3a5c60", ivory: "#cce4e8", accent: "#508890", hatch: "#0e1e20" },
  B:    { bg: "#070408", card: "#181020", cardEdge: "#24182c", gold: "#b880c8", goldDim: "#5e3868", ivory: "#e0c4e8", accent: "#8040a0", hatch: "#22142a" },
};

/* ─── Arcana table ─────────────────────────────────────────────────────── */

type Pictogram =
  | "fool" | "magician" | "priestess" | "empress" | "emperor"
  | "hermit" | "wheel" | "justice" | "hanged" | "death"
  | "temperance" | "devil" | "tower" | "star" | "moon" | "sun"
  | "world";

type Arcana = { numeral: string; name: string; pict: Pictogram };

/** Each pictogram is bound to one major-arcana card, so numeral & name
 *  agree with the glyph on every render. 17 entries covering 16 glyphs
 *  + an extra for moon/priestess split. */
const ARCANA: Readonly<Record<Pictogram, Arcana>> = {
  fool:       { numeral: "O",     name: "THE FOOL",        pict: "fool" },
  magician:   { numeral: "I",     name: "THE MAGICIAN",    pict: "magician" },
  priestess:  { numeral: "II",    name: "THE PRIESTESS",   pict: "priestess" },
  empress:    { numeral: "III",   name: "THE EMPRESS",     pict: "empress" },
  emperor:    { numeral: "IV",    name: "THE EMPEROR",     pict: "emperor" },
  hermit:     { numeral: "IX",    name: "THE HERMIT",      pict: "hermit" },
  wheel:      { numeral: "X",     name: "THE WHEEL",       pict: "wheel" },
  justice:    { numeral: "XI",    name: "JUSTICE",         pict: "justice" },
  hanged:     { numeral: "XII",   name: "THE HANGED",      pict: "hanged" },
  death:      { numeral: "XIII",  name: "DEATH",           pict: "death" },
  temperance: { numeral: "XIV",   name: "TEMPERANCE",      pict: "temperance" },
  devil:      { numeral: "XV",    name: "THE DEVIL",       pict: "devil" },
  tower:      { numeral: "XVI",   name: "THE TOWER",       pict: "tower" },
  star:       { numeral: "XVII",  name: "THE STAR",        pict: "star" },
  moon:       { numeral: "XVIII", name: "THE MOON",        pict: "moon" },
  sun:        { numeral: "XIX",   name: "THE SUN",         pict: "sun" },
  world:      { numeral: "XXI",   name: "THE WORLD",       pict: "world" },
};

/** Pick a pictogram from scene mood. Each branch is meaningful:
 *  tanpura+amp = grounded sacred → hermit/priestess; metal = blade → justice/death;
 *  bright+moving = celebration → sun/star; dark still = reflection → hanged/moon;
 *  amp alone = raw energy → tower/devil. */
function pickPictogram(
  hasTanpura: boolean,
  hasMetal: boolean,
  hasAmp: boolean,
  bright: boolean,
  moving: boolean,
  hash: number,
): Pictogram {
  const h = hash & 0xff;
  if (hasAmp && hasMetal) return moving ? "tower" : "devil";
  if (hasAmp) return bright ? "emperor" : h % 2 === 0 ? "tower" : "magician";
  if (hasMetal) return moving ? "justice" : bright ? "star" : "death";
  if (hasTanpura && !bright) return moving ? "priestess" : "hermit";
  if (hasTanpura && bright) return moving ? "temperance" : "empress";
  if (bright && moving) return h % 2 === 0 ? "sun" : "world";
  if (bright) return h % 3 === 0 ? "star" : h % 3 === 1 ? "fool" : "wheel";
  if (moving) return h % 2 === 0 ? "hanged" : "moon";
  return h % 2 === 0 ? "moon" : "world";
}

/* ─── Horizon band ─────────────────────────────────────────────────────── */

type Horizon = "mountains" | "waves" | "stars" | "dunes";

/** Climate quadrant → horizon band. X = bright, Y = moving. */
function pickHorizon(bright: boolean, moving: boolean): Horizon {
  if (moving && !bright) return "waves";
  if (moving && bright) return "stars";
  if (!moving && bright) return "dunes";
  return "mountains";
}

function drawHorizon(
  horizon: Horizon,
  x: number,
  y: number,
  w: number,
  h: number,
  pal: Palette,
  rng: () => number,
): string {
  const midY = y + h * 0.55;
  const ground = `<rect x="${x}" y="${midY.toFixed(1)}" width="${w}" height="${(y + h - midY).toFixed(1)}" fill="${pal.hatch}" fill-opacity="0.35"/>`;
  switch (horizon) {
    case "mountains": {
      const peaks: string[] = [`M ${x.toFixed(1)} ${midY.toFixed(1)}`];
      const n = 6;
      for (let i = 1; i <= n; i++) {
        const px = x + (i / n) * w;
        const py = midY - rngRange(rng, 14, 32);
        peaks.push(`L ${(px - w / (n * 2)).toFixed(1)} ${py.toFixed(1)}`);
        peaks.push(`L ${px.toFixed(1)} ${(midY - rngRange(rng, 4, 10)).toFixed(1)}`);
      }
      peaks.push(`L ${(x + w).toFixed(1)} ${midY.toFixed(1)} Z`);
      return (
        ground +
        `<path d="${peaks.join(" ")}" fill="${pal.hatch}" fill-opacity="0.7" stroke="${pal.goldDim}" stroke-width="1" stroke-opacity="0.7"/>`
      );
    }
    case "waves": {
      const lines: string[] = [];
      for (let i = 0; i < 4; i++) {
        const ly = midY - i * 10 - 4;
        const phase = rngRange(rng, 0, Math.PI * 2);
        const pts: string[] = [];
        for (let k = 0; k <= 24; k++) {
          const t = k / 24;
          const wx = x + t * w;
          const wy = ly + Math.sin(phase + t * 8) * 3;
          pts.push(`${k === 0 ? "M" : "L"} ${wx.toFixed(1)} ${wy.toFixed(1)}`);
        }
        lines.push(`<path d="${pts.join(" ")}" fill="none" stroke="${pal.goldDim}" stroke-width="1" stroke-opacity="${(0.7 - i * 0.12).toFixed(2)}"/>`);
      }
      return ground + lines.join("");
    }
    case "stars": {
      const stars: string[] = [];
      for (let i = 0; i < 22; i++) {
        const sx = x + rng() * w;
        const sy = y + rng() * (midY - y) * 0.95;
        const r = rngRange(rng, 0.8, 2.2);
        stars.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.toFixed(1)}" fill="${pal.gold}" fill-opacity="${rngRange(rng, 0.35, 0.9).toFixed(2)}"/>`);
      }
      return ground + stars.join("");
    }
    case "dunes": {
      const arcs: string[] = [];
      for (let i = 0; i < 3; i++) {
        const cy = midY - i * 16 + 6;
        const path = `M ${x.toFixed(1)} ${cy.toFixed(1)} Q ${(x + w * 0.5).toFixed(1)} ${(cy - rngRange(rng, 20, 40)).toFixed(1)} ${(x + w).toFixed(1)} ${cy.toFixed(1)}`;
        arcs.push(`<path d="${path}" fill="none" stroke="${pal.goldDim}" stroke-width="1" stroke-opacity="${(0.8 - i * 0.2).toFixed(2)}"/>`);
      }
      return ground + arcs.join("");
    }
  }
}

/* ─── Hatching helper ──────────────────────────────────────────────────── */

/** Fill a rectangle with parallel hatching lines. Used sparingly inside
 *  glyph bodies for woodcut shading. */
function hatch(
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
  spacing: number,
  ink: string,
  opacity = 0.5,
): string {
  const out: string[] = [`<g stroke="${ink}" stroke-width="1" stroke-opacity="${opacity}">`];
  const r = Math.hypot(w, h) / 2 + 4;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  // normal to hatching
  const nx = -sa;
  const ny = ca;
  for (let t = -r; t <= r; t += spacing) {
    const mx = cx + nx * t;
    const my = cy + ny * t;
    const x1 = mx - ca * r;
    const y1 = my - sa * r;
    const x2 = mx + ca * r;
    const y2 = my + sa * r;
    out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
  }
  out.push("</g>");
  return out.join("");
}

/* ─── Small deterministic jitter ───────────────────────────────────────── */

function j(rng: () => number, amt = 2): number {
  return rngRange(rng, -amt, amt);
}

/* ─── Engraved human-figure helper ─────────────────────────────────────── */

type FigurePose = "dancing" | "walking" | "hanging" | "magician";

/**
 * Draw a stylised Art-Nouveau silhouette centred at (cx, cy) with total
 * body height `h`. Filled gold body with thick stroked limbs — reads as
 * a woodcut rather than a stick figure. Poses:
 *   · dancing  — both arms raised in V, weight on right leg (World)
 *   · walking  — striding, stick-bundle over shoulder (Fool)
 *   · hanging  — inverted, figure-4 legs, halo (Hanged)
 *   · magician — right arm up with wand, left arm down (Magician)
 */
function drawFigure(
  cx: number,
  cy: number,
  h: number,
  pose: FigurePose,
  pal: Palette,
): string {
  if (pose === "hanging") return drawFigureHanging(cx, cy, h, pal);

  const limb = Math.max(3, h * 0.028);
  const headR = h * 0.068;
  const headCy = cy - h * 0.40;
  const shoulderY = cy - h * 0.30;
  const shoulderHW = h * 0.095;
  const waistY = cy - h * 0.08;
  const waistHW = h * 0.065;
  const hipY = cy + h * 0.04;
  const hipHW = h * 0.11;
  const footY = cy + h * 0.48;

  const lSh = { x: cx - shoulderHW, y: shoulderY };
  const rSh = { x: cx + shoulderHW, y: shoulderY };
  const lHip = { x: cx - hipHW * 0.6, y: hipY };
  const rHip = { x: cx + hipHW * 0.6, y: hipY };

  let lHand: { x: number; y: number };
  let rHand: { x: number; y: number };
  let lElbow: { x: number; y: number };
  let rElbow: { x: number; y: number };
  let lFoot: { x: number; y: number };
  let rFoot: { x: number; y: number };
  let lKnee: { x: number; y: number };
  let rKnee: { x: number; y: number };
  let extras = "";

  switch (pose) {
    case "dancing": {
      lHand = { x: cx - h * 0.30, y: shoulderY - h * 0.22 };
      rHand = { x: cx + h * 0.30, y: shoulderY - h * 0.22 };
      lElbow = { x: cx - h * 0.22, y: shoulderY - h * 0.06 };
      rElbow = { x: cx + h * 0.22, y: shoulderY - h * 0.06 };
      // Right leg weight-bearing (more vertical), left leg crossed behind
      rFoot = { x: cx + h * 0.04, y: footY };
      rKnee = { x: cx + h * 0.04, y: (hipY + footY) / 2 };
      lFoot = { x: cx + h * 0.14, y: footY - h * 0.02 };
      lKnee = { x: cx - h * 0.01, y: (hipY + footY) / 2 + h * 0.03 };
      // Two wands — short gold rods angled outward
      const wLen = h * 0.18;
      const aL = -Math.PI / 2 - 0.38;
      const aR = -Math.PI / 2 + 0.38;
      extras =
        `<line x1="${lHand.x.toFixed(1)}" y1="${lHand.y.toFixed(1)}" x2="${(lHand.x + Math.cos(aL) * wLen).toFixed(1)}" y2="${(lHand.y + Math.sin(aL) * wLen).toFixed(1)}" stroke-width="${(limb * 0.9).toFixed(1)}"/>` +
        `<line x1="${rHand.x.toFixed(1)}" y1="${rHand.y.toFixed(1)}" x2="${(rHand.x + Math.cos(aR) * wLen).toFixed(1)}" y2="${(rHand.y + Math.sin(aR) * wLen).toFixed(1)}" stroke-width="${(limb * 0.9).toFixed(1)}"/>` +
        // Sash across torso (accent colour)
        `<path d="M ${(cx - waistHW * 1.2).toFixed(1)} ${(shoulderY + h * 0.04).toFixed(1)} Q ${cx.toFixed(1)} ${(waistY + h * 0.02).toFixed(1)} ${(cx + waistHW * 1.2).toFixed(1)} ${(waistY + h * 0.06).toFixed(1)}" fill="none" stroke="${pal.accent}" stroke-width="2.2"/>`;
      break;
    }
    case "walking": {
      // Back arm holds stick over shoulder; front arm swings forward
      lHand = { x: cx - h * 0.20, y: shoulderY + h * 0.10 };
      rHand = { x: cx + h * 0.22, y: shoulderY - h * 0.12 };
      lElbow = { x: cx - h * 0.12, y: shoulderY + h * 0.02 };
      rElbow = { x: cx + h * 0.14, y: shoulderY - h * 0.02 };
      // Striding — back leg planted, front leg lifted
      lFoot = { x: cx - h * 0.16, y: footY };
      lKnee = { x: cx - h * 0.12, y: (hipY + footY) / 2 + h * 0.02 };
      rFoot = { x: cx + h * 0.18, y: footY - h * 0.02 };
      rKnee = { x: cx + h * 0.14, y: (hipY + footY) / 2 - h * 0.02 };
      // Stick-and-bundle behind right shoulder
      const sx1 = rHand.x;
      const sy1 = rHand.y;
      const sx2 = cx + h * 0.42;
      const sy2 = shoulderY - h * 0.40;
      extras =
        `<line x1="${sx1.toFixed(1)}" y1="${sy1.toFixed(1)}" x2="${sx2.toFixed(1)}" y2="${sy2.toFixed(1)}" stroke-width="${(limb * 0.8).toFixed(1)}"/>` +
        `<path d="M ${(sx2 + 2).toFixed(1)} ${(sy2 - 4).toFixed(1)} Q ${(sx2 + 16).toFixed(1)} ${(sy2 - 14).toFixed(1)} ${(sx2 + 14).toFixed(1)} ${(sy2 + 4).toFixed(1)} Q ${(sx2 + 12).toFixed(1)} ${(sy2 + 10).toFixed(1)} ${(sx2 + 2).toFixed(1)} ${(sy2 - 4).toFixed(1)} Z" fill="${pal.card}" stroke-width="2"/>`;
      break;
    }
    case "magician": {
      // Raised right arm with wand, left arm angled down
      lHand = { x: cx - h * 0.20, y: shoulderY + h * 0.26 };
      rHand = { x: cx + h * 0.22, y: shoulderY - h * 0.34 };
      lElbow = { x: cx - h * 0.18, y: shoulderY + h * 0.10 };
      rElbow = { x: cx + h * 0.18, y: shoulderY - h * 0.14 };
      lFoot = { x: cx - h * 0.10, y: footY };
      lKnee = { x: cx - h * 0.09, y: (hipY + footY) / 2 };
      rFoot = { x: cx + h * 0.12, y: footY };
      rKnee = { x: cx + h * 0.10, y: (hipY + footY) / 2 };
      const wLen = h * 0.20;
      extras =
        `<line x1="${rHand.x.toFixed(1)}" y1="${rHand.y.toFixed(1)}" x2="${rHand.x.toFixed(1)}" y2="${(rHand.y - wLen).toFixed(1)}" stroke-width="${(limb * 0.9).toFixed(1)}"/>` +
        `<circle cx="${rHand.x.toFixed(1)}" cy="${(rHand.y - wLen).toFixed(1)}" r="5" fill="${pal.accent}" stroke="none"/>` +
        // Lemniscate above head
        (() => {
          const ly = headCy - headR - h * 0.10;
          const lw = h * 0.12;
          const lh = h * 0.05;
          return `<path d="M ${(cx - lw).toFixed(1)} ${ly.toFixed(1)} C ${(cx - lw).toFixed(1)} ${(ly - lh).toFixed(1)} ${cx.toFixed(1)} ${(ly - lh).toFixed(1)} ${cx.toFixed(1)} ${ly.toFixed(1)} C ${cx.toFixed(1)} ${(ly + lh).toFixed(1)} ${(cx + lw).toFixed(1)} ${(ly + lh).toFixed(1)} ${(cx + lw).toFixed(1)} ${ly.toFixed(1)} C ${(cx + lw).toFixed(1)} ${(ly - lh).toFixed(1)} ${cx.toFixed(1)} ${(ly - lh).toFixed(1)} ${cx.toFixed(1)} ${ly.toFixed(1)} C ${cx.toFixed(1)} ${(ly + lh).toFixed(1)} ${(cx - lw).toFixed(1)} ${(ly + lh).toFixed(1)} ${(cx - lw).toFixed(1)} ${ly.toFixed(1)} Z" fill="none" stroke-width="2"/>`;
        })();
      break;
    }
    default: {
      // unreachable — pose already narrowed; assignment for exhaustiveness
      lHand = rHand = lElbow = rElbow = lFoot = rFoot = lKnee = rKnee = { x: cx, y: cy };
    }
  }

  const torsoPath =
    `M ${lSh.x.toFixed(1)} ${lSh.y.toFixed(1)} ` +
    `Q ${(cx - waistHW).toFixed(1)} ${waistY.toFixed(1)} ${lHip.x.toFixed(1)} ${lHip.y.toFixed(1)} ` +
    `L ${rHip.x.toFixed(1)} ${rHip.y.toFixed(1)} ` +
    `Q ${(cx + waistHW).toFixed(1)} ${waistY.toFixed(1)} ${rSh.x.toFixed(1)} ${rSh.y.toFixed(1)} ` +
    `Q ${cx.toFixed(1)} ${(shoulderY - h * 0.02).toFixed(1)} ${lSh.x.toFixed(1)} ${lSh.y.toFixed(1)} Z`;

  const lArm = `M ${lSh.x.toFixed(1)} ${lSh.y.toFixed(1)} Q ${lElbow.x.toFixed(1)} ${lElbow.y.toFixed(1)} ${lHand.x.toFixed(1)} ${lHand.y.toFixed(1)}`;
  const rArm = `M ${rSh.x.toFixed(1)} ${rSh.y.toFixed(1)} Q ${rElbow.x.toFixed(1)} ${rElbow.y.toFixed(1)} ${rHand.x.toFixed(1)} ${rHand.y.toFixed(1)}`;
  const lLeg = `M ${lHip.x.toFixed(1)} ${lHip.y.toFixed(1)} Q ${lKnee.x.toFixed(1)} ${lKnee.y.toFixed(1)} ${lFoot.x.toFixed(1)} ${lFoot.y.toFixed(1)}`;
  const rLeg = `M ${rHip.x.toFixed(1)} ${rHip.y.toFixed(1)} Q ${rKnee.x.toFixed(1)} ${rKnee.y.toFixed(1)} ${rFoot.x.toFixed(1)} ${rFoot.y.toFixed(1)}`;

  return (
    `<g fill="${pal.gold}" stroke="${pal.gold}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${lLeg}" fill="none" stroke-width="${limb.toFixed(1)}"/>` +
    `<path d="${rLeg}" fill="none" stroke-width="${limb.toFixed(1)}"/>` +
    `<path d="${torsoPath}" stroke-width="1.4"/>` +
    `<path d="${lArm}" fill="none" stroke-width="${limb.toFixed(1)}"/>` +
    `<path d="${rArm}" fill="none" stroke-width="${limb.toFixed(1)}"/>` +
    `<circle cx="${lHand.x.toFixed(1)}" cy="${lHand.y.toFixed(1)}" r="${(limb * 0.7).toFixed(1)}"/>` +
    `<circle cx="${rHand.x.toFixed(1)}" cy="${rHand.y.toFixed(1)}" r="${(limb * 0.7).toFixed(1)}"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${headCy.toFixed(1)}" r="${headR.toFixed(1)}" fill="${pal.card}" stroke="${pal.gold}" stroke-width="2"/>` +
    extras +
    `</g>`
  );
}

function drawFigureHanging(cx: number, cy: number, h: number, pal: Palette): string {
  const limb = Math.max(3, h * 0.028);
  const headR = h * 0.068;
  const headCy = cy + h * 0.34;
  const shoulderY = cy + h * 0.24;
  const shoulderHW = h * 0.095;
  const waistY = cy + h * 0.02;
  const waistHW = h * 0.065;
  const hipY = cy - h * 0.10;
  const hipHW = h * 0.11;
  const topY = cy - h * 0.48;

  const lSh = { x: cx - shoulderHW, y: shoulderY };
  const rSh = { x: cx + shoulderHW, y: shoulderY };
  const lHip = { x: cx - hipHW * 0.6, y: hipY };
  const rHip = { x: cx + hipHW * 0.6, y: hipY };

  // Figure-4: right leg straight up to rope, left bent across
  const rFoot = { x: cx, y: topY };
  const rKnee = { x: cx - h * 0.01, y: (hipY + topY) / 2 };
  const lKnee = { x: cx - h * 0.22, y: cy - h * 0.22 };
  const lFoot = { x: cx + h * 0.02, y: cy - h * 0.14 };

  // Arms tucked behind back — short inward curves
  const lHand = { x: cx - shoulderHW * 0.35, y: shoulderY + h * 0.06 };
  const rHand = { x: cx + shoulderHW * 0.35, y: shoulderY + h * 0.06 };
  const lElbow = { x: cx - shoulderHW * 1.2, y: shoulderY + h * 0.02 };
  const rElbow = { x: cx + shoulderHW * 1.2, y: shoulderY + h * 0.02 };

  const torsoPath =
    `M ${lSh.x.toFixed(1)} ${lSh.y.toFixed(1)} ` +
    `Q ${(cx - waistHW).toFixed(1)} ${waistY.toFixed(1)} ${lHip.x.toFixed(1)} ${lHip.y.toFixed(1)} ` +
    `L ${rHip.x.toFixed(1)} ${rHip.y.toFixed(1)} ` +
    `Q ${(cx + waistHW).toFixed(1)} ${waistY.toFixed(1)} ${rSh.x.toFixed(1)} ${rSh.y.toFixed(1)} ` +
    `Q ${cx.toFixed(1)} ${(shoulderY + h * 0.02).toFixed(1)} ${lSh.x.toFixed(1)} ${lSh.y.toFixed(1)} Z`;

  const lArm = `M ${lSh.x.toFixed(1)} ${lSh.y.toFixed(1)} Q ${lElbow.x.toFixed(1)} ${lElbow.y.toFixed(1)} ${lHand.x.toFixed(1)} ${lHand.y.toFixed(1)}`;
  const rArm = `M ${rSh.x.toFixed(1)} ${rSh.y.toFixed(1)} Q ${rElbow.x.toFixed(1)} ${rElbow.y.toFixed(1)} ${rHand.x.toFixed(1)} ${rHand.y.toFixed(1)}`;
  const lLeg = `M ${lHip.x.toFixed(1)} ${lHip.y.toFixed(1)} Q ${lKnee.x.toFixed(1)} ${lKnee.y.toFixed(1)} ${lFoot.x.toFixed(1)} ${lFoot.y.toFixed(1)}`;
  const rLeg = `M ${rHip.x.toFixed(1)} ${rHip.y.toFixed(1)} Q ${rKnee.x.toFixed(1)} ${rKnee.y.toFixed(1)} ${rFoot.x.toFixed(1)} ${rFoot.y.toFixed(1)}`;

  return (
    `<g fill="${pal.gold}" stroke="${pal.gold}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${lLeg}" fill="none" stroke-width="${limb.toFixed(1)}"/>` +
    `<path d="${rLeg}" fill="none" stroke-width="${limb.toFixed(1)}"/>` +
    `<path d="${torsoPath}" stroke-width="1.4"/>` +
    `<path d="${lArm}" fill="none" stroke-width="${limb.toFixed(1)}"/>` +
    `<path d="${rArm}" fill="none" stroke-width="${limb.toFixed(1)}"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${headCy.toFixed(1)}" r="${headR.toFixed(1)}" fill="${pal.card}" stroke="${pal.gold}" stroke-width="2"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${headCy.toFixed(1)}" r="${(headR * 1.7).toFixed(1)}" fill="none" stroke="${pal.gold}" stroke-width="1.4" stroke-dasharray="2 4"/>` +
    `</g>`
  );
}

/* ─── Pictograms ───────────────────────────────────────────────────────── */
/* Each returns an SVG fragment centred at (cx, cy), filling bounding box
 * roughly of size `size`. All share the PALETTE through parameter.        */

function drawFool(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  void rng;
  const h = size * 0.78;
  const bottom = cy + h / 2;
  return (
    `<g>` +
    // Cliff edge — small path falling away under the front foot
    `<path d="M ${(cx - size * 0.45).toFixed(1)} ${bottom.toFixed(1)} L ${(cx + size * 0.45).toFixed(1)} ${bottom.toFixed(1)} L ${(cx + size * 0.45).toFixed(1)} ${(bottom + 18).toFixed(1)} L ${(cx + size * 0.18).toFixed(1)} ${(bottom + 18).toFixed(1)} L ${(cx + size * 0.10).toFixed(1)} ${(bottom + 4).toFixed(1)} L ${(cx - size * 0.20).toFixed(1)} ${(bottom + 28).toFixed(1)}" fill="none" stroke="${pal.goldDim}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    drawFigure(cx, cy, h, "walking", pal) +
    `</g>`
  );
}

function drawMagician(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  void rng;
  const h = size * 0.82;
  const bottom = cy + h / 2;
  // Altar drawn behind the figure's lower half — traditional Magician chest
  const altarW = size * 0.52;
  const altarH = size * 0.14;
  const altarY = bottom - altarH * 0.4;
  return (
    `<g>` +
    // Altar
    `<rect x="${(cx - altarW / 2).toFixed(1)}" y="${altarY.toFixed(1)}" width="${altarW.toFixed(1)}" height="${altarH.toFixed(1)}" fill="${pal.card}" stroke="${pal.gold}" stroke-width="2.2"/>` +
    // Four suit tokens on altar
    `<circle cx="${(cx - altarW * 0.36).toFixed(1)}" cy="${(altarY + altarH * 0.5).toFixed(1)}" r="4" fill="${pal.gold}"/>` +
    `<rect x="${(cx - altarW * 0.14).toFixed(1)}" y="${(altarY + altarH * 0.35).toFixed(1)}" width="8" height="8" fill="${pal.gold}"/>` +
    `<path d="M ${(cx + altarW * 0.10).toFixed(1)} ${(altarY + altarH * 0.7).toFixed(1)} L ${(cx + altarW * 0.18).toFixed(1)} ${(altarY + altarH * 0.35).toFixed(1)} L ${(cx + altarW * 0.26).toFixed(1)} ${(altarY + altarH * 0.7).toFixed(1)} Z" fill="${pal.gold}"/>` +
    `<line x1="${(cx + altarW * 0.38).toFixed(1)}" y1="${(altarY + altarH * 0.25).toFixed(1)}" x2="${(cx + altarW * 0.38).toFixed(1)}" y2="${(altarY + altarH * 0.75).toFixed(1)}" stroke="${pal.gold}" stroke-width="2.4"/>` +
    drawFigure(cx, cy - size * 0.04, h, "magician", pal) +
    `</g>`
  );
}

function drawPriestess(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  // Veiled figure between two pillars, crescent at feet.
  const h = size * 0.8;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const pillarW = 18;
  const pX1 = cx - size * 0.38;
  const pX2 = cx + size * 0.38;
  void rng;
  return (
    `<g stroke="${pal.gold}" stroke-width="2.6" fill="${pal.card}" stroke-linecap="round" stroke-linejoin="round">` +
    // Pillars
    `<rect x="${(pX1 - pillarW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${pillarW}" height="${h.toFixed(1)}"/>` +
    `<rect x="${(pX2 - pillarW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${pillarW}" height="${h.toFixed(1)}"/>` +
    // Pillar letters
    `<text x="${pX1.toFixed(1)}" y="${(cy + 6).toFixed(1)}" fill="${pal.gold}" font-family="Georgia, serif" font-size="18" text-anchor="middle" stroke="none">B</text>` +
    `<text x="${pX2.toFixed(1)}" y="${(cy + 6).toFixed(1)}" fill="${pal.gold}" font-family="Georgia, serif" font-size="18" text-anchor="middle" stroke="none">J</text>` +
    // Veil (draped curve)
    `<path d="M ${(pX1 + pillarW / 2).toFixed(1)} ${(top + 40).toFixed(1)} Q ${cx.toFixed(1)} ${(top + 90).toFixed(1)} ${(pX2 - pillarW / 2).toFixed(1)} ${(top + 40).toFixed(1)}" fill="none"/>` +
    // Seated figure
    `<path d="M ${(cx - 28).toFixed(1)} ${(bottom - 20).toFixed(1)} Q ${cx.toFixed(1)} ${(cy + 20).toFixed(1)} ${(cx + 28).toFixed(1)} ${(bottom - 20).toFixed(1)} L ${(cx + 20).toFixed(1)} ${(cy - 10).toFixed(1)} Q ${cx.toFixed(1)} ${(cy - 30).toFixed(1)} ${(cx - 20).toFixed(1)} ${(cy - 10).toFixed(1)} Z"/>` +
    // Head
    `<circle cx="${cx.toFixed(1)}" cy="${(cy - 36).toFixed(1)}" r="11"/>` +
    // Crown (solar + lunar horns)
    `<path d="M ${(cx - 18).toFixed(1)} ${(cy - 46).toFixed(1)} Q ${(cx - 10).toFixed(1)} ${(cy - 58).toFixed(1)} ${(cx - 2).toFixed(1)} ${(cy - 46).toFixed(1)} M ${(cx + 18).toFixed(1)} ${(cy - 46).toFixed(1)} Q ${(cx + 10).toFixed(1)} ${(cy - 58).toFixed(1)} ${(cx + 2).toFixed(1)} ${(cy - 46).toFixed(1)}" fill="none" stroke-width="2"/>` +
    // Crescent at feet
    `<circle cx="${cx.toFixed(1)}" cy="${(bottom - 8).toFixed(1)}" r="9" fill="${pal.gold}" stroke="none"/>` +
    `<circle cx="${(cx + 4).toFixed(1)}" cy="${(bottom - 8).toFixed(1)}" r="7" fill="${pal.card}" stroke="none"/>` +
    `</g>`
  );
}

function drawEmpress(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  // Throne with heart-Venus symbol.
  const w = size * 0.7;
  const h = size * 0.75;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  void rng;
  return (
    `<g stroke="${pal.gold}" stroke-width="3" fill="${pal.card}" stroke-linecap="round" stroke-linejoin="round">` +
    // Throne back
    `<path d="M ${(cx - w / 2).toFixed(1)} ${bottom.toFixed(1)} L ${(cx - w / 2).toFixed(1)} ${(top + 40).toFixed(1)} Q ${cx.toFixed(1)} ${top.toFixed(1)} ${(cx + w / 2).toFixed(1)} ${(top + 40).toFixed(1)} L ${(cx + w / 2).toFixed(1)} ${bottom.toFixed(1)} Z"/>` +
    // Seat line
    `<line x1="${(cx - w / 2 + 10).toFixed(1)}" y1="${(cy + 30).toFixed(1)}" x2="${(cx + w / 2 - 10).toFixed(1)}" y2="${(cy + 30).toFixed(1)}"/>` +
    // Venus symbol
    `<circle cx="${cx.toFixed(1)}" cy="${(cy - 10).toFixed(1)}" r="22" fill="none" stroke-width="3.4"/>` +
    `<line x1="${cx.toFixed(1)}" y1="${(cy + 12).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy + 46).toFixed(1)}"/>` +
    `<line x1="${(cx - 14).toFixed(1)}" y1="${(cy + 28).toFixed(1)}" x2="${(cx + 14).toFixed(1)}" y2="${(cy + 28).toFixed(1)}"/>` +
    // Wheat stalks at base
    `<g stroke-width="2">` +
    `<line x1="${(cx - w / 2 + 24).toFixed(1)}" y1="${bottom.toFixed(1)}" x2="${(cx - w / 2 + 16).toFixed(1)}" y2="${(bottom + 24).toFixed(1)}"/>` +
    `<line x1="${(cx + w / 2 - 24).toFixed(1)}" y1="${bottom.toFixed(1)}" x2="${(cx + w / 2 - 16).toFixed(1)}" y2="${(bottom + 24).toFixed(1)}"/>` +
    `</g>` +
    `</g>`
  );
}

function drawEmperor(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  // Throne + ankh staff + rams on throne corners.
  const w = size * 0.72;
  const h = size * 0.8;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  void rng;
  return (
    `<g stroke="${pal.gold}" stroke-width="3" fill="${pal.card}" stroke-linecap="round" stroke-linejoin="round">` +
    // Rectangular throne
    `<rect x="${(cx - w / 2).toFixed(1)}" y="${(top + 40).toFixed(1)}" width="${w.toFixed(1)}" height="${(h - 40).toFixed(1)}"/>` +
    // Ram finials (curled horns as circles)
    `<circle cx="${(cx - w / 2).toFixed(1)}" cy="${(top + 30).toFixed(1)}" r="12" fill="${pal.accent}"/>` +
    `<circle cx="${(cx + w / 2).toFixed(1)}" cy="${(top + 30).toFixed(1)}" r="12" fill="${pal.accent}"/>` +
    // Seated torso
    `<path d="M ${(cx - 26).toFixed(1)} ${(bottom - 30).toFixed(1)} L ${(cx - 18).toFixed(1)} ${(cy - 4).toFixed(1)} L ${(cx + 18).toFixed(1)} ${(cy - 4).toFixed(1)} L ${(cx + 26).toFixed(1)} ${(bottom - 30).toFixed(1)} Z"/>` +
    // Head + crown
    `<circle cx="${cx.toFixed(1)}" cy="${(cy - 22).toFixed(1)}" r="12"/>` +
    `<path d="M ${(cx - 16).toFixed(1)} ${(cy - 34).toFixed(1)} L ${(cx - 8).toFixed(1)} ${(cy - 44).toFixed(1)} L ${cx.toFixed(1)} ${(cy - 34).toFixed(1)} L ${(cx + 8).toFixed(1)} ${(cy - 44).toFixed(1)} L ${(cx + 16).toFixed(1)} ${(cy - 34).toFixed(1)}" fill="${pal.gold}" stroke="none"/>` +
    // Ankh staff
    `<line x1="${(cx + w / 2 - 6).toFixed(1)}" y1="${(cy + 30).toFixed(1)}" x2="${(cx + w / 2 - 6).toFixed(1)}" y2="${(top + 10).toFixed(1)}" stroke-width="3"/>` +
    `<circle cx="${(cx + w / 2 - 6).toFixed(1)}" cy="${(top + 2).toFixed(1)}" r="9" fill="none" stroke-width="3"/>` +
    `<line x1="${(cx + w / 2 - 16).toFixed(1)}" y1="${(top + 18).toFixed(1)}" x2="${(cx + w / 2 + 4).toFixed(1)}" y2="${(top + 18).toFixed(1)}"/>` +
    `</g>`
  );
}

function drawHermit(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  // Cloaked figure with lantern, staff.
  const h = size * 0.85;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  void rng;
  return (
    `<g stroke="${pal.gold}" stroke-width="2.8" fill="${pal.card}" stroke-linecap="round" stroke-linejoin="round">` +
    // Cloak (large triangular body)
    `<path d="M ${(cx - 56).toFixed(1)} ${bottom.toFixed(1)} L ${(cx - 18).toFixed(1)} ${(top + 50).toFixed(1)} L ${(cx + 18).toFixed(1)} ${(top + 50).toFixed(1)} L ${(cx + 56).toFixed(1)} ${bottom.toFixed(1)} Z"/>` +
    // Hood (peaked top)
    `<path d="M ${(cx - 18).toFixed(1)} ${(top + 50).toFixed(1)} L ${cx.toFixed(1)} ${top.toFixed(1)} L ${(cx + 18).toFixed(1)} ${(top + 50).toFixed(1)}"/>` +
    // Hidden face (just a shadow slit)
    `<line x1="${(cx - 10).toFixed(1)}" y1="${(top + 34).toFixed(1)}" x2="${(cx + 10).toFixed(1)}" y2="${(top + 34).toFixed(1)}" stroke-width="2"/>` +
    // Staff
    `<line x1="${(cx - 72).toFixed(1)}" y1="${(bottom + 8).toFixed(1)}" x2="${(cx - 40).toFixed(1)}" y2="${(top + 20).toFixed(1)}" stroke-width="3"/>` +
    // Lantern
    `<g transform="translate(${(cx + 42).toFixed(1)} ${(cy - 14).toFixed(1)})">` +
    `<polygon points="-12,-16 12,-16 16,0 12,16 -12,16 -16,0" fill="${pal.card}"/>` +
    `<circle cx="0" cy="0" r="7" fill="${pal.accent}" stroke="none"/>` +
    `<line x1="0" y1="-20" x2="0" y2="-30"/>` +
    `</g>` +
    `</g>`
  );
}

function drawWheel(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  const r = size * 0.4;
  const spokes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rngRange(rng, -0.04, 0.04);
    spokes.push(
      `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}" stroke="${pal.gold}" stroke-width="2"/>`,
    );
  }
  const runes: string[] = [];
  const runeChars = ["T", "A", "R", "O"];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    const rr = r * 0.88;
    const rx = cx + Math.cos(a) * rr;
    const ry = cy + Math.sin(a) * rr;
    runes.push(
      `<text x="${rx.toFixed(1)}" y="${(ry + 5).toFixed(1)}" fill="${pal.gold}" font-family="Georgia, serif" font-size="14" text-anchor="middle">${runeChars[i]}</text>`,
    );
  }
  return (
    `<g>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${pal.card}" stroke="${pal.gold}" stroke-width="3.2"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.75).toFixed(1)}" fill="none" stroke="${pal.goldDim}" stroke-width="1.2"/>` +
    spokes.join("") +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.15).toFixed(1)}" fill="${pal.gold}"/>` +
    runes.join("") +
    `</g>`
  );
}

function drawJustice(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  // Upright sword + scales crossbar.
  const h = size;
  const top = cy - h / 2;
  void rng;
  return (
    `<g stroke="${pal.gold}" stroke-width="3" fill="${pal.card}" stroke-linecap="round" stroke-linejoin="round">` +
    // Blade
    `<path d="M ${(cx - 8).toFixed(1)} ${(cy + 30).toFixed(1)} L ${(cx + 8).toFixed(1)} ${(cy + 30).toFixed(1)} L ${(cx + 8).toFixed(1)} ${(top + 20).toFixed(1)} L ${cx.toFixed(1)} ${top.toFixed(1)} L ${(cx - 8).toFixed(1)} ${(top + 20).toFixed(1)} Z"/>` +
    // Crossguard
    `<rect x="${(cx - 24).toFixed(1)}" y="${(cy + 26).toFixed(1)}" width="48" height="8"/>` +
    // Grip
    `<line x1="${cx.toFixed(1)}" y1="${(cy + 34).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy + 70).toFixed(1)}" stroke-width="4"/>` +
    // Pommel
    `<circle cx="${cx.toFixed(1)}" cy="${(cy + 76).toFixed(1)}" r="7" fill="${pal.gold}"/>` +
    // Scales above (from sword tip)
    `<line x1="${cx.toFixed(1)}" y1="${(top - 4).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(top - 20).toFixed(1)}" stroke-width="2"/>` +
    `<line x1="${(cx - 44).toFixed(1)}" y1="${(top - 20).toFixed(1)}" x2="${(cx + 44).toFixed(1)}" y2="${(top - 20).toFixed(1)}" stroke-width="2"/>` +
    `<line x1="${(cx - 44).toFixed(1)}" y1="${(top - 20).toFixed(1)}" x2="${(cx - 44).toFixed(1)}" y2="${(top - 4).toFixed(1)}" stroke-width="1.5"/>` +
    `<line x1="${(cx + 44).toFixed(1)}" y1="${(top - 20).toFixed(1)}" x2="${(cx + 44).toFixed(1)}" y2="${(top - 4).toFixed(1)}" stroke-width="1.5"/>` +
    `<path d="M ${(cx - 56).toFixed(1)} ${(top - 4).toFixed(1)} Q ${(cx - 44).toFixed(1)} ${(top + 8).toFixed(1)} ${(cx - 32).toFixed(1)} ${(top - 4).toFixed(1)}" fill="none" stroke-width="1.6"/>` +
    `<path d="M ${(cx + 32).toFixed(1)} ${(top - 4).toFixed(1)} Q ${(cx + 44).toFixed(1)} ${(top + 8).toFixed(1)} ${(cx + 56).toFixed(1)} ${(top - 4).toFixed(1)}" fill="none" stroke-width="1.6"/>` +
    `</g>`
  );
}

function drawHanged(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  void rng;
  const h = size * 0.82;
  const top = cy - h / 2;
  return (
    `<g>` +
    // T-cross gibbet
    `<line x1="${(cx - 70).toFixed(1)}" y1="${(top + 8).toFixed(1)}" x2="${(cx + 70).toFixed(1)}" y2="${(top + 8).toFixed(1)}" stroke="${pal.gold}" stroke-width="4" stroke-linecap="round"/>` +
    `<line x1="${(cx - 70).toFixed(1)}" y1="${(top + 8).toFixed(1)}" x2="${(cx - 70).toFixed(1)}" y2="${(top + 36).toFixed(1)}" stroke="${pal.gold}" stroke-width="3" stroke-linecap="round"/>` +
    `<line x1="${(cx + 70).toFixed(1)}" y1="${(top + 8).toFixed(1)}" x2="${(cx + 70).toFixed(1)}" y2="${(top + 36).toFixed(1)}" stroke="${pal.gold}" stroke-width="3" stroke-linecap="round"/>` +
    // Rope from crossbeam to figure's foot
    `<line x1="${cx.toFixed(1)}" y1="${(top + 8).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy - h * 0.48).toFixed(1)}" stroke="${pal.gold}" stroke-width="1.6"/>` +
    drawFigure(cx, cy, h, "hanging", pal) +
    `</g>`
  );
}

function drawDeath(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  // Scythe + small skull.
  void rng;
  const r = size * 0.18;
  return (
    `<g stroke="${pal.gold}" stroke-width="3" fill="${pal.card}" stroke-linecap="round" stroke-linejoin="round">` +
    // Scythe shaft (diagonal)
    `<line x1="${(cx - size * 0.35).toFixed(1)}" y1="${(cy + size * 0.45).toFixed(1)}" x2="${(cx + size * 0.3).toFixed(1)}" y2="${(cy - size * 0.45).toFixed(1)}" stroke-width="4"/>` +
    // Blade (curve at top)
    `<path d="M ${(cx + size * 0.3).toFixed(1)} ${(cy - size * 0.45).toFixed(1)} Q ${(cx + size * 0.05).toFixed(1)} ${(cy - size * 0.38).toFixed(1)} ${(cx - size * 0.2).toFixed(1)} ${(cy - size * 0.26).toFixed(1)}" fill="none" stroke-width="4"/>` +
    // Skull
    `<circle cx="${cx.toFixed(1)}" cy="${(cy + size * 0.1).toFixed(1)}" r="${r.toFixed(1)}"/>` +
    // Eye sockets
    `<circle cx="${(cx - r * 0.42).toFixed(1)}" cy="${(cy + size * 0.08).toFixed(1)}" r="${(r * 0.22).toFixed(1)}" fill="${pal.bg}" stroke="none"/>` +
    `<circle cx="${(cx + r * 0.42).toFixed(1)}" cy="${(cy + size * 0.08).toFixed(1)}" r="${(r * 0.22).toFixed(1)}" fill="${pal.bg}" stroke="none"/>` +
    // Nasal
    `<path d="M ${cx.toFixed(1)} ${(cy + size * 0.14).toFixed(1)} L ${(cx - 4).toFixed(1)} ${(cy + size * 0.2).toFixed(1)} L ${(cx + 4).toFixed(1)} ${(cy + size * 0.2).toFixed(1)} Z" fill="${pal.bg}" stroke="none"/>` +
    // Teeth
    `<line x1="${(cx - r * 0.55).toFixed(1)}" y1="${(cy + size * 0.23).toFixed(1)}" x2="${(cx + r * 0.55).toFixed(1)}" y2="${(cy + size * 0.23).toFixed(1)}" stroke-width="1.4"/>` +
    `<line x1="${(cx - r * 0.25).toFixed(1)}" y1="${(cy + size * 0.21).toFixed(1)}" x2="${(cx - r * 0.25).toFixed(1)}" y2="${(cy + size * 0.27).toFixed(1)}" stroke-width="1.4"/>` +
    `<line x1="${(cx + r * 0.25).toFixed(1)}" y1="${(cy + size * 0.21).toFixed(1)}" x2="${(cx + r * 0.25).toFixed(1)}" y2="${(cy + size * 0.27).toFixed(1)}" stroke-width="1.4"/>` +
    `</g>`
  );
}

function drawTemperance(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  // Two vessels pouring into each other.
  void rng;
  const offset = size * 0.18;
  const vw = size * 0.28;
  return (
    `<g stroke="${pal.gold}" stroke-width="2.8" fill="${pal.card}" stroke-linecap="round" stroke-linejoin="round">` +
    // Left vessel (upper)
    `<path d="M ${(cx - offset - vw / 2).toFixed(1)} ${(cy - 40).toFixed(1)} Q ${(cx - offset).toFixed(1)} ${(cy + 20).toFixed(1)} ${(cx - offset + vw / 2).toFixed(1)} ${(cy - 40).toFixed(1)} L ${(cx - offset + vw / 2 - 4).toFixed(1)} ${(cy - 42).toFixed(1)} L ${(cx - offset - vw / 2 + 4).toFixed(1)} ${(cy - 42).toFixed(1)} Z"/>` +
    // Right vessel (lower, tilted — drawn via path rotation approximation as a trapezoid)
    `<path d="M ${(cx + offset - vw / 2).toFixed(1)} ${(cy + 10).toFixed(1)} Q ${(cx + offset).toFixed(1)} ${(cy + 70).toFixed(1)} ${(cx + offset + vw / 2).toFixed(1)} ${(cy + 10).toFixed(1)} L ${(cx + offset + vw / 2 - 4).toFixed(1)} ${(cy + 8).toFixed(1)} L ${(cx + offset - vw / 2 + 4).toFixed(1)} ${(cy + 8).toFixed(1)} Z"/>` +
    // Stream between
    `<path d="M ${(cx - offset).toFixed(1)} ${(cy - 10).toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${(cx + offset).toFixed(1)} ${(cy + 20).toFixed(1)}" fill="none" stroke="${pal.accent}" stroke-width="2"/>` +
    // Small triangle (alchemical fire symbol) above
    `<path d="M ${(cx - 12).toFixed(1)} ${(cy - size * 0.45).toFixed(1)} L ${(cx + 12).toFixed(1)} ${(cy - size * 0.45).toFixed(1)} L ${cx.toFixed(1)} ${(cy - size * 0.45 - 18).toFixed(1)} Z" fill="none" stroke-width="2"/>` +
    `</g>`
  );
}

function drawDevil(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  // Horned mask with inverted pentagram.
  void rng;
  const r = size * 0.32;
  return (
    `<g stroke="${pal.gold}" stroke-width="3" fill="${pal.card}" stroke-linecap="round" stroke-linejoin="round">` +
    // Horns
    `<path d="M ${(cx - r * 0.6).toFixed(1)} ${(cy - r * 0.8).toFixed(1)} Q ${(cx - r * 1.1).toFixed(1)} ${(cy - r * 1.7).toFixed(1)} ${(cx - r * 0.9).toFixed(1)} ${(cy - r * 1.95).toFixed(1)}" fill="none" stroke-width="4"/>` +
    `<path d="M ${(cx + r * 0.6).toFixed(1)} ${(cy - r * 0.8).toFixed(1)} Q ${(cx + r * 1.1).toFixed(1)} ${(cy - r * 1.7).toFixed(1)} ${(cx + r * 0.9).toFixed(1)} ${(cy - r * 1.95).toFixed(1)}" fill="none" stroke-width="4"/>` +
    // Head mask
    `<path d="M ${(cx - r).toFixed(1)} ${cy.toFixed(1)} Q ${(cx - r).toFixed(1)} ${(cy - r * 1.1).toFixed(1)} ${cx.toFixed(1)} ${(cy - r * 1.1).toFixed(1)} Q ${(cx + r).toFixed(1)} ${(cy - r * 1.1).toFixed(1)} ${(cx + r).toFixed(1)} ${cy.toFixed(1)} Q ${cx.toFixed(1)} ${(cy + r * 1.2).toFixed(1)} ${(cx - r).toFixed(1)} ${cy.toFixed(1)} Z"/>` +
    // Eyes
    `<circle cx="${(cx - r * 0.42).toFixed(1)}" cy="${(cy - r * 0.15).toFixed(1)}" r="${(r * 0.12).toFixed(1)}" fill="${pal.accent}" stroke="none"/>` +
    `<circle cx="${(cx + r * 0.42).toFixed(1)}" cy="${(cy - r * 0.15).toFixed(1)}" r="${(r * 0.12).toFixed(1)}" fill="${pal.accent}" stroke="none"/>` +
    // Fanged mouth
    `<path d="M ${(cx - r * 0.4).toFixed(1)} ${(cy + r * 0.3).toFixed(1)} L ${(cx - r * 0.2).toFixed(1)} ${(cy + r * 0.55).toFixed(1)} L ${cx.toFixed(1)} ${(cy + r * 0.35).toFixed(1)} L ${(cx + r * 0.2).toFixed(1)} ${(cy + r * 0.55).toFixed(1)} L ${(cx + r * 0.4).toFixed(1)} ${(cy + r * 0.3).toFixed(1)}" fill="none" stroke-width="2"/>` +
    // Inverted pentagram on forehead
    (() => {
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const a = Math.PI / 2 + (i / 5) * Math.PI * 2 + Math.PI;
        pts.push(`${(cx + Math.cos(a) * 10).toFixed(1)},${(cy - r * 0.55 + Math.sin(a) * 10).toFixed(1)}`);
      }
      return `<polygon points="${pts[0]} ${pts[2]} ${pts[4]} ${pts[1]} ${pts[3]}" fill="none" stroke="${pal.accent}" stroke-width="1.4"/>`;
    })() +
    `</g>`
  );
}

function drawTower(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  const h = size;
  const w = size * 0.5;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const crenW = w / 5;
  let crenels = "";
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0) {
      crenels += `<rect x="${(left + i * crenW + j(rng)).toFixed(1)}" y="${(top + j(rng)).toFixed(1)}" width="${crenW.toFixed(1)}" height="14" fill="${pal.gold}"/>`;
    }
  }
  return (
    `<g stroke="${pal.gold}" stroke-width="3" fill="${pal.card}" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect x="${left.toFixed(1)}" y="${(top + 14).toFixed(1)}" width="${w.toFixed(1)}" height="${(h - 14).toFixed(1)}"/>` +
    crenels +
    `<rect x="${(cx - 6).toFixed(1)}" y="${(top + 60).toFixed(1)}" width="12" height="30" fill="${pal.bg}"/>` +
    `<rect x="${(cx - 6).toFixed(1)}" y="${(top + 120).toFixed(1)}" width="12" height="30" fill="${pal.bg}"/>` +
    `<path d="M ${(cx - 16).toFixed(1)} ${bottom.toFixed(1)} L ${(cx - 16).toFixed(1)} ${(bottom - 28).toFixed(1)} Q ${cx.toFixed(1)} ${(bottom - 44).toFixed(1)} ${(cx + 16).toFixed(1)} ${(bottom - 28).toFixed(1)} L ${(cx + 16).toFixed(1)} ${bottom.toFixed(1)} Z" fill="${pal.bg}"/>` +
    // Lightning
    `<path d="M ${(right + 20).toFixed(1)} ${(top - 20).toFixed(1)} L ${(right + 4).toFixed(1)} ${(cy - 20).toFixed(1)} L ${(right + 18).toFixed(1)} ${(cy - 20).toFixed(1)} L ${(right + 2).toFixed(1)} ${(cy + 40).toFixed(1)}" fill="none" stroke="${pal.accent}" stroke-width="2.5"/>` +
    `</g>`
  );
}

function drawStar(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  const r = size / 2;
  const inner = r * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : inner;
    pts.push(`${(cx + Math.cos(a) * rr + j(rng, 1.5)).toFixed(1)},${(cy + Math.sin(a) * rr + j(rng, 1.5)).toFixed(1)}`);
  }
  const smalls: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rngRange(rng, 0, 0.4);
    const d = r * 1.5;
    smalls.push(
      `<circle cx="${(cx + Math.cos(a) * d).toFixed(1)}" cy="${(cy + Math.sin(a) * d).toFixed(1)}" r="2.5" fill="${pal.gold}"/>`,
    );
  }
  return (
    `<g>` +
    `<polygon points="${pts.join(" ")}" fill="${pal.card}" stroke="${pal.gold}" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.28).toFixed(1)}" fill="${pal.gold}"/>` +
    smalls.join("") +
    `</g>`
  );
}

function drawMoon(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  const r = size * 0.32;
  const off = r * 0.55;
  const maskId = `moonMask-${(Math.floor(rng() * 1e6)).toString(36)}`;
  return (
    `<g>` +
    `<defs><mask id="${maskId}"><rect x="${(cx - r * 1.4).toFixed(1)}" y="${(cy - r * 1.4).toFixed(1)}" width="${(r * 2.8).toFixed(1)}" height="${(r * 2.8).toFixed(1)}" fill="white"/>` +
    `<circle cx="${(cx + off).toFixed(1)}" cy="${(cy - off * 0.2).toFixed(1)}" r="${(r * 0.92).toFixed(1)}" fill="black"/></mask></defs>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${pal.gold}" mask="url(#${maskId})"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${pal.gold}" stroke-width="2"/>` +
    `<circle cx="${(cx - r * 0.4 + j(rng)).toFixed(1)}" cy="${(cy + r * 1.5).toFixed(1)}" r="3" fill="${pal.gold}"/>` +
    `<circle cx="${(cx + r * 0.4 + j(rng)).toFixed(1)}" cy="${(cy + r * 1.7).toFixed(1)}" r="2.5" fill="${pal.gold}"/>` +
    `<circle cx="${(cx + j(rng)).toFixed(1)}" cy="${(cy + r * 1.9).toFixed(1)}" r="2" fill="${pal.gold}"/>` +
    `</g>`
  );
}

function drawSun(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  const r = size * 0.28;
  const rayLen = size * 0.22;
  const rays: string[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * (r + 8);
    const y1 = cy + Math.sin(a) * (r + 8);
    const x2 = cx + Math.cos(a) * (r + rayLen + j(rng, 3));
    const y2 = cy + Math.sin(a) * (r + rayLen + j(rng, 3));
    rays.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${pal.gold}" stroke-width="${i % 2 === 0 ? 3 : 1.6}" stroke-linecap="round"/>`,
    );
  }
  return (
    `<g>` +
    rays.join("") +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${pal.card}" stroke="${pal.gold}" stroke-width="3"/>` +
    `<circle cx="${(cx - r * 0.35).toFixed(1)}" cy="${(cy - r * 0.1).toFixed(1)}" r="3" fill="${pal.gold}"/>` +
    `<circle cx="${(cx + r * 0.35).toFixed(1)}" cy="${(cy - r * 0.1).toFixed(1)}" r="3" fill="${pal.gold}"/>` +
    `<path d="M ${(cx - r * 0.4).toFixed(1)} ${(cy + r * 0.25).toFixed(1)} Q ${cx.toFixed(1)} ${(cy + r * 0.5).toFixed(1)} ${(cx + r * 0.4).toFixed(1)} ${(cy + r * 0.25).toFixed(1)}" fill="none" stroke="${pal.gold}" stroke-width="2" stroke-linecap="round"/>` +
    `</g>`
  );
}

function drawWorld(cx: number, cy: number, size: number, pal: Palette, rng: () => number): string {
  void rng;
  const r = size * 0.42;
  // Wreath built from short curved laurel segments rather than a plain ring.
  const laurel: string[] = [];
  const leaves = 24;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2;
    const lx = cx + Math.cos(a) * r;
    const ly = cy + Math.sin(a) * r;
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    const inward = i % 2 === 0 ? 1 : -1;
    const x1 = lx - tx * 10;
    const y1 = ly - ty * 10;
    const x2 = lx + tx * 10;
    const y2 = ly + ty * 10;
    const cxL = lx + Math.cos(a) * 6 * inward;
    const cyL = ly + Math.sin(a) * 6 * inward;
    laurel.push(`<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cxL.toFixed(1)} ${cyL.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${pal.gold}" stroke-width="2.2" stroke-linecap="round"/>`);
  }
  // Four elemental corner marks (bull / lion / eagle / angel abstracted as dots)
  const corners: string[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 4;
    const mx = cx + Math.cos(a) * (r + 24);
    const my = cy + Math.sin(a) * (r + 24);
    corners.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="5" fill="${pal.gold}" stroke="none"/>`);
    corners.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="9" fill="none" stroke="${pal.goldDim}" stroke-width="1"/>`);
  }
  return (
    `<g>` +
    // Outer sash ring (gold)
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${pal.gold}" stroke-width="3.6"/>` +
    // Inner dashed guide
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r - 14).toFixed(1)}" fill="none" stroke="${pal.goldDim}" stroke-width="1.2" stroke-dasharray="2 6"/>` +
    // Laurel leaves
    laurel.join("") +
    // Wreath binding ties at top and bottom (small red knots)
    `<ellipse cx="${cx.toFixed(1)}" cy="${(cy - r).toFixed(1)}" rx="8" ry="4" fill="${pal.accent}" stroke="${pal.gold}" stroke-width="1.2"/>` +
    `<ellipse cx="${cx.toFixed(1)}" cy="${(cy + r).toFixed(1)}" rx="8" ry="4" fill="${pal.accent}" stroke="${pal.gold}" stroke-width="1.2"/>` +
    // Elemental corner marks
    corners.join("") +
    // Dancing figure with two wands
    drawFigure(cx, cy, size * 0.78, "dancing", pal) +
    `</g>`
  );
}

function drawPictogram(
  picto: Pictogram,
  cx: number,
  cy: number,
  size: number,
  pal: Palette,
  rng: () => number,
): string {
  switch (picto) {
    case "fool":       return drawFool(cx, cy, size, pal, rng);
    case "magician":   return drawMagician(cx, cy, size, pal, rng);
    case "priestess":  return drawPriestess(cx, cy, size, pal, rng);
    case "empress":    return drawEmpress(cx, cy, size, pal, rng);
    case "emperor":    return drawEmperor(cx, cy, size, pal, rng);
    case "hermit":     return drawHermit(cx, cy, size, pal, rng);
    case "wheel":      return drawWheel(cx, cy, size, pal, rng);
    case "justice":    return drawJustice(cx, cy, size, pal, rng);
    case "hanged":     return drawHanged(cx, cy, size, pal, rng);
    case "death":      return drawDeath(cx, cy, size, pal, rng);
    case "temperance": return drawTemperance(cx, cy, size, pal, rng);
    case "devil":      return drawDevil(cx, cy, size, pal, rng);
    case "tower":      return drawTower(cx, cy, size, pal, rng);
    case "star":       return drawStar(cx, cy, size, pal, rng);
    case "moon":       return drawMoon(cx, cy, size, pal, rng);
    case "sun":        return drawSun(cx, cy, size, pal, rng);
    case "world":      return drawWorld(cx, cy, size, pal, rng);
  }
}

/* ─── Keyword ribbon vocabulary ────────────────────────────────────────── */

const KEYWORDS_DARK_STILL = ["SILENCE", "DEPTHS", "ASHES", "VESPERS", "GRAVITY"];
const KEYWORDS_DARK_MOVING = ["TIDES", "DRIFT", "SOMNUS", "LAMENT", "PASSAGE"];
const KEYWORDS_BRIGHT_STILL = ["DAWN", "ORISON", "HEARTH", "PSALM", "TEMENOS"];
const KEYWORDS_BRIGHT_MOVING = ["WINGS", "GLORIA", "RESOUND", "EMBER", "CANTICLE"];

function pickKeyword(bright: boolean, moving: boolean, rng: () => number): string {
  const pool =
    !bright && !moving ? KEYWORDS_DARK_STILL :
    !bright && moving  ? KEYWORDS_DARK_MOVING :
     bright && !moving ? KEYWORDS_BRIGHT_STILL :
                         KEYWORDS_BRIGHT_MOVING;
  return rngPick(rng, pool);
}

/* ─── Text helpers ─────────────────────────────────────────────────────── */

function bannerTitle(s: string): string {
  const t = (s || "UNTITLED").toUpperCase().trim();
  if (t.length <= 18) return t;
  return t.slice(0, 17) + "…";
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => {
    switch (ch) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return ch;
    }
  });
}

/* ─── Aged paper texture (<pattern>) ───────────────────────────────────── */

/** Produces a <defs> block with a speckle pattern for subtle foxing. */
function paperPatternDefs(patternId: string, pal: Palette, rng: () => number): string {
  const dots: string[] = [];
  for (let i = 0; i < 14; i++) {
    const x = (rng() * 40).toFixed(1);
    const y = (rng() * 40).toFixed(1);
    const r = rngRange(rng, 0.4, 1.4).toFixed(2);
    const op = rngRange(rng, 0.12, 0.28).toFixed(2);
    dots.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${pal.hatch}" fill-opacity="${op}"/>`);
  }
  return (
    `<defs>` +
    `<pattern id="${patternId}" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">` +
    dots.join("") +
    `</pattern>` +
    `</defs>`
  );
}

/* ─── Entry point ──────────────────────────────────────────────────────── */

export function buildTarotSvg(ctx: ShareCardContext): string {
  const { width, height, rng, hash, title } = ctx;
  const drone = ctx.scene.drone;
  const pal = PALETTES[drone.root as PitchClass] ?? PALETTES.C;

  const hasTanpura = !!drone.voiceLayers.tanpura;
  const hasMetal = !!drone.voiceLayers.metal;
  const hasAmp = !!drone.voiceLayers.amp;
  const bright = drone.climateX > 0.5;
  const moving = drone.climateY > 0.4;

  const picto = pickPictogram(hasTanpura, hasMetal, hasAmp, bright, moving, hash);
  const arcana = ARCANA[picto];
  const horizon = pickHorizon(bright, moving);
  const keyword = pickKeyword(bright, moving, rng);

  // Card geometry — square.
  const inset = 40;
  const cardX = inset;
  const cardY = inset;
  const cardW = width - inset * 2;
  const cardH = height - inset * 2;
  const cx = width / 2;

  const parts: string[] = [];

  // Outer vignette.
  parts.push(`<rect width="${width}" height="${height}" fill="${pal.bg}"/>`);

  // Paper pattern def.
  const paperId = `tarotPaper-${hash.toString(36)}`;
  parts.push(paperPatternDefs(paperId, pal, rng));

  // Card body + wash.
  parts.push(`<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="4" fill="${pal.card}"/>`);
  parts.push(
    `<defs><radialGradient id="tarotWash-${hash.toString(36)}" cx="50%" cy="45%" r="60%">` +
      `<stop offset="0%" stop-color="${pal.cardEdge}" stop-opacity="1"/>` +
      `<stop offset="100%" stop-color="${pal.card}" stop-opacity="1"/>` +
      `</radialGradient></defs>`,
  );
  parts.push(
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="4" fill="url(#tarotWash-${hash.toString(36)})"/>`,
  );
  // Speckle foxing overlay.
  parts.push(
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="4" fill="url(#${paperId})" fill-opacity="0.9"/>`,
  );

  // Double gold border.
  parts.push(
    `<rect x="${cardX + 14}" y="${cardY + 14}" width="${cardW - 28}" height="${cardH - 28}" fill="none" stroke="${pal.gold}" stroke-width="3"/>`,
  );
  parts.push(
    `<rect x="${cardX + 22}" y="${cardY + 22}" width="${cardW - 44}" height="${cardH - 44}" fill="none" stroke="${pal.goldDim}" stroke-width="1"/>`,
  );

  // Corner diamonds.
  const cornerR = 9;
  const corners = [
    [cardX + 30, cardY + 30],
    [cardX + cardW - 30, cardY + 30],
    [cardX + 30, cardY + cardH - 30],
    [cardX + cardW - 30, cardY + cardH - 30],
  ];
  for (const [x, y] of corners) {
    parts.push(
      `<path d="M ${x} ${y - cornerR} L ${x + cornerR} ${y} L ${x} ${y + cornerR} L ${x - cornerR} ${y} Z" fill="${pal.card}" stroke="${pal.gold}" stroke-width="1.6"/>`,
    );
    parts.push(`<circle cx="${x}" cy="${y}" r="2" fill="${pal.gold}"/>`);
  }

  // Roman-numeral medallion.
  const medY = cardY + 74;
  parts.push(
    `<circle cx="${cx}" cy="${medY}" r="30" fill="${pal.card}" stroke="${pal.gold}" stroke-width="2.2"/>`,
  );
  parts.push(
    `<circle cx="${cx}" cy="${medY}" r="23" fill="none" stroke="${pal.goldDim}" stroke-width="1"/>`,
  );
  // Scale numeral font for long numerals (XVIII fits awkwardly).
  const numFontSize = arcana.numeral.length >= 5 ? 16 : arcana.numeral.length >= 4 ? 19 : 22;
  parts.push(
    `<text x="${cx}" y="${(medY + 7).toFixed(1)}" fill="${pal.gold}" font-family="Georgia, 'Times New Roman', serif" font-size="${numFontSize}" font-weight="bold" text-anchor="middle" letter-spacing="1">${arcana.numeral}</text>`,
  );

  // Slug: "XVIII · THE MOON" under the medallion.
  parts.push(
    `<text x="${cx}" y="${(medY + 50).toFixed(1)}" fill="${pal.goldDim}" font-family="Georgia, 'Times New Roman', serif" font-size="13" letter-spacing="4" text-anchor="middle">${arcana.numeral} · ${arcana.name}</text>`,
  );

  // Central pictogram — upper half of the card, above the horizon.
  const pictoSize = cardW * 0.44;
  const pictoCy = cardY + 310;
  parts.push(drawPictogram(picto, cx, pictoCy, pictoSize, pal, rng));

  // Horizon band — thin strip tucked beneath the glyph, suggests ground
  // without cutting through the figure.
  const hX = cardX + 80;
  const hY = cardY + 460;
  const hW = cardW - 160;
  const hH = 86;
  parts.push(drawHorizon(horizon, hX, hY, hW, hH, pal, rng));

  // Divider flourishes above keyword.
  const divW = cardW * 0.48;
  const divLowerY = cardY + cardH - 162;
  parts.push(
    `<line x1="${(cx - divW / 2).toFixed(1)}" y1="${divLowerY}" x2="${(cx + divW / 2).toFixed(1)}" y2="${divLowerY}" stroke="${pal.goldDim}" stroke-width="1"/>`,
  );
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${divLowerY}" r="3" fill="${pal.gold}"/>`);
  parts.push(`<circle cx="${(cx - divW / 2).toFixed(1)}" cy="${divLowerY}" r="2" fill="${pal.gold}"/>`);
  parts.push(`<circle cx="${(cx + divW / 2).toFixed(1)}" cy="${divLowerY}" r="2" fill="${pal.gold}"/>`);

  // Keyword ribbon under the glyph.
  parts.push(
    `<text x="${cx}" y="${(divLowerY + 30).toFixed(1)}" fill="${pal.goldDim}" font-family="ui-monospace, 'SF Mono', Menlo, monospace" font-size="13" letter-spacing="8" text-anchor="middle">${keyword}</text>`,
  );

  // Name banner at the bottom.
  const banner = bannerTitle(title);
  const bannerH = 56;
  const bannerY = cardY + cardH - 86;
  parts.push(
    `<rect x="${(cardX + 56).toFixed(1)}" y="${bannerY}" width="${(cardW - 112).toFixed(1)}" height="${bannerH}" fill="${pal.card}" stroke="${pal.gold}" stroke-width="1.4"/>`,
  );
  parts.push(
    `<rect x="${(cardX + 62).toFixed(1)}" y="${bannerY + 6}" width="${(cardW - 124).toFixed(1)}" height="${bannerH - 12}" fill="none" stroke="${pal.goldDim}" stroke-width="0.8"/>`,
  );
  parts.push(
    `<text x="${cx}" y="${(bannerY + bannerH / 2 + 9).toFixed(1)}" fill="${pal.ivory}" font-family="Georgia, 'Times New Roman', serif" font-size="26" font-style="italic" text-anchor="middle" letter-spacing="3">${escapeXml(banner)}</text>`,
  );

  // Subtle hatching shadow under the glyph so it doesn't float — small rect
  // of hatching clipped to a narrow strip.
  parts.push(
    `<g clip-path="inset(0 0 0 0)">` +
    hatch(cx, hY + hH * 0.88, cardW * 0.5, 16, 0, 4, pal.hatch, 0.25) +
    `</g>`,
  );

  return parts.join("");
}
