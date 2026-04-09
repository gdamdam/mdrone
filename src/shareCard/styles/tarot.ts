import type { ShareCardContext } from "../svgBuilder";
import { rngPick, rngRange } from "../rng";

/**
 * Rider-Waite — inspired tarot card, night variant.
 *
 * Layout (top → bottom):
 *   · Roman numeral in a small double circle near the top
 *   · Ornamental double border with corner flourishes
 *   · Central pictogram chosen deterministically from a vocabulary of 8
 *     stylised glyphs (vessel, tower, star, sun, moon, wheel, eye, key)
 *   · Name banner at the bottom
 *
 * Hand-drawn feel: lines are "jittered" by RNG-seeded offsets on their
 * endpoints so nothing is pixel-perfect. Still deterministic — same
 * payload → same jitter.
 */

const PALETTE = {
  bg: "#08060a",
  card: "#16100a",
  cardEdge: "#1e1812",
  gold: "#c89838",
  goldDim: "#6a4820",
  ivory: "#e8d4a0",
  red: "#a84028",
  shadow: "#2a1c10",
};

const PICTOGRAMS = [
  "vessel",
  "tower",
  "star",
  "sun",
  "moon",
  "wheel",
  "eye",
  "key",
] as const;
type Pictogram = (typeof PICTOGRAMS)[number];

/** Arabic → Roman numeral (1..22). */
function toRoman(n: number): string {
  if (n <= 0) return "O";
  const map: ReadonlyArray<[number, string]> = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let v = n;
  let out = "";
  for (const [val, sym] of map) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out;
}

/** Small endpoint jitter for a woodcut feel. Deterministic via rng. */
function j(rng: () => number, amt = 2): number {
  return rngRange(rng, -amt, amt);
}

/* ─── Pictograms ───────────────────────────────────────────────────────── */
/* Each returns an SVG fragment centred at (cx, cy) filling a bounding box
 * roughly of size `size`. All use the shared PALETTE.                     */

function drawVessel(cx: number, cy: number, size: number, rng: () => number): string {
  // Stemmed chalice — bowl on top of a foot.
  const w = size * 0.9;
  const h = size;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const bowlR = w / 2.2;
  const bowlCx = cx;
  const bowlCy = top + bowlR + 10;
  const stemY1 = bowlCy + bowlR * 0.9;
  const stemY2 = bottom - 30;
  return (
    `<g stroke="${PALETTE.gold}" stroke-width="3" fill="${PALETTE.card}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M ${(bowlCx - bowlR + j(rng)).toFixed(1)} ${(bowlCy + j(rng)).toFixed(1)} ` +
    `Q ${bowlCx.toFixed(1)} ${(bowlCy + bowlR * 1.4).toFixed(1)} ` +
    `${(bowlCx + bowlR + j(rng)).toFixed(1)} ${(bowlCy + j(rng)).toFixed(1)} ` +
    `L ${(bowlCx + bowlR - 4).toFixed(1)} ${(bowlCy - 2).toFixed(1)} ` +
    `L ${(bowlCx - bowlR + 4).toFixed(1)} ${(bowlCy - 2).toFixed(1)} Z"/>` +
    `<line x1="${cx.toFixed(1)}" y1="${stemY1.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${stemY2.toFixed(1)}"/>` +
    `<ellipse cx="${cx.toFixed(1)}" cy="${bottom.toFixed(1)}" rx="${(w * 0.36).toFixed(1)}" ry="8"/>` +
    // Liquid highlight inside bowl
    `<circle cx="${cx.toFixed(1)}" cy="${(bowlCy + 6).toFixed(1)}" r="${(bowlR * 0.55).toFixed(1)}" fill="none" stroke="${PALETTE.red}" stroke-width="1.2" stroke-opacity="0.7"/>` +
    `</g>`
  );
}

