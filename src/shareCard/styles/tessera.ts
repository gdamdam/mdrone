import type { ShareCardContext } from "../svgBuilder";
import type { PitchClass } from "../../types";
import { rngPick, rngRange } from "../rng";

/**
 * Tessera — nested-cell mosaic style. (Formerly "fractal".)
 *
 * Architecture:
 *  1. Pick a 2-colour mineral palette from the scene's tonic pitch class
 *     (no rainbow — all 12 palettes stay in the dark/warm/earth spectrum).
 *  2. Recursively subdivide the canvas into a quadtree. Stop probability
 *     rises with depth, so some branches terminate early and leave big
 *     motifs while others drill down to tiny detail.
 *  3. At every leaf cell, draw one of seven stroked motifs chosen by RNG.
 *  4. Outer double-frame + small title chip at the bottom.
 *
 * All randomness flows through ctx.rng, so identical payloads produce
 * byte-identical SVG. No Math.random in this file.
 */

type Palette = {
  /** Background rectangle fill. */
  bg: string;
  /** Inner vignette / subtle wash overlay. */
  wash: string;
  /** Primary stroke colour (darker, warmer). */
  ink: string;
  /** Secondary stroke colour (brighter accent). */
  accent: string;
  /** Text colour for title chip. */
  text: string;
};

/** 12 palettes, one per pitch class. Deliberately muted + mineral. */
const PALETTES: Record<PitchClass, Palette> = {
  C:    { bg: "#0e0a08", wash: "#1a120a", ink: "#6a4a28", accent: "#c8953a", text: "#d8b878" },
  "C#": { bg: "#0a0d0e", wash: "#101618", ink: "#365058", accent: "#6ab0b8", text: "#a8cdd2" },
  D:    { bg: "#0c0e0a", wash: "#161a12", ink: "#3c5028", accent: "#8ab04a", text: "#c0ce96" },
  "D#": { bg: "#100a0a", wash: "#1a1010", ink: "#6a3030", accent: "#c86050", text: "#d8a090" },
  E:    { bg: "#0a0b10", wash: "#121520", ink: "#384068", accent: "#6878b8", text: "#a0acd0" },
  F:    { bg: "#0e0c08", wash: "#1a140c", ink: "#5a4218", accent: "#b89028", text: "#d0b470" },
  "F#": { bg: "#0a0e0c", wash: "#121a16", ink: "#2c5848", accent: "#58a888", text: "#98c8b0" },
  G:    { bg: "#0c0a0e", wash: "#18121c", ink: "#503068", accent: "#9058b8", text: "#b898d0" },
  "G#": { bg: "#0e0a0c", wash: "#1a1016", ink: "#683848", accent: "#b86078", text: "#d098a8" },
  A:    { bg: "#0e0c0a", wash: "#1c1810", ink: "#5a4020", accent: "#c88838", text: "#d8b078" },
  "A#": { bg: "#0a0c0c", wash: "#121818", ink: "#304850", accent: "#60a0a8", text: "#a0c8cc" },
  B:    { bg: "#0c0a0c", wash: "#161218", ink: "#402858", accent: "#7848a8", text: "#a888c8" },
};

const MOTIFS = ["circle", "square", "diamond", "cross", "nest", "arc", "triLine"] as const;
type Motif = (typeof MOTIFS)[number];

/** Stopping probability rises with depth. Small cells almost always stop. */
function stopProb(depth: number): number {
  if (depth === 0) return 0;
  if (depth === 1) return 0.1;
  if (depth === 2) return 0.35;
  if (depth === 3) return 0.6;
  if (depth === 4) return 0.85;
  return 1;
}

