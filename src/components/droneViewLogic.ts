/**
 * Pure decision logic extracted from DroneView so it can be unit-tested
 * without rendering the (very large) component. Two concerns live here:
 *
 * 1. shouldTriggerHoldToggle — gates the global Space → HOLD shortcut.
 * 2. muteSoloAfterSceneLoad — reconciles the component-local mute/solo
 *    state (the "Variant C prototype") when a scene/preset/snapshot
 *    load lands.
 */
import type { VoiceType } from "../engine/VoiceBuilder";

/** Structural stand-ins so tests can use plain object stubs (no DOM). */
export interface HoldKeyTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
}
export interface HoldKeyEventLike {
  code: string;
  repeat?: boolean;
  target: HoldKeyTargetLike | null;
}

// Tags whose native Space behavior (activate / open / scroll-into-
// option) must win over the global HOLD shortcut. INPUT/TEXTAREA are
// also typing targets, kept here so the predicate stands alone.
const INTERACTIVE_TAGS = new Set(["BUTTON", "SELECT", "INPUT", "TEXTAREA"]);
// ARIA roles that make a non-native element Space-activatable (or
// Space-scrubbed, for slider/spinbutton). Tabbing to one of these and
// pressing Space must operate the widget, not toggle HOLD.
const INTERACTIVE_ROLES = new Set([
  "button", "slider", "switch", "checkbox", "radio",
  "tab", "menuitem", "menuitemcheckbox", "menuitemradio",
  "option", "listbox", "combobox", "spinbutton", "link",
]);

/**
 * Should this keydown trigger the global Space → HOLD toggle?
 * False while typing (input/textarea/contentEditable) so spaces land in
 * the text, false on focused interactive elements (button/select/
 * link/ARIA widgets) so Space activates them natively instead of being
 * preventDefault()-ed away, and false on key-repeat so holding Space
 * down doesn't retoggle the transport every repeat tick.
 */
export function shouldTriggerHoldToggle(e: HoldKeyEventLike): boolean {
  if (e.code !== "Space") return false;
  if (e.repeat) return false;
  const t = e.target;
  if (!t) return true;
  if (t.isContentEditable) return false;
  const tag = t.tagName ?? "";
  if (INTERACTIVE_TAGS.has(tag)) return false;
  // Anchors are only focusable (and Space/Enter-activatable) with href.
  if (tag === "A" && t.getAttribute?.("href") != null) return false;
  const role = t.getAttribute?.("role");
  if (role && INTERACTIVE_ROLES.has(role)) return false;
  return true;
}

/**
 * Component-local mute/solo state (lives outside the scene reducer —
 * see the "Variant C prototype" comment in DroneView).
 */
export interface MuteSoloLocalState {
  mutedVoices: ReadonlySet<VoiceType>;
  soloVoice: VoiceType | null;
  muteStash: Partial<Record<VoiceType, number>>;
  soloStash: Partial<Record<VoiceType, number>>;
}

/**
 * Reconcile mute/solo local state when a scene/preset/snapshot load
 * applies incoming voice levels. Everything is dropped — stashes AND
 * flags — with no level writes: the loaded scene's levels are
 * authoritative.
 *
 * Why clear the flags too, not just the stashes: a loaded scene should
 * sound exactly as authored. The load already wrote the authored levels
 * to the engine, so a surviving "muted" flag would lie about what's
 * sounding; and un-muting would restore a stale pre-mute level from the
 * PREVIOUS scene over the freshly loaded one.
 */
export function muteSoloAfterSceneLoad(prev: MuteSoloLocalState): MuteSoloLocalState {
  void prev; // nothing from the previous scene's mute/solo survives a load
  return {
    mutedVoices: new Set<VoiceType>(),
    soloVoice: null,
    muteStash: {},
    soloStash: {},
  };
}
