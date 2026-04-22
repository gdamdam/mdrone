import type { ShareCardContext } from "../svgBuilder";
import type { PitchClass } from "../../types";
import { rngPick } from "../rng";

/**
 * Talisman — procedural illumination card, square (800×800).
 *
 * Architecture:
 *  1. A ritual circular knotwork border — two counter-phase sinusoidal
 *     curves around a circle that weave through each other. The number of
 *     lobes is derived from the hash, so the outer pattern varies per scene.
 *  2. A central n-fold radial emblem (n = 3..8 from hash). Three nested
 *     rings of generated micro-glyphs (dots, pips, star-bursts, rune ticks)
 *     orbit a small inner sigil.
 *  3. Four elemental corner marginalia — fire / water / earth / air —
 *     assigned from climateX, climateY and active voice layers.
 *  4. Small title ribbon at the bottom of the card.
 *
 * Per-pitch-class mineral palette in the same register as tessera so the
 * family reads as one world.
 *
 * All randomness flows through ctx.rng. No Math.random.
 */

/* ─── Palette ──────────────────────────────────────────────────────────── */

type Palette = {
  bg: string;
  card: string;
  ink: string;
  accent: string;
  text: string;
  wash: string;
};

const PALETTES: Record<PitchClass, Palette> = {
  C:    { bg: "#0a0806", card: "#13100a", wash: "#1a140c", ink: "#6a4a28", accent: "#c89838", text: "#d8b878" },
  "C#": { bg: "#050a0c", card: "#0d1418", wash: "#121a20", ink: "#365058", accent: "#6ab0b8", text: "#a8cdd2" },
  D:    { bg: "#080a06", card: "#101810", wash: "#161a12", ink: "#3c5028", accent: "#8ab04a", text: "#c0ce96" },
  "D#": { bg: "#0a0606", card: "#180c0c", wash: "#1a1010", ink: "#6a3030", accent: "#c86050", text: "#d8a090" },
  E:    { bg: "#06070c", card: "#0e1020", wash: "#121520", ink: "#384068", accent: "#6878b8", text: "#a0acd0" },
  F:    { bg: "#0a0805", card: "#14100a", wash: "#1a140c", ink: "#5a4218", accent: "#b89028", text: "#d0b470" },
  "F#": { bg: "#060a08", card: "#0e1612", wash: "#131d18", ink: "#2e5a48", accent: "#4aa080", text: "#9ec8b4" },
  G:    { bg: "#080608", card: "#120e14", wash: "#1a141e", ink: "#604068", accent: "#a86ab8", text: "#c898d4" },
  "G#": { bg: "#06060a", card: "#0e0e18", wash: "#141422", ink: "#2c3058", accent: "#5a68a0", text: "#a0a8c8" },
  A:    { bg: "#0a0604", card: "#180c06", wash: "#20120a", ink: "#703a18", accent: "#d07828", text: "#d8b078" },
  "A#": { bg: "#060808", card: "#0c1212", wash: "#121818", ink: "#304850", accent: "#60a0a8", text: "#a0c8cc" },
  B:    { bg: "#06060a", card: "#100c14", wash: "#161218", ink: "#402858", accent: "#7848a8", text: "#a888c8" },
};

/* ─── Knotwork border ──────────────────────────────────────────────────── */

/** Two counter-phase sine-wobbled circles. Lobes = number of bulges around
 *  the ring. At each crossing we drop a small "over" dot so the weave reads. */
function drawKnotwork(
  cx: number,
  cy: number,
  rBase: number,
  lobes: number,
  pal: Palette,
): string {
  const amp = 10;
  const steps = 360;
  const ptsA: string[] = [];
  const ptsB: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const rA = rBase + Math.sin(t * lobes) * amp;
    const rB = rBase + Math.sin(t * lobes + Math.PI) * amp;
    ptsA.push(`${i === 0 ? "M" : "L"} ${(cx + Math.cos(t) * rA).toFixed(1)} ${(cy + Math.sin(t) * rA).toFixed(1)}`);
    ptsB.push(`${i === 0 ? "M" : "L"} ${(cx + Math.cos(t) * rB).toFixed(1)} ${(cy + Math.sin(t) * rB).toFixed(1)}`);
  }
  // Crossings happen at every half-lobe.
  const crosses: string[] = [];
  for (let k = 0; k < lobes * 2; k++) {
    const t = ((k + 0.5) / (lobes * 2)) * Math.PI * 2;
    const xx = cx + Math.cos(t) * rBase;
    const yy = cy + Math.sin(t) * rBase;
    crosses.push(`<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="3.2" fill="${pal.accent}" stroke="${pal.bg}" stroke-width="1"/>`);
  }
  return (
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${ptsA.join(" ")}" stroke="${pal.ink}" stroke-width="2.4" stroke-opacity="0.9"/>` +
    `<path d="${ptsB.join(" ")}" stroke="${pal.accent}" stroke-width="2.4" stroke-opacity="0.9"/>` +
    crosses.join("") +
    `</g>`
  );
}

