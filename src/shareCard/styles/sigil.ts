import type { ShareCardContext } from "../svgBuilder";

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


/** Generate sigil points — same algorithm as visualizers.ts:makeSigil.
 *  8-14 nodes on a jittered polar ring, visited in random permutation
 *  order with 1-2 knot revisits, connected with quadratic arcs
 *  (curl ±0.5), occasional small AOS "eye" loops. */
function makeSigilPoints(
  cx: number,
  cy: number,
  radius: number,
  rng: () => number,
): { x: number; y: number }[] {
  const nodeCount = 8 + Math.floor(rng() * 7);
  const nodes: { x: number; y: number }[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const ang = (i / nodeCount) * Math.PI * 2 + (rng() - 0.5) * 0.8;
    const r = radius * (0.35 + rng() * 0.55);
    nodes.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
  }

  // Random traversal order
  const order: number[] = [];
  const indices = nodes.map((_, i) => i);
  while (indices.length) {
    const k = Math.floor(rng() * indices.length);
    order.push(indices.splice(k, 1)[0]);
  }
  order.push(order[0]);
  // 1-2 knot revisits
  const knots = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < knots; i++) {
    const pos = 2 + Math.floor(rng() * Math.max(1, order.length - 3));
    order.splice(pos, 0, Math.floor(rng() * nodeCount));
  }

  const path: { x: number; y: number }[] = [];
  for (let i = 0; i < order.length - 1; i++) {
    const p0 = nodes[order[i]];
    const p1 = nodes[order[i + 1]];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const curl = (rng() - 0.5) * 0.5;
    const mx = (p0.x + p1.x) / 2 + (-dy) * curl;
    const my = (p0.y + p1.y) / 2 + (dx) * curl;
    // Quadratic Bézier sampled at 60 steps
    for (let s = 0; s < 60; s++) {
      const t = s / 60;
      const u = 1 - t;
      path.push({
        x: u * u * p0.x + 2 * u * t * mx + t * t * p1.x,
        y: u * u * p0.y + 2 * u * t * my + t * t * p1.y,
      });
    }
    // AOS eye loop at ~25% of nodes
    if (rng() < 0.25) {
      const lr = radius * 0.05 * (0.5 + rng());
      const dir = rng() < 0.5 ? 1 : -1;
      const startAng = rng() * Math.PI * 2;
      for (let s = 0; s < 30; s++) {
        const t = s / 30;
        const ang = startAng + t * Math.PI * 2 * dir;
        path.push({ x: p1.x + Math.cos(ang) * lr, y: p1.y + Math.sin(ang) * lr });
      }
    }
  }
  // Terminal flourish
  const last = nodes[order[order.length - 1]];
  const fr = radius * 0.06;
  const fAng = rng() * Math.PI * 2;
  for (let s = 0; s < 30; s++) {
    const t = s / 30;
    path.push({ x: last.x + Math.cos(fAng + t * Math.PI * 2) * fr, y: last.y + Math.sin(fAng + t * Math.PI * 2) * fr });
  }
  return path;
}

/** Convert point array to SVG polyline path data. */
function pointsToSvgPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ` +
    pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
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

  void ensured; // used for title/phrase display, not node layout
  const sigilPts = makeSigilPoints(cx, cy, ringR, rng);
  const pathD = pointsToSvgPath(sigilPts);

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