/** Draw one motif inside a cell, returns SVG fragment. */
function drawMotif(
  motif: Motif,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  ink: string,
  accent: string,
  rng: () => number,
): string {
  const pad = Math.min(w, h) * 0.12;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2 - pad;
  // Alternate colours by depth parity plus a coin flip so nearby cells
  // don't all match.
  const useAccent = depth % 2 === 0 ? rng() < 0.55 : rng() < 0.35;
  const stroke = useAccent ? accent : ink;
  // Stroke weight thins with depth but stays crisp.
  const sw = Math.max(0.8, 3.2 - depth * 0.55);

  switch (motif) {
    case "circle": {
      return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="${sw.toFixed(2)}"/>`;
    }
    case "square": {
      return `<rect x="${(cx - r).toFixed(2)}" y="${(cy - r).toFixed(2)}" width="${(r * 2).toFixed(2)}" height="${(r * 2).toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="${sw.toFixed(2)}"/>`;
    }
    case "diamond": {
      const d = `M ${cx.toFixed(2)} ${(cy - r).toFixed(2)} L ${(cx + r).toFixed(2)} ${cy.toFixed(2)} L ${cx.toFixed(2)} ${(cy + r).toFixed(2)} L ${(cx - r).toFixed(2)} ${cy.toFixed(2)} Z`;
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw.toFixed(2)}"/>`;
    }
    case "cross": {
      return `<g stroke="${stroke}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round">` +
        `<line x1="${(cx - r).toFixed(2)}" y1="${cy.toFixed(2)}" x2="${(cx + r).toFixed(2)}" y2="${cy.toFixed(2)}"/>` +
        `<line x1="${cx.toFixed(2)}" y1="${(cy - r).toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(cy + r).toFixed(2)}"/>` +
        `</g>`;
    }
    case "nest": {
      // Three nested concentric squares — a mini-fractal inside the cell.
      const sizes = [r, r * 0.66, r * 0.33];
      return sizes
        .map(
          (s, i) =>
            `<rect x="${(cx - s).toFixed(2)}" y="${(cy - s).toFixed(2)}" width="${(s * 2).toFixed(2)}" height="${(s * 2).toFixed(2)}" fill="none" stroke="${i === 1 ? accent : ink}" stroke-width="${sw.toFixed(2)}"/>`,
        )
        .join("");
    }
    case "arc": {
      // Quarter-arc in a rotation chosen by RNG — gives directional variety.
      const rotations = [0, 90, 180, 270];
      const rot = rngPick(rng, rotations);
      const start = `${(cx - r).toFixed(2)},${cy.toFixed(2)}`;
      const end = `${cx.toFixed(2)},${(cy - r).toFixed(2)}`;
      return `<path d="M ${start} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${end}" fill="none" stroke="${stroke}" stroke-width="${sw.toFixed(2)}" transform="rotate(${rot} ${cx.toFixed(2)} ${cy.toFixed(2)})" stroke-linecap="round"/>`;
    }
    case "triLine": {
      // Three parallel lines across the cell.
      const dx = r * 0.55;
      return `<g stroke="${stroke}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round">` +
        `<line x1="${(cx - r).toFixed(2)}" y1="${(cy - dx).toFixed(2)}" x2="${(cx + r).toFixed(2)}" y2="${(cy - dx).toFixed(2)}"/>` +
        `<line x1="${(cx - r).toFixed(2)}" y1="${cy.toFixed(2)}" x2="${(cx + r).toFixed(2)}" y2="${cy.toFixed(2)}"/>` +
        `<line x1="${(cx - r).toFixed(2)}" y1="${(cy + dx).toFixed(2)}" x2="${(cx + r).toFixed(2)}" y2="${(cy + dx).toFixed(2)}"/>` +
        `</g>`;
    }
  }
}

/**
 * Recursive quadtree subdivision. Fills `out` with SVG strings.
 * Depth 0 = whole canvas, each level divides into 2×2.
 */
function subdivide(
  out: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  rng: () => number,
  palette: Palette,
): void {
  if (rng() < stopProb(depth) || w < 60 || h < 60) {
    const motif = rngPick(rng, MOTIFS);
    out.push(drawMotif(motif, x, y, w, h, depth, palette.ink, palette.accent, rng));
    return;
  }
  // Occasionally split into 2 horizontal or 2 vertical slices instead of
  // 2×2, for compositional variety. Decided by RNG.
  const splitRoll = rng();
  if (splitRoll < 0.7) {
    const hw = w / 2;
    const hh = h / 2;
    subdivide(out, x, y, hw, hh, depth + 1, rng, palette);
    subdivide(out, x + hw, y, hw, hh, depth + 1, rng, palette);
    subdivide(out, x, y + hh, hw, hh, depth + 1, rng, palette);
    subdivide(out, x + hw, y + hh, hw, hh, depth + 1, rng, palette);
  } else if (splitRoll < 0.85) {
    const hw = w / 2;
    subdivide(out, x, y, hw, h, depth + 1, rng, palette);
    subdivide(out, x + hw, y, hw, h, depth + 1, rng, palette);
  } else {
    const hh = h / 2;
    subdivide(out, x, y, w, hh, depth + 1, rng, palette);
    subdivide(out, x, y + hh, w, hh, depth + 1, rng, palette);
  }
}