/* ─── Micro-glyph vocabulary for the orbit rings ───────────────────────── */

type Micro = "dot" | "pip" | "burst" | "tick" | "cross" | "diamond";

function drawMicro(
  kind: Micro,
  x: number,
  y: number,
  r: number,
  angle: number,
  pal: Palette,
): string {
  switch (kind) {
    case "dot":
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.45).toFixed(1)}" fill="${pal.accent}"/>`;
    case "pip":
      return (
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${pal.accent}" stroke-width="1.4"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.3).toFixed(1)}" fill="${pal.accent}"/>`
      );
    case "burst": {
      const rays: string[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        rays.push(
          `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(a) * r).toFixed(1)}" y2="${(y + Math.sin(a) * r).toFixed(1)}" stroke="${pal.accent}" stroke-width="1.2"/>`,
        );
      }
      return `<g>${rays.join("")}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${pal.accent}"/></g>`;
    }
    case "tick": {
      const dx = Math.cos(angle) * r;
      const dy = Math.sin(angle) * r;
      return `<line x1="${(x - dx).toFixed(1)}" y1="${(y - dy).toFixed(1)}" x2="${(x + dx).toFixed(1)}" y2="${(y + dy).toFixed(1)}" stroke="${pal.ink}" stroke-width="1.8" stroke-linecap="round"/>`;
    }
    case "cross": {
      const dx = Math.cos(angle) * r;
      const dy = Math.sin(angle) * r;
      return (
        `<line x1="${(x - dx).toFixed(1)}" y1="${(y - dy).toFixed(1)}" x2="${(x + dx).toFixed(1)}" y2="${(y + dy).toFixed(1)}" stroke="${pal.accent}" stroke-width="1.4"/>` +
        `<line x1="${(x - dy).toFixed(1)}" y1="${(y + dx).toFixed(1)}" x2="${(x + dy).toFixed(1)}" y2="${(y - dx).toFixed(1)}" stroke="${pal.accent}" stroke-width="1.4"/>`
      );
    }
    case "diamond":
      return `<polygon points="${x},${(y - r).toFixed(1)} ${(x + r).toFixed(1)},${y} ${x},${(y + r).toFixed(1)} ${(x - r).toFixed(1)},${y}" fill="${pal.card}" stroke="${pal.ink}" stroke-width="1.4"/>`;
  }
}

/* ─── Central radial emblem ────────────────────────────────────────────── */

