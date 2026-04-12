import type { ShareCardContext } from "../svgBuilder";
import { rngRange } from "../rng";

/**
 * Austin Osman Spare — style sigil.
 *
 * The construction method follows Spare's own:
 *   1. Take a "statement of desire". Here that's derived from the scene:
 *      preset id + root + scale + octave, uppercased, letters only.
 *   2. Strip duplicate letters ("sigilisation of the letters of desire"),
 *      leaving a shorter unique set.
 *   3. Place each surviving letter at a point on the drawing field.
 *      Spare himself used intuition; we use a deterministic polar layout
 *      where the letter's alphabet index becomes its angle, with a little
 *      RNG jitter so the composition doesn't feel mechanical.
 *   4. Join the points with a single continuous curve — quadratic Béziers
 *      with RNG-jittered control points for organic flow. Close the loop.
 *   5. Place small ink dots at each vertex, wrap the whole thing in a
 *      magical-circle boundary, and add ritual corner marks.
 *
 * All randomness flows through ctx.rng — same scene produces the same
 * sigil on client and worker.
 */

/** Warm-ink parchment palette, shared by every scene (the "aesthetic"
 *  is Spare's; palette variation would dilute it). */
const PALETTE = {
  bg: "#0a0806",
  wash: "#1a100a",
  parchment: "#1c140a",
  ink: "#e8cc78",
  inkDim: "#a88a44",
  boundary: "#6a4a20",
  text: "#d8b060",
};

/** Extract A–Z only, uppercased. */
function lettersOnly(s: string): string {
  return s.toUpperCase().replace(/[^A-Z]/g, "");
}

/** Spare's sigilisation: strip duplicate letters, keeping first occurrence. */
function uniqueLetters(s: string): string {
  const seen = new Set<string>();
  let out = "";
  for (const ch of s) {
    if (!seen.has(ch)) {
      seen.add(ch);
      out += ch;
    }
  }
  return out;
}

/** Build the statement of desire from the scene. */
function desirePhrase(scene: ShareCardContext["scene"], title: string): string {
  const preset = scene.drone.activePresetId ?? "DRONE";
  const voice = Object.entries(scene.drone.voiceLayers)
    .filter(([, on]) => on)
    .map(([id]) => id)
    .join("");
  const raw = `${title}${preset}${scene.drone.root}${scene.drone.scale}${voice}`;
  return lettersOnly(raw);
}

interface Pt {
  x: number;
  y: number;
  letter: string;
}

/** Place nodes on a jittered polar ring — same algorithm as the
 *  canvas visualizer sigil (visualizers.ts:makeSigil). */
function layoutNodes(
  count: number,
  cx: number,
  cy: number,
  radius: number,
  rng: () => number,
): Pt[] {
  const nodes: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rngRange(rng, -0.4, 0.4);
    const r = radius * (0.35 + rng() * 0.55);
    nodes.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r, letter: "" });
  }
  return nodes;
}

/** Build Spare-style sigil: geometric, angular, architectural.
 *  Straight lines, triangles, crossbars, arrows, small circles
 *  at intersections. Random traversal with knot crossings. */