export function buildTesseraSvg(ctx: ShareCardContext): string {
  const { width, height, rng, scene, title } = ctx;
  const root = scene.drone.root as PitchClass;
  const palette = PALETTES[root] ?? PALETTES.A;

  // Composition: outer margin keeps frame clean, inner area is fractalised.
  const margin = 52;
  const inner = {
    x: margin,
    y: margin,
    w: width - margin * 2,
    h: height - margin * 2,
  };

  const parts: string[] = [];

  // Background + wash.
  parts.push(`<rect width="${width}" height="${height}" fill="${palette.bg}"/>`);
  // Subtle radial wash — deterministic, no RNG; just depends on palette.
  parts.push(
    `<defs><radialGradient id="wash" cx="50%" cy="50%" r="60%">` +
      `<stop offset="0%" stop-color="${palette.wash}" stop-opacity="0.9"/>` +
      `<stop offset="100%" stop-color="${palette.bg}" stop-opacity="0"/>` +
      `</radialGradient></defs>`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="url(#wash)"/>`);

  // Fractal content.
  subdivide(parts, inner.x, inner.y, inner.w, inner.h, 0, rng, palette);

  // Cymatics overlay — a Chladni-inspired polar pattern derived from
  // the drone's voice layers and climate. The number of active voices
  // determines the modal symmetry; climate position warps the pattern.
  const cx = width / 2;
  const cy = height / 2;
  const cyR = Math.min(inner.w, inner.h) * 0.35;
  const voices = Object.entries(scene.drone.voiceLayers).filter(([, on]) => on);
  const modes = Math.max(3, voices.length + 1); // symmetry order
  const warp = 0.6 + scene.drone.climateX * 0.8; // radial warp from brightness
  const cyPts: string[] = [];
  const steps = 180;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 2;
    // Chladni-like function: r = R * |cos(m*θ) + warp*sin(n*θ)|
    const m = modes;
    const n = modes + 1;
    const r = cyR * (0.3 + 0.7 * Math.abs(
      Math.cos(m * angle) * warp + Math.sin(n * angle) * (1 - warp * 0.3)
    ));
    cyPts.push(`${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`);
  }
  parts.push(
    `<polygon points="${cyPts.join(" ")}" fill="none" stroke="${palette.accent}" stroke-width="1.2" stroke-opacity="0.4"/>`,
  );
  // Second harmonic at half amplitude
  const cyPts2: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 2;
    const r = cyR * 0.6 * (0.3 + 0.7 * Math.abs(
      Math.cos((modes + 2) * angle) * (1 - warp * 0.2) + Math.sin(modes * angle) * warp * 0.5
    ));
    cyPts2.push(`${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`);
  }
  parts.push(
    `<polygon points="${cyPts2.join(" ")}" fill="none" stroke="${palette.ink}" stroke-width="0.8" stroke-opacity="0.3"/>`,
  );
  // Centre dot
  parts.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${palette.accent}" fill-opacity="0.5"/>`);

  // Outer double frame.
  parts.push(
    `<rect x="${margin - 10}" y="${margin - 10}" width="${width - (margin - 10) * 2}" height="${height - (margin - 10) * 2}" fill="none" stroke="${palette.ink}" stroke-width="1.5"/>`,
  );
  parts.push(
    `<rect x="${margin - 18}" y="${margin - 18}" width="${width - (margin - 18) * 2}" height="${height - (margin - 18) * 2}" fill="none" stroke="${palette.accent}" stroke-width="0.8" stroke-opacity="0.55"/>`,
  );

  // Title chip — bottom-left, minimal.
  const chipText = (title || "UNTITLED").toUpperCase().slice(0, 40);
  const chipY = height - margin + 2;
  parts.push(
    `<text x="${margin - 4}" y="${chipY}" fill="${palette.text}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="14" letter-spacing="2">${escapeXml(chipText)}</text>`,
  );

  // Tonic marker — bottom-right, matches chip baseline.
  parts.push(
    `<text x="${width - margin + 4}" y="${chipY}" fill="${palette.accent}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="14" letter-spacing="2" text-anchor="end">${root}${scene.drone.octave}</text>`,
  );

  // Use rngRange to keep the lint happy — could seed a future variation.
  void rngRange;

  return parts.join("");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (ch) => {
    switch (ch) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      default: return ch;
    }
  });
}
