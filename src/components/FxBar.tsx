/**
 * FxBar — the drone effects strip below the XY climate pad.
 *
 * Works like mpump's kaos-style effects chain: a row of toggle buttons,
 * one per effect, each with an SVG icon and a name. Click to flip the
 * effect on/off. Active effects are lit with the ember accent.
 *
 * Signal order is imported from the engine's canonical EFFECT_ORDER —
 * this component never defines its own ordering. The numeric badges
 * on lit buttons and the active-chain preview both derive from the
 * same array, so the UI can never drift from real DSP order.
 *
 * No per-effect parameter modal in the prototype — each effect is a
 * plain on/off with sensible defaults.
 */

import { useCallback, useRef, useState } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import { EFFECT_ORDER, type EffectId } from "../engine/FxChain";
import { FxModal } from "./FxModal";

/** Long-press duration (ms) before a button opens the settings modal. */
const LONG_PRESS_MS = 420;

interface FxBarProps {
  engine: AudioEngine | null;
  /** Effect on/off state — owned by DroneView so presets can set it. */
  states: Record<EffectId, boolean>;
  /** Called when the user taps a button (short click). */
  onToggle: (id: EffectId) => void;
}

interface FxDef {
  label: string;
  hint: string;
  icon: React.ReactNode;
}

/**
 * Per-effect presentation metadata. Keyed by EffectId — intentionally
 * NOT an ordered array, so nobody can accidentally introduce a second
 * ordering. Render order always comes from EFFECT_ORDER.
 */
const FX_DEFS: Record<EffectId, FxDef> = {
  tape: {
    label: "TAPE",
    hint: "Tape saturation + high-end rolloff. Warm analog colour on the whole signal",
    icon: <IconTape />,
  },
  wow: {
    label: "WOW",
    hint: "Wow & flutter — slow pitch wobble (0.55 Hz) + fast flutter (6.2 Hz). Basinski/Grouper instability",
    icon: <IconWow />,
  },
  sub: {
    label: "SUB",
    hint: "Sub harmonic enhancer — psychoacoustic bass bloom (bandpass → saturation → lowpass)",
    icon: <IconSubFx />,
  },
  comb: {
    label: "COMB",
    hint: "Resonant comb filter tuned to the drone root. Adds a pitched metallic ring",
    icon: <IconComb />,
  },
  ringmod: {
    label: "RING",
    hint: "Ring modulator — input × fixed sine carrier (~80 Hz). Inharmonic scrape / industrial coloration. Coil, NWW, tape-era noise",
    icon: <IconRingmod />,
  },
  formant: {
    label: "FORMANT",
    hint: "Vocal formant bank — three resonant bandpasses at neutral 'ah' vowel formants. Adds human vocal character to any voice",
    icon: <IconFormant />,
  },
  delay: {
    label: "DELAY",
    hint: "Tape delay — warm feedback with saturation in the loop",
    icon: <IconDelay />,
  },
  plate: {
    label: "PLATE",
    hint: "Plate reverb — short, dense, metallic tail (EMT-140-style)",
    icon: <IconPlate />,
  },
  hall: {
    label: "HALL",
    hint: "Hall reverb — long, airy, with pre-delay. Cathedral space",
    icon: <IconHall />,
  },
  shimmer: {
    label: "SHIMMER",
    hint: "Shimmer reverb — bright highpassed tail. Pairs with the SHIMMER macro for Eno-style clouds",
    icon: <IconShimmerFx />,
  },
  freeze: {
    label: "FREEZE",
    hint: "Freeze — captures the current moment as a self-sustaining loop. Toggle off to decay",
    icon: <IconFreeze />,
  },
  cistern: {
    label: "CISTERN",
    hint: "Cistern reverb — 28-second exponential tail. Fort Worden / cathedral space. Used by Deep Listening",
    icon: <IconCistern />,
  },
  granular: {
    label: "GRAIN",
    hint: "Granular tail — long overlapping grains (drone-smooth cloud). Used by Köner, Hecker, Fennesz, Basinski",
    icon: <IconGranular />,
  },
  graincloud: {
    label: "CLOUD",
    hint: "Classic granular — short grains, dense cloud, wider pitch scatter. Audible stutter, Fennesz/Oval/noisier Hecker",
    icon: <IconGrainCloud />,
  },
};

