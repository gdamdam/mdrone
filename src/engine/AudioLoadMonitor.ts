/**
 * AudioLoadMonitor — cheap drift-based proxy for audio-thread health.
 *
 * Web Audio has no CPU API, but `AudioContext.currentTime` only advances
 * as the audio callback actually runs. If the audio thread under-runs
 * (glitch, crackle), currentTime stalls relative to wall-clock. We sample
 * both clocks periodically and flag "struggling" when audio time falls
 * behind wall time.
 *
 * Hysteresis prevents the UI indicator from flickering: we enter the
 * struggling state on sustained drift or repeated stalls, and only clear
 * it after a quiet window.
 */
export interface AudioLoadState {
  struggling: boolean;
  /** Current drift between wall and audio clocks, ms. */
  driftMs: number;
  /** Count of detected underrun events since the monitor started. */
  underruns: number;
  /** AudioContext.baseLatency in ms (0 if unavailable). */
  baseLatencyMs: number;
  /** AudioContext.outputLatency in ms (0 if unavailable). */
  outputLatencyMs: number;
  /** AudioContext sample rate in Hz. */
  sampleRate: number;
}

type Listener = (state: AudioLoadState) => void;

const SAMPLE_INTERVAL_MS = 250;
// A single sample period with the audio clock advancing <85% of wall is a
// stall — roughly a ≥37 ms drop in a 250 ms window. Tuned to catch real
// glitches without triggering on incidental jitter.
const UNDERRUN_DRIFT_MS = 15;
// Enter struggling state when at least 2 underruns happen within this
// window, so a single isolated hiccup doesn't light up the indicator.
const STRUGGLE_ENTER_WINDOW_MS = 3000;
const STRUGGLE_ENTER_COUNT = 2;
// Leave struggling state after this many ms with no new underruns.
const STRUGGLE_EXIT_MS = 5000;

export class AudioLoadMonitor {
  private readonly ctx: AudioContext;
  private readonly listeners = new Set<Listener>();
  private lastWallMs = 0;
  private lastAudioSec = 0;
  private recentUnderruns: number[] = [];
  private lastUnderrunAt = -Infinity;
  private interval: ReturnType<typeof setInterval> | null = null;
  private state: AudioLoadState;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.state = {
      struggling: false,
      driftMs: 0,
      underruns: 0,
      baseLatencyMs: (ctx.baseLatency ?? 0) * 1000,
      outputLatencyMs: (ctx.outputLatency ?? 0) * 1000,
      sampleRate: ctx.sampleRate,
    };
    this.lastWallMs = performance.now();
    this.lastAudioSec = ctx.currentTime;
    this.interval = setInterval(() => this.tick(), SAMPLE_INTERVAL_MS);
  }

  private tick(): void {
    if (this.ctx.state !== "running") {
      // Context suspended — reset baselines so resume doesn't spike drift.
      this.lastWallMs = performance.now();
      this.lastAudioSec = this.ctx.currentTime;
      return;
    }
    const wallNow = performance.now();
    const audioNow = this.ctx.currentTime;
    const wallDelta = wallNow - this.lastWallMs;
    const audioDelta = (audioNow - this.lastAudioSec) * 1000;
    this.lastWallMs = wallNow;
    this.lastAudioSec = audioNow;

    // Drift = how much wall time outpaced audio time this window.
    // Positive = audio behind wall (stall). Small negatives are clock noise.
    const drift = wallDelta - audioDelta;
    const now = performance.now();

    if (drift > UNDERRUN_DRIFT_MS) {
      this.lastUnderrunAt = now;
      this.recentUnderruns.push(now);
      this.state.underruns += 1;
    }
    // Trim recent-underrun window.
    const windowStart = now - STRUGGLE_ENTER_WINDOW_MS;
    while (this.recentUnderruns.length && this.recentUnderruns[0] < windowStart) {
      this.recentUnderruns.shift();
    }

    const struggling = this.state.struggling
      ? now - this.lastUnderrunAt < STRUGGLE_EXIT_MS
      : this.recentUnderruns.length >= STRUGGLE_ENTER_COUNT;

    this.state = {
      struggling,
      driftMs: Math.max(0, drift),
      underruns: this.state.underruns,
      baseLatencyMs: (this.ctx.baseLatency ?? 0) * 1000,
      outputLatencyMs: (this.ctx.outputLatency ?? 0) * 1000,
      sampleRate: this.ctx.sampleRate,
    };
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }

  getState(): AudioLoadState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    this.listeners.clear();
  }
}