function drawEmblem(
  cx: number,
  cy: number,
  rOuter: number,
  nFold: number,
  pal: Palette,
  rng: () => number,
): string {
  const parts: string[] = [];
  const MICROS: readonly Micro[] = ["dot", "pip", "burst", "tick", "cross", "diamond"];
  const ring1 = rOuter * 0.92;      // outer orbit
  const ring2 = rOuter * 0.66;      // middle orbit
  const ring3 = rOuter * 0.38;      // inner band
  const coreR = rOuter * 0.16;

  // Concentric rings (thin guides).
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${ring1.toFixed(1)}" fill="none" stroke="${pal.ink}" stroke-width="1"/>`);
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${ring2.toFixed(1)}" fill="none" stroke="${pal.ink}" stroke-width="1" stroke-opacity="0.7"/>`);
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${ring3.toFixed(1)}" fill="none" stroke="${pal.accent}" stroke-width="1.4"/>`);

  // Outer orbit: n glyphs
  const microOuter = rngPick(rng, MICROS);
  for (let i = 0; i < nFold; i++) {
    const a = (i / nFold) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * ring1;
    const y = cy + Math.sin(a) * ring1;
    parts.push(drawMicro(microOuter, x, y, 9, a + Math.PI / 2, pal));
  }

  // Middle orbit: 2n smaller glyphs
  const microMiddle = rngPick(rng, MICROS);
  const n2 = nFold * 2;
  for (let i = 0; i < n2; i++) {
    const a = (i / n2) * Math.PI * 2;
    const x = cx + Math.cos(a) * ring2;
    const y = cy + Math.sin(a) * ring2;
    parts.push(drawMicro(microMiddle, x, y, 6, a + Math.PI / 2, pal));
  }

  // Radial spokes from ring3 to core.
  for (let i = 0; i < nFold; i++) {
    const a = (i / nFold) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(a) * ring3;
    const y1 = cy + Math.sin(a) * ring3;
    const x2 = cx + Math.cos(a) * coreR;
    const y2 = cy + Math.sin(a) * coreR;
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${pal.accent}" stroke-width="1.6" stroke-linecap="round"/>`,
    );
  }

  // Core — n-fold petal shape.
  const petal: string[] = [];
  const petalSteps = nFold * 2;
  for (let i = 0; i <= petalSteps * 3; i++) {
    const t = (i / (petalSteps * 3)) * Math.PI * 2;
    const r = coreR * (0.55 + 0.45 * Math.abs(Math.cos(t * nFold / 2)));
    petal.push(`${i === 0 ? "M" : "L"} ${(cx + Math.cos(t) * r).toFixed(1)} ${(cy + Math.sin(t) * r).toFixed(1)}`);
  }
  parts.push(`<path d="${petal.join(" ")}" fill="${pal.accent}" stroke="${pal.ink}" stroke-width="1" stroke-linejoin="round"/>`);
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(coreR * 0.3).toFixed(1)}" fill="${pal.card}" stroke="${pal.ink}" stroke-width="1"/>`);

  // Decorative arc segments between outer orbit points (chord pattern).
  const chords: string[] = [];
  for (let i = 0; i < nFold; i++) {
    const a1 = (i / nFold) * Math.PI * 2 - Math.PI / 2;
    const a2 = ((i + 2) / nFold) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(a1) * ring1;
    const y1 = cy + Math.sin(a1) * ring1;
    const x2 = cx + Math.cos(a2) * ring1;
    const y2 = cy + Math.sin(a2) * ring1;
    chords.push(
      `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${pal.ink}" stroke-width="0.8" stroke-opacity="0.35"/>`,
    );
  }
  parts.push(chords.join(""));

  return `<g>${parts.join("")}</g>`;
}

/* ─── Elemental corner marginalia ──────────────────────────────────────── */

type Element = "fire" | "water" | "earth" | "air";

function drawElement(el: Element, cx: number, cy: number, size: number, pal: Palette): string {
  const s = size / 2;
  switch (el) {
    case "fire":
      return (
        `<g stroke="${pal.accent}" stroke-width="2" fill="none" stroke-linejoin="round">` +
        `<polygon points="${cx},${(cy - s).toFixed(1)} ${(cx + s).toFixed(1)},${(cy + s).toFixed(1)} ${(cx - s).toFixed(1)},${(cy + s).toFixed(1)}"/>` +
        `</g>`
      );
    case "water":
      return (
        `<g stroke="${pal.accent}" stroke-width="2" fill="none" stroke-linejoin="round">` +
        `<polygon points="${cx},${(cy + s).toFixed(1)} ${(cx + s).toFixed(1)},${(cy - s).toFixed(1)} ${(cx - s).toFixed(1)},${(cy - s).toFixed(1)}"/>` +
        `</g>`
      );
    case "earth":
      return (
        `<g stroke="${pal.accent}" stroke-width="2" fill="none" stroke-linejoin="round">` +
        `<polygon points="${cx},${(cy + s).toFixed(1)} ${(cx + s).toFixed(1)},${(cy - s).toFixed(1)} ${(cx - s).toFixed(1)},${(cy - s).toFixed(1)}"/>` +
        `<line x1="${(cx - s * 0.6).toFixed(1)}" y1="${(cy - s * 0.05).toFixed(1)}" x2="${(cx + s * 0.6).toFixed(1)}" y2="${(cy - s * 0.05).toFixed(1)}"/>` +
        `</g>`
      );
    case "air":
      return (
        `<g stroke="${pal.accent}" stroke-width="2" fill="none" stroke-linejoin="round">` +
        `<polygon points="${cx},${(cy - s).toFixed(1)} ${(cx + s).toFixed(1)},${(cy + s).toFixed(1)} ${(cx - s).toFixed(1)},${(cy + s).toFixed(1)}"/>` +
        `<line x1="${(cx - s * 0.6).toFixed(1)}" y1="${(cy + s * 0.05).toFixed(1)}" x2="${(cx + s * 0.6).toFixed(1)}" y2="${(cy + s * 0.05).toFixed(1)}"/>` +
        `</g>`
      );
  }
}

/** Four corners: which element goes where depends on climate + voice.
 *  Returns corner order TL, TR, BL, BR. */
