/**
 * Ritual / Journey Mode — authored multi-phase scene evolution.
 *
 * A journey is a fixed sequence of four phases: arrival, bloom,
 * suspension, dissolve. Each phase has a duration in evolve-loop ticks
 * and a set of target macro values. When a journey is active, the
 * existing 4 s evolve loop in useSceneManager interpolates the current
 * macros toward the active phase's targets instead of running the
 * generic mutateScene perturbation.
 *
 * This piggybacks on the existing tick infrastructure (so it's
 * deterministic from the URL), reuses the same throttle, and stays
 * subordinate to the held drone (no rhythm, no transport, no events).
 */

import type { DroneSessionSnapshot } from "./session";

export type JourneyId = "morning" | "evening" | "dusk" | "void";

export const JOURNEY_IDS: readonly JourneyId[] = [
  "morning",
  "evening",
  "dusk",
  "void",
] as const;

export type JourneyPhaseName = "arrival" | "bloom" | "suspension" | "dissolve";

export interface JourneyPhase {
  name: JourneyPhaseName;
  /** Duration of this phase in evolve-loop ticks (1 tick ≈ 4 s). */
  durationTicks: number;
  /** Bounded set of macro targets the phase moves toward. Any field
   *  omitted is left untouched by this phase. */
  targets: Partial<{
    drift: number;
    air: number;
    time: number;
    sub: number;
    bloom: number;
    glide: number;
    climateX: number;
    climateY: number;
    evolve: number;
  }>;
}

export interface JourneyDef {
  id: JourneyId;
  label: string;
  phases: readonly JourneyPhase[];
}

/**
 * Authored journey presets. Phase durations are short by design — a
 * full journey is 4 phases × ~6 ticks = ~96 s of evolution before
 * settling. Targets are gentle and bounded: nothing here pushes a
 * macro past 0.85 or below 0.05, so the resulting scene always stays
 * inside the "calm drone" envelope.
 */
export const JOURNEYS: Record<JourneyId, JourneyDef> = {
  morning: {
    id: "morning",
    label: "Morning",
    phases: [
      { name: "arrival",    durationTicks: 4, targets: { air: 0.32, bloom: 0.42, climateY: 0.22, drift: 0.18, evolve: 0.25 } },
      { name: "bloom",      durationTicks: 6, targets: { air: 0.5,  bloom: 0.62, climateY: 0.42, drift: 0.32, time: 0.32 } },
      { name: "suspension", durationTicks: 8, targets: { air: 0.55, bloom: 0.72, climateY: 0.5,  climateX: 0.55, drift: 0.28 } },
      { name: "dissolve",   durationTicks: 6, targets: { air: 0.62, bloom: 0.55, climateY: 0.32, drift: 0.18, evolve: 0.12 } },
    ],
  },
  evening: {
    id: "evening",
    label: "Evening",
    phases: [
      { name: "arrival",    durationTicks: 5, targets: { air: 0.42, bloom: 0.52, climateX: 0.5, drift: 0.22, evolve: 0.3 } },
      { name: "bloom",      durationTicks: 7, targets: { air: 0.58, bloom: 0.7,  climateX: 0.58, climateY: 0.32, sub: 0.22 } },
      { name: "suspension", durationTicks: 9, targets: { air: 0.62, bloom: 0.78, climateX: 0.6,  drift: 0.32, time: 0.18 } },
      { name: "dissolve",   durationTicks: 7, targets: { air: 0.55, bloom: 0.45, climateX: 0.42, sub: 0.08, evolve: 0.1 } },
    ],
  },
  dusk: {
    id: "dusk",
    label: "Dusk",
    phases: [
      { name: "arrival",    durationTicks: 4, targets: { air: 0.38, bloom: 0.48, climateX: 0.42, climateY: 0.18, drift: 0.2, evolve: 0.28 } },
      { name: "bloom",      durationTicks: 6, targets: { air: 0.55, bloom: 0.68, climateX: 0.5,  climateY: 0.38, drift: 0.35, sub: 0.18 } },
      { name: "suspension", durationTicks: 8, targets: { air: 0.6,  bloom: 0.75, climateY: 0.45, drift: 0.4,  time: 0.22 } },
      { name: "dissolve",   durationTicks: 6, targets: { air: 0.5,  bloom: 0.42, climateY: 0.22, drift: 0.22, sub: 0.06,  evolve: 0.1 } },
    ],
  },
  void: {
    id: "void",
    label: "Void",
    phases: [
      { name: "arrival",    durationTicks: 6, targets: { air: 0.45, bloom: 0.55, drift: 0.18, glide: 0.25, evolve: 0.22 } },
      { name: "bloom",      durationTicks: 8, targets: { air: 0.65, bloom: 0.78, drift: 0.32, glide: 0.32, climateY: 0.38 } },
      { name: "suspension", durationTicks: 12, targets: { air: 0.72, bloom: 0.82, drift: 0.42, climateY: 0.5,  time: 0.12 } },
      { name: "dissolve",   durationTicks: 8, targets: { air: 0.55, bloom: 0.5,  drift: 0.22, glide: 0.18, evolve: 0.08 } },
    ],
  },
};

