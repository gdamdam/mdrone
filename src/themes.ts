/**
 * Theme system — warm palettes that sit in the mpump/mloop family but
 * push deeper into amber/ember territory so mdrone visually feels like
 * "the warm one" of the three.
 *
 * mpump leans forest green · mloop leans mint · mdrone leans ember/amber.
 */

import { STORAGE_KEYS } from "./config";

export type PaletteId = "ember" | "copper" | "dusk" | "parchment";

export interface PaletteDef {
  id: PaletteId;
  name: string;
  dark: boolean;
  bg: string;
  panel: string;
  cell: string;
  border: string;
  text: string;
  dim: string;
  preview: string; // accent
}

export const PALETTES: PaletteDef[] = [
  // Ember — deep brown-black with a warm amber accent. Default.
  // Passive surfaces (panel / cell / border / dim) sit on a low-
  // saturation warm-neutral axis so the only true orange in the UI
  // is the --preview accent reserved for active / selected states.
  {
    id: "ember",
    name: "Ember",
    dark: true,
    bg: "#160c06",
    panel: "#1f1814",
    cell: "#2a221b",
    border: "#3d3329",
    text: "#f3e0c8",
    dim: "#9c9080",
    preview: "#ff9d3a",
  },
  // Copper — richer red-orange accent, same warm-neutral surfaces
  // as ember (shared neutral axis keeps mdrone identity coherent
  // across palettes; only the accent + bg shift between them).
  {
    id: "copper",
    name: "Copper",
    dark: true,
    bg: "#1a0a06",
    panel: "#221a15",
    cell: "#2c241d",
    border: "#3f342a",
    text: "#f5d8c0",
    dim: "#9c9080",
    preview: "#ff6e40",
  },
  // Dusk — purpled-warm, "before dawn" mood, magenta-amber accent.
  {
    id: "dusk",
    name: "Dusk",
    dark: true,
    bg: "#140a10",
    panel: "#1d1620",
    cell: "#27212a",
    border: "#3a3140",
    text: "#f0d4de",
    dim: "#94878f",
    preview: "#ffa057",
  },
  // Parchment — the one light palette. Matte cream backgrounds, bone
  // cells, aged-ink text, copper accent. Matches the project's
  // iron/graphite/clay material ethos rather than a "white UI" feel,
  // and stays readable on bright stages where dark themes wash out.
  {
    id: "parchment",
    name: "Parchment",
    dark: false,
    bg: "#f1e6d1",
    panel: "#e7d9be",
    cell: "#ddcca8",
    border: "#a89574",
    text: "#2a1d0f",
    dim: "#6a543c",
    preview: "#b8501a",
  },
];

export function getPaletteById(id: PaletteId): PaletteDef | null {
  return PALETTES.find((palette) => palette.id === id) ?? null;
}

export function applyPalette(p: PaletteDef): void {
  const root = document.documentElement;
  root.style.setProperty("--bg", p.bg);
  root.style.setProperty("--bg-panel", p.panel);
  root.style.setProperty("--bg-cell", p.cell);
  root.style.setProperty("--border", p.border);
  root.style.setProperty("--text", p.text);
  root.style.setProperty("--text-dim", p.dim);
  root.style.setProperty("--preview", p.preview);
  document.body.style.background = p.bg;
  document.body.style.color = p.text;
}

export function loadPaletteId(): PaletteId {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.palette);
    if (stored && PALETTES.find((p) => p.id === stored)) return stored as PaletteId;
  } catch {
    // ignore storage failures
  }
  return "ember";
}

export function savePaletteId(id: PaletteId): void {
  try {
    localStorage.setItem(STORAGE_KEYS.palette, id);
  } catch {
    // ignore storage failures
  }
}