function drawTower(cx: number, cy: number, size: number, rng: () => number): string {
  const h = size;
  const w = size * 0.55;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const crenW = w / 5;
  let crenels = "";
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0) {
      crenels += `<rect x="${(left + i * crenW + j(rng)).toFixed(1)}" y="${(top + j(rng)).toFixed(1)}" width="${crenW.toFixed(1)}" height="14" fill="${PALETTE.gold}"/>`;
    }
  }
  return (
    `<g stroke="${PALETTE.gold}" stroke-width="3" fill="${PALETTE.card}" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect x="${left.toFixed(1)}" y="${(top + 14).toFixed(1)}" width="${w.toFixed(1)}" height="${(h - 14).toFixed(1)}"/>` +
    crenels +
    // Two narrow windows
    `<rect x="${(cx - 6).toFixed(1)}" y="${(top + 60).toFixed(1)}" width="12" height="30" fill="${PALETTE.bg}"/>` +
    `<rect x="${(cx - 6).toFixed(1)}" y="${(top + 120).toFixed(1)}" width="12" height="30" fill="${PALETTE.bg}"/>` +
    // Door
    `<path d="M ${(cx - 16).toFixed(1)} ${bottom.toFixed(1)} L ${(cx - 16).toFixed(1)} ${(bottom - 28).toFixed(1)} Q ${cx.toFixed(1)} ${(bottom - 44).toFixed(1)} ${(cx + 16).toFixed(1)} ${(bottom - 28).toFixed(1)} L ${(cx + 16).toFixed(1)} ${bottom.toFixed(1)} Z" fill="${PALETTE.bg}"/>` +
    // Lightning bolt down the side
    `<path d="M ${(right + 20).toFixed(1)} ${(top - 20).toFixed(1)} L ${(right + 4).toFixed(1)} ${(cy - 20).toFixed(1)} L ${(right + 18).toFixed(1)} ${(cy - 20).toFixed(1)} L ${(right + 2).toFixed(1)} ${(cy + 40).toFixed(1)}" fill="none" stroke="${PALETTE.red}" stroke-width="2.5"/>` +
    `</g>`
  );
}

function drawStar(cx: number, cy: number, size: number, rng: () => number): string {
  const r = size / 2;
  const inner = r * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : inner;
    pts.push(`${(cx + Math.cos(a) * rr + j(rng, 1.5)).toFixed(1)},${(cy + Math.sin(a) * rr + j(rng, 1.5)).toFixed(1)}`);
  }
  // Small surrounding stars
  const smalls: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rngRange(rng, 0, 0.4);
    const d = r * 1.5;
    smalls.push(
      `<circle cx="${(cx + Math.cos(a) * d).toFixed(1)}" cy="${(cy + Math.sin(a) * d).toFixed(1)}" r="2.5" fill="${PALETTE.gold}"/>`,
    );
  }
  return (
    `<g>` +
    `<polygon points="${pts.join(" ")}" fill="${PALETTE.card}" stroke="${PALETTE.gold}" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.28).toFixed(1)}" fill="${PALETTE.gold}"/>` +
    smalls.join("") +
    `</g>`
  );
}

function drawSun(cx: number, cy: number, size: number, rng: () => number): string {
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
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${PALETTE.gold}" stroke-width="${i % 2 === 0 ? 3 : 1.6}" stroke-linecap="round"/>`,
    );
  }
  return (
    `<g>` +
    rays.join("") +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${PALETTE.card}" stroke="${PALETTE.gold}" stroke-width="3"/>` +
    // Tiny face
    `<circle cx="${(cx - r * 0.35).toFixed(1)}" cy="${(cy - r * 0.1).toFixed(1)}" r="3" fill="${PALETTE.gold}"/>` +
    `<circle cx="${(cx + r * 0.35).toFixed(1)}" cy="${(cy - r * 0.1).toFixed(1)}" r="3" fill="${PALETTE.gold}"/>` +
    `<path d="M ${(cx - r * 0.4).toFixed(1)} ${(cy + r * 0.25).toFixed(1)} Q ${cx.toFixed(1)} ${(cy + r * 0.5).toFixed(1)} ${(cx + r * 0.4).toFixed(1)} ${(cy + r * 0.25).toFixed(1)}" fill="none" stroke="${PALETTE.gold}" stroke-width="2" stroke-linecap="round"/>` +
    `</g>`
  );
}

