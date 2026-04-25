import type { FlowId } from "./state";

/**
 * Flow definitions — step copy + target selectors for every spotlight
 * tour, plus the offer-pill anchor + label used before the tour runs.
 * Kept in one file so tone, length, and anchors are easy to scan and
 * revise together.
 *
 * Selectors use `data-tutor="..."` attributes on real UI nodes. If a
 * node is missing at runtime, the step falls back to a centred card
 * with no cutout; the offer falls back to a corner dock.
 */

export interface FlowStep {
  id: string;
  selector: string;
  title: string;
  body: string;
}

export interface Flow {
  id: FlowId;
  /** Short label for the offer pill — keep under 24 chars. */
  offerLabel: string;
  /** Selector for docking the offer pill. Falls back to a corner
   *  when missing. */
  offerAnchor: string;
  steps: FlowStep[];
}

const INTRO: Flow = {
  id: "intro",
  offerLabel: "Tour · 4 steps",
  offerAnchor: '[data-tutor="hold"]',
  steps: [
    {
      id: "hold",
      selector: '[data-tutor="hold"]',
      title: "1 — HOLD to start",
      body: "Tap HOLD to begin the drone. Tap again to release. The tonic is your anchor — everything else colours it.",
    },
    {
      id: "weather",
      selector: '[data-tutor="weather"]',
      title: "2 — Drag WEATHER",
      body: "Drag anywhere inside this pad to shape brightness and motion. It is the main expressive gesture.",
    },
    {
      id: "presets",
      selector: '[data-tutor="presets"]',
      title: "3 — Browse presets",
      body: "Tap here to open the scene list, or hit RND in the header for a gentle random variation.",
    },
    {
      id: "views",
      selector: '[data-tutor="views"]',
      title: "4 — MEDITATE / MIXER",
      body: "Optional: MEDITATE goes fullscreen with a visualizer. MIXER opens the master bus. You can ignore both and just play.",
    },
  ],
};

const ADVANCED: Flow = {
  id: "advanced",
  offerLabel: "Learn ADVANCED · 6 steps",
  offerAnchor: '[data-tutor="advanced-toggle"]',
  steps: [
    {
      id: "mode",
      selector: '[data-tutor="mode-tabs"]',
      title: "1 — MODE · SCALE vs MICROTONAL",
      body: "Two ways to colour the tonic. SCALE stacks a diatonic mode on the root (major, minor, Dorian, Phrygian, Lydian...). MICROTONAL swaps the whole tuning system.",
    },
    {
      id: "scale",
      selector: '[data-tutor="scale-grid"]',
      title: "2 — Pick a SCALE",
      body: "While in SCALE mode, each button picks the set of intervals that sounds alongside the tonic. Start with Major or Minor; dive into Dorian / Phrygian / Aeolian for darker moods.",
    },
    {
      id: "tuning",
      selector: '[data-tutor="tuning-picker"]',
      title: "3 — Or pick a TUNING",
      body: "In MICROTONAL mode: Pythagorean, Kirnberger III, 31-TET, Yaman, Bayati, mdrone Signature — each retunes every interval live. The relation picker on the right chooses which degrees sound.",
    },
    {
      id: "lfo",
      selector: '[data-tutor="lfo"]',
      title: "4 — LFO · volume swell",
      body: "The main breathing LFO — pick a waveform, set a RATE (or lock to Link tempo with SYNC), and the drone inhales/exhales. Slow rates feel tidal; fast rates feel nervous.",
    },
    {
      id: "entrain",
      selector: '[data-tutor="entrain"]',
      title: "5 — ENTRAIN · second modulator",
      body: "A companion to the LFO tuned to human states — delta / theta / alpha / beta. Tracks the LFO rate; use it to settle a room or sharpen focus.",
    },
    {
      id: "good-drone",
      selector: '[data-tutor="good-drone"]',
      title: "6 — ATTUNE",
      body: "One-click guided randomize. Samples a beautiful tuning + subtle detune from a curated pool — a safer way to explore than raw RND.",
    },
  ],
};

const SHARE: Flow = {
  id: "share",
  offerLabel: "Learn SHARE · 3 steps",
  offerAnchor: '[data-tutor="share-btn"]',
  steps: [
    {
      id: "share-btn",
      selector: '[data-tutor="share-btn"]',
      title: "1 — SHARE the scene",
      body: "Encodes the full drone landscape — tonic, voices, effects, tuning — into a link. Anyone who opens it hears the same atmosphere.",
    },
    {
      id: "save-session",
      selector: '[data-tutor="settings-btn"]',
      title: "2 — Save a named session",
      body: "Open settings (⚙) → SESSION to save a named copy in your browser. Local-only, survives reloads, and never leaves your device.",
    },
    {
      id: "rec-wav",
      selector: '[data-tutor="rec"]',
      title: "3 — Record a WAV",
      body: "Capture the master output as a WAV file. Use it for long-form drones, sampling, or sending someone a take.",
    },
  ],
};

const EFFECTS: Flow = {
  id: "effects",
  offerLabel: "Learn FX · 2 steps",
  offerAnchor: '[data-tutor="fx-bar"]',
  steps: [
    {
      id: "fx-bar",
      selector: '[data-tutor="fx-bar"]',
      title: "1 — Toggle effects",
      body: "Tap any effect to patch it in or out of the chain. Order is preserved: signal flows left → right through the ones that are on.",
    },
    {
      id: "fx-params",
      selector: '[data-tutor="fx-bar"]',
      title: "2 — Dial them in",
      body: "Long-press (or click again on an already-on effect) to open its parameters — wet, size, decay, character. Everything is live; no latch.",
    },
  ],
};

const SHAPE: Flow = {
  id: "shape",
  offerLabel: "Learn SHAPE · 2 steps",
  offerAnchor: '[data-tutor="shape"]',
  steps: [
    {
      id: "shape-motion",
      selector: '[data-tutor="shape"]',
      title: "1 — MOTION + BODY",
      body: "SHAPE is the evolution engine. MOTION macros (MORPH, EVOLVE, TIME) control how the drone moves on its own. BODY macros (DRIFT, AIR, SUB, BLOOM, GLIDE) sculpt the timbre live.",
    },
    {
      id: "shape-hints",
      selector: '[data-tutor="shape"]',
      title: "2 — Hints toggle",
      body: "The ? button in the SHAPE header toggles one-line descriptions under every macro. Turn it on while you're learning, off when you want a clean panel.",
    },
  ],
};

export const FLOWS: Record<FlowId, Flow> = {
  intro: INTRO,
  advanced: ADVANCED,
  share: SHARE,
  effects: EFFECTS,
  shape: SHAPE,
};

export const FLOW_LABELS: Record<FlowId, string> = {
  intro: "First-run tour",
  advanced: "Advanced: tuning, LFO, ATTUNE",
  share: "Share, save, and record",
  effects: "Effects chain",
  shape: "SHAPE panel",
};