function cornerElements(
  bright: boolean,
  moving: boolean,
  hasTanpura: boolean,
  hasAmp: boolean,
): [Element, Element, Element, Element] {
  // The primary element reflects dominant character.
  let primary: Element;
  if (hasAmp) primary = bright ? "fire" : "earth";
  else if (hasTanpura) primary = bright ? "air" : "water";
  else primary = moving ? "air" : "earth";

  const wheel: Element[] = ["fire", "air", "water", "earth"];
  const start = wheel.indexOf(primary);
  return [
    wheel[start % 4],
    wheel[(start + 1) % 4],
    wheel[(start + 3) % 4],
    wheel[(start + 2) % 4],
  ];
}

/* ─── Text helpers ─────────────────────────────────────────────────────── */

function ribbonTitle(s: string): string {
  const t = (s || "TALISMAN").toUpperCase().trim();
  if (t.length <= 22) return t;
  return t.slice(0, 21) + "…";
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

/* ─── Entry point ──────────────────────────────────────────────────────── */

export function buildTalismanSvg(ctx: ShareCardContext): string {
  const { width, height, rng, hash, title } = ctx;
  const drone = ctx.scene.drone;
  const pal = PALETTES[drone.root as PitchClass] ?? PALETTES.C;

  const hasTanpura = !!drone.voiceLayers.tanpura;
  const hasAmp = !!drone.voiceLayers.amp;
  const bright = drone.climateX > 0.5;
  const moving = drone.climateY > 0.4;

  const cx = width / 2;
  const cy = height / 2;

  const parts: string[] = [];

  // Background.
  parts.push(`<rect width="${width}" height="${height}" fill="${pal.bg}"/>`);

  // Inner circular wash — slightly brighter disc behind the emblem.
  parts.push(
    `<defs><radialGradient id="talWash-${hash.toString(36)}" cx="50%" cy="50%" r="50%">` +
      `<stop offset="0%" stop-color="${pal.wash}" stop-opacity="1"/>` +
      `<stop offset="100%" stop-color="${pal.card}" stop-opacity="1"/>` +
      `</radialGradient></defs>`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="url(#talWash-${hash.toString(36)})" opacity="0.9"/>`);

  // Outer frame — double thin border.
  parts.push(`<rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="${pal.ink}" stroke-width="2"/>`);
  parts.push(`<rect x="30" y="30" width="${width - 60}" height="${height - 60}" fill="none" stroke="${pal.ink}" stroke-width="0.8" stroke-opacity="0.6"/>`);

  // Knotwork border ring.
  const rOuter = Math.min(width, height) * 0.42;
  const lobes = 6 + (hash % 7); // 6..12
  parts.push(drawKnotwork(cx, cy, rOuter, lobes, pal));

  // Elemental corner marginalia.
  const corners: [Element, Element, Element, Element] = cornerElements(bright, moving, hasTanpura, hasAmp);
  const cornerPad = 66;
  const cornerSize = 40;
  const cornerPts: Array<[number, number]> = [
    [cornerPad, cornerPad],
    [width - cornerPad, cornerPad],
    [cornerPad, height - cornerPad],
    [width - cornerPad, height - cornerPad],
  ];
  for (let i = 0; i < 4; i++) {
    const [x, y] = cornerPts[i];
    parts.push(`<circle cx="${x}" cy="${y}" r="${(cornerSize / 2 + 8).toFixed(1)}" fill="none" stroke="${pal.ink}" stroke-width="1"/>`);
    parts.push(drawElement(corners[i], x, y, cornerSize, pal));
  }

  // Central radial emblem.
  const nFold = 3 + (hash % 6); // 3..8
  const rEmblem = rOuter * 0.78;
  parts.push(drawEmblem(cx, cy, rEmblem, nFold, pal, rng));

  // Title ribbon at bottom.
  const ribbonY = height - 56;
  const ribbonW = width * 0.56;
  parts.push(
    `<rect x="${((width - ribbonW) / 2).toFixed(1)}" y="${(ribbonY - 20).toFixed(1)}" width="${ribbonW.toFixed(1)}" height="40" fill="${pal.card}" stroke="${pal.ink}" stroke-width="1.2"/>`,
  );
  parts.push(
    `<text x="${cx}" y="${(ribbonY + 6).toFixed(1)}" fill="${pal.text}" font-family="Georgia, 'Times New Roman', serif" font-size="20" text-anchor="middle" letter-spacing="4" font-style="italic">${escapeXml(ribbonTitle(title))}</text>`,
  );

  // Tiny top legend — n-fold and lobe count signal as short glyph line.
  parts.push(
    `<text x="${cx}" y="56" fill="${pal.ink}" font-family="ui-monospace, 'SF Mono', Menlo, monospace" font-size="11" text-anchor="middle" letter-spacing="6">· ${nFold}·${lobes} ·</text>`,
  );

  return parts.join("");
}