function drawMoon(cx: number, cy: number, size: number, rng: () => number): string {
  const r = size * 0.32;
  // Crescent: big circle minus offset smaller circle.
  const off = r * 0.55;
  return (
    `<g>` +
    `<defs><mask id="moonMask"><rect x="${(cx - r * 1.4).toFixed(1)}" y="${(cy - r * 1.4).toFixed(1)}" width="${(r * 2.8).toFixed(1)}" height="${(r * 2.8).toFixed(1)}" fill="white"/>` +
    `<circle cx="${(cx + off).toFixed(1)}" cy="${(cy - off * 0.2).toFixed(1)}" r="${(r * 0.92).toFixed(1)}" fill="black"/></mask></defs>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${PALETTE.gold}" mask="url(#moonMask)"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${PALETTE.gold}" stroke-width="2"/>` +
    // Droplets falling
    `<circle cx="${(cx - r * 0.4 + j(rng)).toFixed(1)}" cy="${(cy + r * 1.5).toFixed(1)}" r="3" fill="${PALETTE.gold}"/>` +
    `<circle cx="${(cx + r * 0.4 + j(rng)).toFixed(1)}" cy="${(cy + r * 1.7).toFixed(1)}" r="2.5" fill="${PALETTE.gold}"/>` +
    `<circle cx="${(cx + j(rng)).toFixed(1)}" cy="${(cy + r * 1.9).toFixed(1)}" r="2" fill="${PALETTE.gold}"/>` +
    `</g>`
  );
}

function drawWheel(cx: number, cy: number, size: number, rng: () => number): string {
  const r = size * 0.4;
  const spokes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rngRange(rng, -0.04, 0.04);
    spokes.push(
      `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}" stroke="${PALETTE.gold}" stroke-width="2"/>`,
    );
  }
  return (
    `<g>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${PALETTE.card}" stroke="${PALETTE.gold}" stroke-width="3.2"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.75).toFixed(1)}" fill="none" stroke="${PALETTE.gold}" stroke-width="1.2" stroke-opacity="0.6"/>` +
    spokes.join("") +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.15).toFixed(1)}" fill="${PALETTE.gold}"/>` +
    `</g>`
  );
}

function drawEye(cx: number, cy: number, size: number, rng: () => number): string {
  const w = size * 0.9;
  const h = size * 0.45;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  void rng;
  return (
    `<g stroke="${PALETTE.gold}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">` +
    // Almond eye shape
    `<path d="M ${(cx - w / 2).toFixed(1)} ${cy.toFixed(1)} Q ${cx.toFixed(1)} ${top.toFixed(1)} ${(cx + w / 2).toFixed(1)} ${cy.toFixed(1)} Q ${cx.toFixed(1)} ${bottom.toFixed(1)} ${(cx - w / 2).toFixed(1)} ${cy.toFixed(1)} Z" fill="${PALETTE.card}"/>` +
    // Iris
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(h * 0.45).toFixed(1)}" fill="${PALETTE.red}" fill-opacity="0.9"/>` +
    // Pupil
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(h * 0.2).toFixed(1)}" fill="${PALETTE.bg}" stroke="none"/>` +
    // Top lashes
    `<line x1="${(cx - w / 3).toFixed(1)}" y1="${(top + 10).toFixed(1)}" x2="${(cx - w / 2.5).toFixed(1)}" y2="${(top - 4).toFixed(1)}"/>` +
    `<line x1="${cx.toFixed(1)}" y1="${(top + 4).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(top - 12).toFixed(1)}"/>` +
    `<line x1="${(cx + w / 3).toFixed(1)}" y1="${(top + 10).toFixed(1)}" x2="${(cx + w / 2.5).toFixed(1)}" y2="${(top - 4).toFixed(1)}"/>` +
    `</g>`
  );
}

