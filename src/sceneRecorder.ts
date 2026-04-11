/**
 * Motion Recording — capture a short performance of meaningful
 * gestures and replay it deterministically from the shared URL.
 *
 * Format is a flat tuple list `[t_ms, paramId, value, t_ms, paramId, value, ...]`
 * — flat-number-array because gzip-compressed JSON tuples beat
 * objects-of-objects on URL byte budget by ~40 %. Hard caps:
 * MAX_EVENTS = 200, MAX_DURATION_MS = 60_000.
 *
 * Param ids are tiny integers; the union below is the only place that
 * cares about the mapping. Adding new ids is additive (just append) —
 * old URLs without the new id still load fine because malformed
 * events are silently dropped at decode time.
 *
 * Replay schedules a setTimeout per event from the moment the scene
 * applied the recording (typically just after share-URL load). The
 * replay is a "ghost performance" — the user can interrupt it at any
 * time by interacting with the controls.
 */

import type { PitchClass } from "./types";

export const MOTION_PARAM_IDS = {
  drift: 0,
  air: 1,
  time: 2,
  sub: 3,
  bloom: 4,
  glide: 5,
  climateX: 6,
  climateY: 7,
  octave: 8,
  root: 9, // value = PITCH_CLASSES index 0..11
  evolve: 10,
  presetMorph: 11,
  pluckRate: 12,
  lfoRate: 13,
  lfoAmount: 14,
} as const;

export type MotionParamId = (typeof MOTION_PARAM_IDS)[keyof typeof MOTION_PARAM_IDS];

export const MOTION_MAX_EVENTS = 200;
export const MOTION_MAX_DURATION_MS = 60_000;
/** Throttle: ignore writes to the same param id within this window. */
export const MOTION_THROTTLE_MS = 200;

const PITCH_CLASSES: readonly PitchClass[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

export function pitchClassToIndex(pc: PitchClass): number {
  const i = PITCH_CLASSES.indexOf(pc);
  return i >= 0 ? i : 0;
}

export function indexToPitchClass(i: number): PitchClass {
  return PITCH_CLASSES[Math.max(0, Math.min(11, Math.floor(i)))];
}

/**
 * Recorder — exposes start/stop/record. While recording, the host
 * calls record(paramId, value) on every meaningful gesture; the
 * recorder applies its own throttle + caps and stores tuples.
 */
export class SceneRecorder {
  private events: number[] = [];
  private startMs: number = 0;
  private recording: boolean = false;
  private lastWriteMs: Map<MotionParamId, number> = new Map();

  start(): void {
    this.events = [];
    this.startMs = performance.now();
    this.recording = true;
    this.lastWriteMs.clear();
  }

  stop(): void {
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Record a single gesture. Silently no-ops when:
   *  - the recorder isn't running
   *  - we've hit the event cap (MOTION_MAX_EVENTS)
   *  - we've exceeded the duration cap (MOTION_MAX_DURATION_MS)
   *  - the same param was written within MOTION_THROTTLE_MS
   *  - the value isn't finite
   */
  record(paramId: MotionParamId, value: number): void {
    if (!this.recording) return;
    if (!Number.isFinite(value)) return;
    const t = Math.round(performance.now() - this.startMs);
    if (t > MOTION_MAX_DURATION_MS) {
      this.recording = false;
      return;
    }
    if (this.events.length / 3 >= MOTION_MAX_EVENTS) {
      this.recording = false;
      return;
    }
    const last = this.lastWriteMs.get(paramId) ?? -Infinity;
    if (t - last < MOTION_THROTTLE_MS) return;
    this.lastWriteMs.set(paramId, t);
    // Round value to 3 decimals for compactness — drone macros never
    // meaningfully need more precision than ±0.001.
    const v = Math.round(value * 1000) / 1000;
    this.events.push(t, paramId, v);
  }

  getEvents(): number[] {
    return this.events.slice();
  }
}

/**
 * Validate + normalise a motion payload from a share URL. Drops any
 * out-of-range values, non-finite numbers, or unknown param ids. Caps
 * the array length at the max event count. Always returns a fresh
 * array (or `undefined` for an empty / invalid payload — callers can
 * use that as the "no recording" sentinel).
 */
export function normalizeMotionEvents(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const knownIds = new Set<number>(Object.values(MOTION_PARAM_IDS));
  const out: number[] = [];
  let lastT = -Infinity;
  for (let i = 0; i + 2 < value.length; i += 3) {
    if (out.length / 3 >= MOTION_MAX_EVENTS) break;
    const t = value[i];
    const p = value[i + 1];
    const v = value[i + 2];
    if (typeof t !== "number" || !Number.isFinite(t)) continue;
    if (typeof p !== "number" || !knownIds.has(p)) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (t < 0 || t > MOTION_MAX_DURATION_MS) continue;
    if (t < lastT) continue; // monotonic time only — protects replay loop
    lastT = t;
    out.push(t, p, v);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Replay a motion payload by scheduling setTimeout calls per event
 * against the supplied dispatch function. Returns a cancel function
 * that clears every pending timer. Caller is responsible for storing
 * the cancel handle and calling it on unmount / new replay.
 */
export function scheduleMotionReplay(
  events: readonly number[],
  dispatch: (paramId: MotionParamId, value: number) => void,
): () => void {
  if (events.length < 3) return () => { /* noop */ };
  const timers: number[] = [];
  for (let i = 0; i + 2 < events.length; i += 3) {
    const t = events[i];
    const p = events[i + 1] as MotionParamId;
    const v = events[i + 2];
    const id = window.setTimeout(() => dispatch(p, v), t);
    timers.push(id);
  }
  return () => {
    for (const id of timers) window.clearTimeout(id);
  };
}
