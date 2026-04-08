/**
 * FxBar — the drone effects strip below the XY climate pad.
 *
 * Works like mpump's kaos-style effects chain: a row of toggle buttons,
 * one per effect, each with an SVG icon and a name. Click to flip the
 * effect on/off. Active effects are lit with the ember accent.
 *
 * Fixed signal order (matches FxChain):
 *   TAPE · WOW · PLATE · HALL · SHIMMER · DELAY · SUB · COMB · FREEZE
 *
 * No per-effect parameter modal in the prototype — each effect is a
 * plain on/off with sensible defaults.
 */

import { useCallback, useRef, useState } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import type { EffectId } from "../engine/FxChain";
import { FxModal } from "./FxModal";

/** Long-press duration (ms) before a button opens the settings modal. */
const LONG_PRESS_MS = 420;

interface FxBarProps {
  engine: AudioEngine | null;
}

interface FxDef {
  id: EffectId;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const FX_DEFS: FxDef[] = [
  {
    id: "tape",
    label: "TAPE",
    hint: "Tape saturation + high-end rolloff. Warm analog colour on the whole signal",
    icon: <IconTape />,
  },
  {
    id: "wow",
    label: "WOW",
    hint: "Wow & flutter — slow pitch wobble (0.55 Hz) + fast flutter (6.2 Hz). Basinski/Grouper instability",
    icon: <IconWow />,
  },
  {
    id: "plate",
    label: "PLATE",
    hint: "Plate reverb — short, dense, metallic tail (EMT-140-style)",
    icon: <IconPlate />,
  },
  {
    id: "hall",
    label: "HALL",
    hint: "Hall reverb — long, airy, with pre-delay. Cathedral space",
    icon: <IconHall />,
  },
  {
    id: "shimmer",
    label: "SHIMMER",
    hint: "Shimmer reverb — bright highpassed tail. Pairs with the SHIMMER macro for Eno-style clouds",
    icon: <IconShimmerFx />,
  },
  {
    id: "delay",
    label: "DELAY",
    hint: "Tape delay — warm feedback with saturation in the loop",
    icon: <IconDelay />,
  },
  {
    id: "sub",
    label: "SUB",
    hint: "Sub harmonic enhancer — psychoacoustic bass bloom (bandpass → saturation → lowpass)",
    icon: <IconSubFx />,
  },
  {
    id: "comb",
    label: "COMB",
    hint: "Resonant comb filter tuned to the drone root. Adds a pitched metallic ring",
    icon: <IconComb />,
  },
  {
    id: "freeze",
    label: "FREEZE",
    hint: "Freeze — captures the current moment as a self-sustaining loop. Toggle off to decay",
    icon: <IconFreeze />,
  },
];

export function FxBar({ engine }: FxBarProps) {
  // Local mirror of the engine's effect states — toggled on click.
  const [states, setStates] = useState<Record<EffectId, boolean>>(() =>
    engine?.getEffectStates() ?? {
      plate: false, hall: false, shimmer: false, delay: false,
      tape: false, wow: false, sub: false, comb: false, freeze: false,
    }
  );
  const [modalFx, setModalFx] = useState<EffectId | null>(null);

  // Long-press gates a toggle — if the hold fires, open the modal and
  // swallow the subsequent click so the effect doesn't flip state.
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const toggle = useCallback((id: EffectId) => {
    setStates((s) => {
      const next = !s[id];
      engine?.setEffect(id, next);
      return { ...s, [id]: next };
    });
  }, [engine]);

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
    toggle(id);
  }, [toggle]);

  return (
    <div className="panel fx-bar-panel">
      <div className="panel-label">EFFECTS · click = toggle · hold = configure</div>
      <div className="fx-bar">
        {FX_DEFS.map((fx) => (
          <button
            key={fx.id}
            onClick={() => handleClick(fx.id)}
            onPointerDown={() => handlePointerDown(fx.id)}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onPointerCancel={cancelLongPress}
            className={states[fx.id] ? "fx-btn fx-btn-active" : "fx-btn"}
            title={`${fx.hint}${"\n\n"}Long-press for settings.`}
          >
            <span className="fx-btn-icon">{fx.icon}</span>
            <span className="fx-btn-label">{fx.label}</span>
          </button>
        ))}
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