function drawKey(cx: number, cy: number, size: number, rng: () => number): string {
  const w = size * 0.8;
  const bowR = size * 0.2;
  const shaftL = w * 0.55;
  const bowCx = cx - w / 2 + bowR;
  const shaftX1 = bowCx + bowR;
  const shaftX2 = shaftX1 + shaftL;
  void rng;
  return (
    `<g stroke="${PALETTE.gold}" stroke-width="3" fill="${PALETTE.card}" stroke-linecap="round" stroke-linejoin="round">` +
    // Bow
    `<circle cx="${bowCx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${bowR.toFixed(1)}"/>` +
    `<circle cx="${bowCx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(bowR * 0.5).toFixed(1)}" fill="${PALETTE.bg}"/>` +
    // Shaft
    `<rect x="${shaftX1.toFixed(1)}" y="${(cy - 4).toFixed(1)}" width="${shaftL.toFixed(1)}" height="8" fill="${PALETTE.gold}" stroke="none"/>` +
    // Teeth
    `<rect x="${(shaftX2 - 20).toFixed(1)}" y="${(cy + 4).toFixed(1)}" width="6" height="14" fill="${PALETTE.gold}" stroke="none"/>` +
    `<rect x="${(shaftX2 - 8).toFixed(1)}" y="${(cy + 4).toFixed(1)}" width="6" height="18" fill="${PALETTE.gold}" stroke="none"/>` +
    `</g>`
  );
}

function drawPictogram(
  picto: Pictogram,
  cx: number,
  cy: number,
  size: number,
  rng: () => number,
): string {
  switch (picto) {
    case "vessel": return drawVessel(cx, cy, size, rng);
    case "tower":  return drawTower(cx, cy, size, rng);
    case "star":   return drawStar(cx, cy, size, rng);
    case "sun":    return drawSun(cx, cy, size, rng);
    case "moon":   return drawMoon(cx, cy, size, rng);
    case "wheel":  return drawWheel(cx, cy, size, rng);
    case "eye":    return drawEye(cx, cy, size, rng);
    case "key":    return drawKey(cx, cy, size, rng);
  }
}

/** Picture-worthy title for the banner — uppercase, fits ~18 chars. */
function bannerTitle(s: string): string {
  const t = (s || "UNTITLED").toUpperCase().trim();
  if (t.length <= 18) return t;
  return t.slice(0, 17) + "…";
}