export function FxBar({ engine, states, onToggle }: FxBarProps) {
  const [modalFx, setModalFx] = useState<EffectId | null>(null);

  // Long-press gates a toggle — if the hold fires, open the modal and
  // swallow the subsequent click so the effect doesn't flip state.
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const handlePointerDown = useCallback((id: EffectId) => {
    longPressFiredRef.current = false;
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      setModalFx(id);
    }, LONG_PRESS_MS);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleClick = useCallback((id: EffectId) => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return; // long-press opened the modal — don't toggle
    }
    onToggle(id);
  }, [onToggle]);

  // Derive the active chain (enabled effects in DSP order) once per
  // render from the engine's canonical EFFECT_ORDER. The numeric
  // badges on lit buttons and the preview row below both read from
  // this same list, so they are guaranteed to agree with each other
  // and with actual DSP routing.
  const activeChain: EffectId[] = EFFECT_ORDER.filter((id) => states[id]);
  const activePositions: Partial<Record<EffectId, number>> = {};
  activeChain.forEach((id, i) => { activePositions[id] = i + 1; });

  return (
    <div className="panel fx-bar-panel">
      <div className="panel-label">EFFECTS · click = toggle · hold = configure</div>
      {/* Active-chain preview — the only place where order is
          communicated visually. The grid below is just a toggle
          surface; reading order off its wrapping rows would be
          misleading, so the numeric badges on lit buttons and this
          linear preview are the authoritative cues. */}
      {activeChain.length > 0 ? (
        <div
          className="fx-chain-flow"
          title="Enabled effects in DSP processing order"
        >
          {activeChain.map((id, i) => (
            <span key={id} className="fx-chain-step fx-chain-step-on">
              {i > 0 && <span className="fx-chain-arrow">→</span>}
              <span className="fx-chain-step-num">{i + 1}</span>
              {FX_DEFS[id].label}
            </span>
          ))}
        </div>
      ) : (
        <div className="panel-hint">No effects active — tap a button below to add one to the chain</div>
      )}
      <div className="fx-bar">
        {EFFECT_ORDER.map((id) => {
          const fx = FX_DEFS[id];
          const pos = activePositions[id];
          return (
            <button
              key={id}
              onClick={() => handleClick(id)}
              onPointerDown={() => handlePointerDown(id)}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onPointerCancel={cancelLongPress}
              className={states[id] ? "fx-btn fx-btn-active" : "fx-btn"}
              title={
                pos !== undefined
                  ? `${fx.hint}\n\nActive chain position: ${pos} of ${activeChain.length}. Long-press for settings.`
                  : `${fx.hint}\n\nInactive — long-press for settings.`
              }
            >
              <span className="fx-btn-num" aria-hidden="true">{pos ?? ""}</span>
              <span className="fx-btn-icon">{fx.icon}</span>
              <span className="fx-btn-label">{fx.label}</span>
            </button>
          );
        })}
      </div>

      {modalFx !== null && (
        <FxModal
          engine={engine}
          effectId={modalFx}
          onClose={() => setModalFx(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Inline SVG icons — monochrome, inherit currentColor, tiny.
// ─────────────────────────────────────────────────────────────────────

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** TAPE — two reels and a magnetic tape strip. */
function IconTape() {
  return (
    <svg {...iconProps}>
      <circle cx="5" cy="9" r="2.5" />
      <circle cx="13" cy="9" r="2.5" />
      <circle cx="5" cy="9" r="0.6" fill="currentColor" />
      <circle cx="13" cy="9" r="0.6" fill="currentColor" />
      <path d="M2 13 H 16" />
    </svg>
  );
}

/** WOW — wavy warbling line. */
function IconWow() {
  return (
    <svg {...iconProps}>
      <path d="M1 9 Q 3 4, 5 9 T 9 9 T 13 9 T 17 9" />
      <path d="M1 13 Q 3 10, 5 13 T 9 13 T 13 13 T 17 13" strokeWidth="0.9" opacity="0.6" />
    </svg>
  );
}

/** PLATE — a suspended metal plate. */
function IconPlate() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="5" width="12" height="8" rx="0.6" />
      <path d="M6 5 V 3" />
      <path d="M12 5 V 3" />
      <path d="M5 9 H 13" opacity="0.5" />
      <path d="M5 11 H 13" opacity="0.5" />
    </svg>
  );
}

/** HALL — arched opening suggesting a cathedral. */
function IconHall() {
  return (
    <svg {...iconProps}>
      <path d="M2 16 V 9 Q 2 3, 9 3 Q 16 3, 16 9 V 16" />
      <path d="M6 16 V 11 Q 6 8, 9 8 Q 12 8, 12 11 V 16" />
    </svg>
  );
}

/** SHIMMER — rising stars / sparkle cluster. */
function IconShimmerFx() {
  return (
    <svg {...iconProps}>
      <path d="M9 2 V 6 M7 4 H 11" />
      <path d="M4 8 V 11 M3 9.5 H 5" />
      <path d="M14 9 V 12 M13 10.5 H 15" />
      <path d="M9 13 V 16 M8 14.5 H 10" opacity="0.6" />
    </svg>
  );
}

/** DELAY — three ghost echoes getting smaller. */
function IconDelay() {
  return (
    <svg {...iconProps}>
      <path d="M2 9 L 5 5 L 5 13 Z" />
      <path d="M8 9 L 10 6 L 10 12 Z" opacity="0.7" />
      <path d="M13 9 L 14.5 7 L 14.5 11 Z" opacity="0.45" />
    </svg>
  );
}

/** SUB — a thick bar with downward arrow. */
function IconSubFx() {
  return (
    <svg {...iconProps}>
      <path d="M3 6 H 15" strokeWidth="2.2" />
      <path d="M9 9 V 15" />
      <path d="M6 12 L 9 15 L 12 12" />
    </svg>
  );
}

/** COMB — a resonance peak / tuned spike. */
function IconComb() {
  return (
    <svg {...iconProps}>
      <path d="M2 14 L 5 14 L 5 9 L 7 9 L 7 4 L 9 4 L 9 9 L 11 9 L 11 14 L 16 14" />
    </svg>
  );
}

/** FREEZE — a snowflake / crystal. */
function IconFreeze() {
  return (
    <svg {...iconProps}>
      <path d="M9 2 V 16" />
      <path d="M2 9 H 16" />
      <path d="M4 4 L 14 14" />
      <path d="M14 4 L 4 14" />
      <path d="M9 5 L 7 3 M9 5 L 11 3" />
      <path d="M9 13 L 7 15 M9 13 L 11 15" />
    </svg>
  );
}

/** CISTERN — a deep well cross-section with a long tail arrow. */
function IconCistern() {
  return (
    <svg {...iconProps}>
      <path d="M3 3 L 3 15 L 15 15 L 15 3" />
      <path d="M3 9 Q 9 7 15 9" />
      <path d="M3 13 Q 9 11 15 13" />
    </svg>
  );
}

/** RING MOD — a ring with a cross-wave through it. */
function IconRingmod() {
  return (
    <svg {...iconProps}>
      <circle cx="9" cy="9" r="6" />
      <path d="M1 9 Q 4 5, 9 9 T 17 9" />
    </svg>
  );
}

/** FORMANT — three bandpass peaks (resonant bumps). */
function IconFormant() {
  return (
    <svg {...iconProps}>
      <path d="M2 14 Q 4 6, 6 14 Q 8 8, 10 14 Q 12 4, 14 14 L 16 14" />
    </svg>
  );
}

/** GRANULAR — scattered dots representing grains. */
function IconGranular() {
  return (
    <svg {...iconProps}>
      <circle cx="4" cy="5" r="1" />
      <circle cx="9" cy="4" r="1" />
      <circle cx="14" cy="6" r="1" />
      <circle cx="6" cy="10" r="1" />
      <circle cx="11" cy="9" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="3" cy="13" r="1" />
      <circle cx="8" cy="14" r="1" />
      <circle cx="12" cy="15" r="1" />
    </svg>
  );
}

function IconGrainCloud() {
  // Denser / smaller dots — classic granular stutter cloud.
  return (
    <svg {...iconProps}>
      <circle cx="3" cy="4" r="0.6" />
      <circle cx="6" cy="3" r="0.6" />
      <circle cx="9" cy="5" r="0.6" />
      <circle cx="12" cy="3" r="0.6" />
      <circle cx="15" cy="4" r="0.6" />
      <circle cx="4" cy="7" r="0.6" />
      <circle cx="8" cy="8" r="0.6" />
      <circle cx="11" cy="7" r="0.6" />
      <circle cx="14" cy="9" r="0.6" />
      <circle cx="3" cy="11" r="0.6" />
      <circle cx="6" cy="12" r="0.6" />
      <circle cx="10" cy="11" r="0.6" />
      <circle cx="13" cy="13" r="0.6" />
      <circle cx="5" cy="14" r="0.6" />
      <circle cx="9" cy="15" r="0.6" />
      <circle cx="15" cy="14" r="0.6" />
    </svg>
  );
}
