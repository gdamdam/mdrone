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

/** Place each unique letter on a polar ring around the centre. */
function layoutPoints(
  unique: string,
  cx: number,
  cy: number,
  r: number,
  rng: () => number,
): Pt[] {
  // Spread angles evenly, offset by letter identity so the layout reflects
  // the phrase rather than just the count.
  const n = unique.length;
  return unique.split("").map((letter, i) => {
    const alphaIdx = letter.charCodeAt(0) - 65;
    // Base angle from index in phrase, perturbed by alphabet position.
    const angle =
      (i / n) * Math.PI * 2 +
      (alphaIdx / 26) * 0.8 +
      rngRange(rng, -0.22, 0.22);
    const radius = r * rngRange(rng, 0.72, 1.0);
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      letter,
    };
  });
}

/** Build a single continuous quadratic-Bézier path through all points,
 *  closing back to the start. */
function buildContinuousPath(points: Pt[], cx: number, cy: number, rng: () => number): string {
  if (points.length === 0) return "";
  const first = points[0];
  const cmds: string[] = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    // Control point midway between the two, offset perpendicular by
    // RNG-controlled amount so each edge curves differently.
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bulge = rngRange(rng, -90, 90);
    const bx = mx + nx * bulge;
    const by = my + ny * bulge;
    cmds.push(`Q ${bx.toFixed(2)} ${by.toFixed(2)} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`);
  }
  // Close back to the start, looping through the centre for a ritual feel.
  const last = points[points.length - 1];
  const cpx = cx + rngRange(rng, -40, 40);
  const cpy = cy + rngRange(rng, -40, 40);
  cmds.push(`Q ${cpx.toFixed(2)} ${cpy.toFixed(2)} ${first.x.toFixed(2)} ${first.y.toFixed(2)}`);
  void last;
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

  const points = layoutPoints(ensured, cx, cy, ringR, rng);
  const pathD = buildContinuousPath(points, cx, cy, rng);

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
    `<path d="${pathD}" fill="none" stroke="${PALETTE.inkDim}" stroke-width="9" stroke-opacity="0.22" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
  parts.push(
    `<path d="${pathD}" fill="none" stroke="${PALETTE.inkDim}" stroke-width="5" stroke-opacity="0.45" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
  parts.push(
    `<path d="${pathD}" fill="none" stroke="${PALETTE.ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  );

  // Vertex beads at each letter point.
  for (const p of points) {
    parts.push(
      `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${PALETTE.ink}"/>`,
    );
    parts.push(
      `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="8" fill="none" stroke="${PALETTE.ink}" stroke-width="0.6" stroke-opacity="0.5"/>`,
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