export function buildTarotSvg(ctx: ShareCardContext): string {
  const { width, height, rng, hash, title } = ctx;

  // Card inset: leaves a dark vignette around the card itself.
  const inset = 40;
  const cardX = inset;
  const cardY = inset;
  const cardW = width - inset * 2;
  const cardH = height - inset * 2;
  const cx = width / 2;

  // Deterministic pictogram + numeral from the hash.
  const picto = rngPick(rng, PICTOGRAMS);
  const numeral = toRoman(1 + (hash % 22));

  const parts: string[] = [];

  // Outer dark vignette.
  parts.push(`<rect width="${width}" height="${height}" fill="${PALETTE.bg}"/>`);

  // The card itself.
  parts.push(
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="4" fill="${PALETTE.card}"/>`,
  );

  // Subtle radial wash on the card surface.
  parts.push(
    `<defs><radialGradient id="cardWash" cx="50%" cy="45%" r="60%">` +
      `<stop offset="0%" stop-color="${PALETTE.cardEdge}" stop-opacity="1"/>` +
      `<stop offset="100%" stop-color="${PALETTE.card}" stop-opacity="1"/>` +
      `</radialGradient></defs>`,
  );
  parts.push(
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="4" fill="url(#cardWash)"/>`,
  );

  // Double gold border — outer heavy, inner thin.
  parts.push(
    `<rect x="${cardX + 14}" y="${cardY + 14}" width="${cardW - 28}" height="${cardH - 28}" fill="none" stroke="${PALETTE.gold}" stroke-width="3"/>`,
  );
  parts.push(
    `<rect x="${cardX + 22}" y="${cardY + 22}" width="${cardW - 44}" height="${cardH - 44}" fill="none" stroke="${PALETTE.goldDim}" stroke-width="1"/>`,
  );

  // Corner flourishes — small diamond + inner dot.
  const cornerR = 9;
  const corners = [
    [cardX + 30, cardY + 30],
    [cardX + cardW - 30, cardY + 30],
    [cardX + 30, cardY + cardH - 30],
    [cardX + cardW - 30, cardY + cardH - 30],
  ];
  for (const [x, y] of corners) {
    parts.push(
      `<path d="M ${x} ${y - cornerR} L ${x + cornerR} ${y} L ${x} ${y + cornerR} L ${x - cornerR} ${y} Z" fill="${PALETTE.card}" stroke="${PALETTE.gold}" stroke-width="1.6"/>`,
    );
    parts.push(`<circle cx="${x}" cy="${y}" r="2" fill="${PALETTE.gold}"/>`);
  }

  // Roman numeral medallion near the top.
  const medY = cardY + 70;
  parts.push(
    `<circle cx="${cx}" cy="${medY}" r="28" fill="${PALETTE.card}" stroke="${PALETTE.gold}" stroke-width="2.2"/>`,
  );
  parts.push(
    `<circle cx="${cx}" cy="${medY}" r="22" fill="none" stroke="${PALETTE.goldDim}" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${cx}" y="${(medY + 7).toFixed(1)}" fill="${PALETTE.gold}" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-weight="bold" text-anchor="middle" letter-spacing="1">${numeral}</text>`,
  );

  // Horizontal divider flourishes above/below pictogram.
  const divW = cardW * 0.5;
  const divUpperY = medY + 54;
  const divLowerY = cardY + cardH - 130;
  for (const dy of [divUpperY, divLowerY]) {
    parts.push(
      `<line x1="${(cx - divW / 2).toFixed(1)}" y1="${dy}" x2="${(cx + divW / 2).toFixed(1)}" y2="${dy}" stroke="${PALETTE.goldDim}" stroke-width="1"/>`,
    );
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${dy}" r="3" fill="${PALETTE.gold}"/>`,
    );
    parts.push(
      `<circle cx="${(cx - divW / 2).toFixed(1)}" cy="${dy}" r="2" fill="${PALETTE.gold}"/>`,
    );
    parts.push(
      `<circle cx="${(cx + divW / 2).toFixed(1)}" cy="${dy}" r="2" fill="${PALETTE.gold}"/>`,
    );
  }

  // Pictogram — centred between the dividers.
  const pictoSize = cardW * 0.42;
  const pictoCy = (divUpperY + divLowerY) / 2;
  parts.push(drawPictogram(picto, cx, pictoCy, pictoSize, rng));

  // Name banner at the bottom.
  const banner = bannerTitle(title);
  const bannerH = 58;
  const bannerY = cardY + cardH - 86;
  parts.push(
    `<rect x="${(cardX + 40).toFixed(1)}" y="${bannerY}" width="${(cardW - 80).toFixed(1)}" height="${bannerH}" fill="${PALETTE.card}" stroke="${PALETTE.gold}" stroke-width="1.4"/>`,
  );
  parts.push(
    `<rect x="${(cardX + 46).toFixed(1)}" y="${bannerY + 6}" width="${(cardW - 92).toFixed(1)}" height="${bannerH - 12}" fill="none" stroke="${PALETTE.goldDim}" stroke-width="0.8"/>`,
  );
  parts.push(
    `<text x="${cx}" y="${(bannerY + bannerH / 2 + 9).toFixed(1)}" fill="${PALETTE.ivory}" font-family="Georgia, 'Times New Roman', serif" font-size="26" font-style="italic" text-anchor="middle" letter-spacing="3">${escapeXml(banner)}</text>`,
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