function buildSigilPath(
  nodes: Pt[],
  cx: number,
  cy: number,
  radius: number,
  rng: () => number,
): string {
  if (nodes.length === 0) return "";
  const n = nodes.length;

  // Random traversal order (Fisher-Yates)
  const order: number[] = [];
  const indices = nodes.map((_, i) => i);
  while (indices.length) {
    const k = Math.floor(rng() * indices.length);
    order.push(indices.splice(k, 1)[0]);
  }
  order.push(order[0]);

  // Inject 2-3 revisits for knot crossings
  const knots = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < knots; i++) {
    const pos = 2 + Math.floor(rng() * Math.max(1, order.length - 3));
    const rev = Math.floor(rng() * n);
    order.splice(pos, 0, rev);
  }

  const cmds: string[] = [];
  const mainPath: string[] = [];
  const decorations: string[] = [];
  const first = nodes[order[0]];
  mainPath.push(`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`);

  for (let i = 0; i < order.length - 1; i++) {
    const a = nodes[order[i]];
    const b = nodes[order[i + 1]];
    const choice = rng();

    if (choice < 0.6) {
      // Straight stroke — Spare's primary element
      mainPath.push(`L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
    } else if (choice < 0.8) {
      // Angular detour through or near centre — creates knot crossings
      const vx = cx + rngRange(rng, -radius * 0.25, radius * 0.25);
      const vy = cy + rngRange(rng, -radius * 0.25, radius * 0.25);
      mainPath.push(`L ${vx.toFixed(2)} ${vy.toFixed(2)}`);
      mainPath.push(`L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
    } else {
      // Triangle spike — a sharp detour perpendicular to the stroke
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const spike = rngRange(rng, 15, 35) * (rng() < 0.5 ? 1 : -1);
      const sx = mx + (-dy / len) * spike;
      const sy = my + (dx / len) * spike;
      mainPath.push(`L ${sx.toFixed(2)} ${sy.toFixed(2)}`);
      mainPath.push(`L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
    }

    // Crossbar at ~25% of nodes — short perpendicular line through the node
    if (rng() < 0.25) {
      const ang = rng() * Math.PI;
      const half = rngRange(rng, 8, 16);
      const x1 = b.x + Math.cos(ang) * half;
      const y1 = b.y + Math.sin(ang) * half;
      const x2 = b.x - Math.cos(ang) * half;
      const y2 = b.y - Math.sin(ang) * half;
      decorations.push(`M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`);
    }

    // Arrow tip at ~15% of nodes
    if (rng() < 0.15) {
      const dx2 = b.x - a.x;
      const dy2 = b.y - a.y;
      const len2 = Math.hypot(dx2, dy2) || 1;
      const ux = dx2 / len2;
      const uy = dy2 / len2;
      const al = 10;
      const aw = 6;
      decorations.push(
        `M ${(b.x - ux * al + uy * aw).toFixed(2)} ${(b.y - uy * al - ux * aw).toFixed(2)} ` +
        `L ${b.x.toFixed(2)} ${b.y.toFixed(2)} ` +
        `L ${(b.x - ux * al - uy * aw).toFixed(2)} ${(b.y - uy * al + ux * aw).toFixed(2)}`
      );
    }
  }

  // Close back to start
  mainPath.push(`L ${first.x.toFixed(2)} ${first.y.toFixed(2)}`);

  cmds.push(mainPath.join(" "));
  if (decorations.length) cmds.push(decorations.join(" "));
  return cmds.join(" ");
}

export function buildSigilSvg(ctx: ShareCardContext): string {
  const { width, height, rng, scene, title } = ctx;
  const cx = width / 2;
  const cy = height / 2;
  const ringR = Math.min(width, height) * 0.34;
  const boundaryR = Math.min(width, height) * 0.42;

  const phrase = desirePhrase(scene, title);
  // Fallback if the scene has no useful letters — pad with root name.
  const source = phrase.length >= 4 ? phrase : (phrase + "SIGIL").slice(0, 8);
  const unique = uniqueLetters(source);
  const ensured =
    unique.length >= 4
      ? unique
      : (unique + "AEIOU").split("").filter((c, i, a) => a.indexOf(c) === i).slice(0, 6).join("");

  const nodeCount = Math.max(8, ensured.length + 2);
  const points = layoutNodes(nodeCount, cx, cy, ringR, rng);
  const pathD = buildSigilPath(points, cx, cy, ringR, rng);

  const parts: string[] = [];

  // Background + parchment wash.
  parts.push(`<defs>`);
  parts.push(
    `<radialGradient id="parch" cx="50%" cy="50%" r="60%">` +
      `<stop offset="0%" stop-color="${PALETTE.parchment}" stop-opacity="1"/>` +
      `<stop offset="100%" stop-color="${PALETTE.bg}" stop-opacity="1"/>` +
      `</radialGradient>`,
  );
  parts.push(`</defs>`);
  parts.push(`<rect width="${width}" height="${height}" fill="${PALETTE.bg}"/>`);
  parts.push(`<rect width="${width}" height="${height}" fill="url(#parch)"/>`);

  // Outer boundary (magical circle) — double stroke.
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${boundaryR}" fill="none" stroke="${PALETTE.boundary}" stroke-width="1.4"/>`,
  );
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${(boundaryR - 10).toFixed(2)}" fill="none" stroke="${PALETTE.boundary}" stroke-width="0.8" stroke-opacity="0.7"/>`,
  );

  // Decorative tick marks around the boundary — every 30°.
  for (let tick = 0; tick < 12; tick++) {
    const a = (tick / 12) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * (boundaryR - 10);
    const y1 = cy + Math.sin(a) * (boundaryR - 10);
    const x2 = cx + Math.cos(a) * (boundaryR + 10);
    const y2 = cy + Math.sin(a) * (boundaryR + 10);
    parts.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${PALETTE.boundary}" stroke-width="1"/>`,
    );
  }

  // The sigil itself — three strokes stacked for a hand-inked weight.
  // Widest underpainting, medium mid, crisp top stroke in full ink.
  parts.push(
    `<path d="${pathD}" fill="none" stroke="${PALETTE.inkDim}" stroke-width="9" stroke-opacity="0.22" stroke-linecap="round" stroke-linejoin="miter"/>`,
  );
  parts.push(
    `<path d="${pathD}" fill="none" stroke="${PALETTE.inkDim}" stroke-width="5" stroke-opacity="0.45" stroke-linecap="round" stroke-linejoin="miter"/>`,
  );
  parts.push(
    `<path d="${pathD}" fill="none" stroke="${PALETTE.ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="miter"/>`,
  );

  // Node dots — small ink dots at intersections, Spare-style "bindu"
  for (const p of points) {
    parts.push(
      `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" fill="${PALETTE.ink}"/>`,
    );
  }

  // Central mark — a small glyph at the heart of the sigil.
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="5" fill="${PALETTE.ink}"/>`,
  );
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="${PALETTE.ink}" stroke-width="0.8" stroke-opacity="0.6"/>`,
  );

  // Corner ritual marks — four small crosses.
  const cornerInset = 70;
  const corners = [
    [cornerInset, cornerInset],
    [width - cornerInset, cornerInset],
    [cornerInset, height - cornerInset],
    [width - cornerInset, height - cornerInset],
  ];
  for (const [x, y] of corners) {
    parts.push(
      `<g stroke="${PALETTE.boundary}" stroke-width="1.2" stroke-linecap="round">` +
        `<line x1="${x - 8}" y1="${y}" x2="${x + 8}" y2="${y}"/>` +
        `<line x1="${x}" y1="${y - 8}" x2="${x}" y2="${y + 8}"/>` +
        `</g>`,
    );
  }

  // Title — tiny caps above the boundary at the top.
  const titleText = (title || "UNTITLED").toUpperCase().slice(0, 42);
  parts.push(
    `<text x="${cx}" y="${(cy - boundaryR - 22).toFixed(2)}" fill="${PALETTE.text}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="14" letter-spacing="4" text-anchor="middle">${escapeXml(titleText)}</text>`,
  );

  // Desire phrase below the boundary, also hushed so it reads as
  // script rather than a label.
  const phraseDisplay = ensured.split("").join(" ");
  parts.push(
    `<text x="${cx}" y="${(cy + boundaryR + 32).toFixed(2)}" fill="${PALETTE.inkDim}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="12" letter-spacing="6" text-anchor="middle">${escapeXml(phraseDisplay)}</text>`,
  );

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