/** Total duration of a journey, in evolve ticks. */
export function journeyDurationTicks(id: JourneyId): number {
  return JOURNEYS[id].phases.reduce((sum, p) => sum + p.durationTicks, 0);
}

/**
 * Resolve which phase + how-far-into-it for a given tick. Ticks past
 * the end of the journey clamp to the final phase at progress=1, so
 * the scene rests on the dissolve targets after the journey completes
 * rather than looping or snapping back.
 */
export function journeyProgressAt(
  id: JourneyId,
  tick: number,
): { phase: JourneyPhase; phaseIndex: number; progress: number } {
  const def = JOURNEYS[id];
  const t = Math.max(0, tick);
  let elapsed = 0;
  for (let i = 0; i < def.phases.length; i++) {
    const phase = def.phases[i];
    if (t < elapsed + phase.durationTicks) {
      return {
        phase,
        phaseIndex: i,
        progress: (t - elapsed) / phase.durationTicks,
      };
    }
    elapsed += phase.durationTicks;
  }
  // Past the end — rest on the final phase fully realised.
  const lastIdx = def.phases.length - 1;
  return { phase: def.phases[lastIdx], phaseIndex: lastIdx, progress: 1 };
}

/**
 * Compute the next snapshot for a single journey tick. Pure function:
 * given (current snapshot, journey id, tick), returns the snapshot
 * with macro fields nudged toward the active phase's targets.
 *
 * Lerp factor scales with tick density — each tick moves ~25 % of the
 * remaining distance toward the target so the motion is audible
 * within a phase but never jumps. After ~6-8 ticks the macro fully
 * settles into the phase target.
 */
export function applyJourneyTick(
  snap: DroneSessionSnapshot,
  id: JourneyId,
  tick: number,
): DroneSessionSnapshot {
  const { phase } = journeyProgressAt(id, tick);
  const lerp = (v: number, target: number) => v + (target - v) * 0.25;
  const t = phase.targets;
  return {
    ...snap,
    drift:    t.drift    !== undefined ? lerp(snap.drift, t.drift)       : snap.drift,
    air:      t.air      !== undefined ? lerp(snap.air, t.air)           : snap.air,
    time:     t.time     !== undefined ? lerp(snap.time, t.time)         : snap.time,
    sub:      t.sub      !== undefined ? lerp(snap.sub, t.sub)           : snap.sub,
    bloom:    t.bloom    !== undefined ? lerp(snap.bloom, t.bloom)       : snap.bloom,
    glide:    t.glide    !== undefined ? lerp(snap.glide, t.glide)       : snap.glide,
    climateX: t.climateX !== undefined ? lerp(snap.climateX, t.climateX) : snap.climateX,
    climateY: t.climateY !== undefined ? lerp(snap.climateY, t.climateY) : snap.climateY,
    evolve:   t.evolve   !== undefined ? lerp(snap.evolve, t.evolve)     : snap.evolve,
  };
}
