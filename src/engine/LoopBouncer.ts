/**
 * LoopBouncer — bounce a short seamless-loop WAV from the live
 * master tap.
 *
 * Drones are the ideal case for seamless-loop export: no transients
 * means a short linear crossfade at the seam is inaudible. The
 * bounced file carries a RIFF `smpl` chunk so samplers auto-detect
 * the loop region and the user can hold the drone indefinitely from
 * a tiny file.
 *
 * Strategy — realtime capture, post-process:
 *   1. Capture (L + F) seconds through an independent
 *      `fx-recorder-tap` worklet (parallel to MasterRecorder).
 *   2. The last F seconds are "overshoot" — what the drone would
 *      have played past the loop end. They are crossfaded onto the
 *      first F seconds of the output so that playing the file on a
 *      loop at (0, L-1) sounds continuous.
 *   3. Wrap the L-second seamless body in short faded edges (see
 *      `padLoopEdges`) so one-shot playback starts/ends at silence,
 *      then encode as 24-bit WAV with the loop points set to the body.
 *
 * Crossfade algorithm (linear):
 *   For i in [0, F):
 *     t = i / F
 *     out[i] = capture[L + i] * (1 - t) + capture[i] * t
 *   For i in [F, L):
 *     out[i] = capture[i]
 *
 * Why linear and not equal-power cosine: drones tend to be phase-
 * coherent across a short window, so capture[i] ≈ capture[L+i]
 * spectrally (not sample-identical but highly correlated). For
 * correlated signals equal-power crossfade introduces a ~3 dB bump
 * mid-fade, audible as a loudness bounce on every loop pass. Linear
 * preserves amplitude exactly when the sources are equal and is
 * smoother when they're close, at the cost of a ~3 dB dip when the
 * sources are genuinely uncorrelated — which is rare in a drone.
 *
 * Continuity check — at the loop seam:
 *   out[L-1] = capture[L-1] (natural body)
 *   out[0]   = capture[L]   (natural continuation past L)
 *   So the sampler sees capture[L-1] → capture[L] across the wrap,
 *   which is the drone's own natural audio — seamless.
 *
 * Why realtime instead of OfflineAudioContext: mdrone's engine is
 * deterministic but loading all voice + FX worklets into a fresh
 * OAC is a non-trivial engine refactor. Realtime capture reuses
 * the running engine as-is, costs the user the loop duration in
 * wait time (15–60 s), and ships in a day rather than a week. When
 * stem bounce lands later, OAC becomes worth the refactor.
 */

import { encodeWav24 } from "./wavEncoder";

export interface BounceProgress {
  /** Elapsed capture seconds, 0 … totalSec. */
  elapsedSec: number;
  /** Total capture seconds, including the crossfade tail. */
  totalSec: number;
  /** Phase — "capturing" during record, "encoding" during post-process. */
  phase: "capturing" | "encoding" | "done";
}

export interface BounceResult {
  /** The encoded 24-bit WAV ready to hand to a Blob. */
  wav: ArrayBuffer;
  /** Length of the looped region in seconds (exactly what the user asked for). */
  lengthSec: number;
  /** Sample rate of the render. */
  sampleRate: number;
}

export interface BounceOptions {
  /** Loop length in seconds — the final WAV duration. */
  lengthSec: number;
  /** Crossfade length in milliseconds. Default 1500 ms. */
  fadeMs?: number;
  /** Called with progress updates at ~4 Hz during capture. */
  onProgress?: (p: BounceProgress) => void;
}

const DEFAULT_FADE_MS = 1500;

/** Hang guard for the worklet "done" ack on stop. The tap normally replies
 *  immediately; this bound is purely so abnormal teardown (node GC'd,
 *  context killed mid-bounce) can't leave `await done` pending forever,
 *  which would pin `running` and wedge every later bounce with "already in
 *  progress". Mirrors MasterRecorder's DONE_ACK_TIMEOUT_MS. */
const DONE_ACK_TIMEOUT_MS = 2000;

/** Absolute fade at the very head and tail of the rendered file, in ms.
 *  Short enough to be inaudible as an attack/release on a drone, long
 *  enough (a few hundred samples) to ramp from/to digital silence without
 *  a click on one-shot playback. Lives outside the smpl loop region so it
 *  never affects sampler looping. */
const EDGE_FADE_MS = 10;

export class BounceCancelledError extends Error {
  constructor() {
    super("Loop bounce cancelled.");
    this.name = "BounceCancelledError";
  }
}

export class LoopBouncer {
  private readonly ctx: AudioContext;
  private readonly tapNode: AudioNode;
  private running = false;
  private cancelled = false;

  constructor(ctx: AudioContext, tapNode: AudioNode) {
    this.ctx = ctx;
    this.tapNode = tapNode;
  }

  isBouncing(): boolean { return this.running; }

  /** Abort an in-progress bounce. The pending `bounce()` promise rejects
   *  with BounceCancelledError; no WAV is produced. No-op if idle. */
  cancel(): void {
    if (this.running) this.cancelled = true;
  }

  async bounce(opts: BounceOptions): Promise<BounceResult> {
    if (this.running) throw new Error("A loop bounce is already in progress.");
    const { lengthSec, fadeMs = DEFAULT_FADE_MS, onProgress } = opts;
    if (!(lengthSec > 0) || lengthSec > 600) {
      throw new Error("Loop length must be between 0 and 600 seconds.");
    }
    const sampleRate = this.ctx.sampleRate;
    const fadeFrames = Math.max(1, Math.floor((fadeMs / 1000) * sampleRate));
    const loopFrames = Math.floor(lengthSec * sampleRate);
    if (fadeFrames * 2 >= loopFrames) {
      throw new Error("Crossfade is longer than half the loop — shorten the fade or lengthen the loop.");
    }
    const totalFrames = loopFrames + fadeFrames;
    const totalSec = totalFrames / sampleRate;

    this.running = true;
    this.cancelled = false;
    if (this.ctx.state === "suspended") await this.ctx.resume();

    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(this.ctx, "fx-recorder-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
    } catch {
      this.running = false;
      throw new Error("Recorder worklet not ready. Wait a moment and try again.");
    }

    const chunksL: Float32Array[] = [];
    const chunksR: Float32Array[] = [];
    let captured = 0;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => { resolveDone = r; });

    node.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "chunk" && Array.isArray(msg.samples)) {
        const left = msg.samples[0] as Float32Array;
        const right = msg.samples[1] as Float32Array;
        chunksL.push(left);
        chunksR.push(right);
        captured += left.length;
      } else if (msg.type === "done") {
        resolveDone();
      }
    };

    // Parallel tap — does not interrupt the path to destination.
    this.tapNode.connect(node);
    node.port.postMessage({ type: "start" });

    // Report progress at ~4 Hz during capture. The tap worklet
    // fires chunks every ~5 ms so the captured frame count is
    // always close to wall-clock elapsed.
    const progressTimer = window.setInterval(() => {
      if (!onProgress) return;
      const elapsedSec = Math.min(totalSec, captured / sampleRate);
      onProgress({ elapsedSec, totalSec, phase: "capturing" });
    }, 250);

    // Wait for capture to complete (or cancel).
    try {
      await new Promise<void>((resolve) => {
        const start = this.ctx.currentTime;
        const tick = () => {
          if (this.cancelled) { resolve(); return; }
          const elapsed = this.ctx.currentTime - start;
          if (elapsed >= totalSec || captured >= totalFrames) {
            resolve();
            return;
          }
          window.setTimeout(tick, 50);
        };
        tick();
      });

      node.port.postMessage({ type: "stop" });
      // Even on cancel we wait for the worklet's "done" so the tap
      // shuts down cleanly before we disconnect — but never longer than
      // DONE_ACK_TIMEOUT_MS, so a worklet that never acks can't hang the
      // bounce (and pin `running`) forever.
      await Promise.race([
        done,
        new Promise<void>((resolve) => { window.setTimeout(resolve, DONE_ACK_TIMEOUT_MS); }),
      ]);
    } finally {
      window.clearInterval(progressTimer);
      try { this.tapNode.disconnect(node); } catch { /* ok */ }
    }

    if (this.cancelled) {
      this.running = false;
      this.cancelled = false;
      throw new BounceCancelledError();
    }

    // Post-process can throw — concat/resize allocate two Float32 buffers
    // of totalFrames (≈200 MB peak for a 600 s loop) and encodeWav24 can
    // OOM. If any of it throws, `running` must still clear or every later
    // bounce is rejected with "already in progress" until reload.
    try {
      onProgress?.({ elapsedSec: totalSec, totalSec, phase: "encoding" });

      // Flatten chunks and render the loop.
      const rawL = concat(chunksL, captured);
      const rawR = concat(chunksR, captured);

      // Trim to exact expected frame count, or pad with silence if
      // the tap produced slightly fewer samples (very unlikely but
      // possible at shutdown).
      const left = resize(rawL, totalFrames);
      const right = resize(rawR, totalFrames);

      const bodyL = new Float32Array(loopFrames);
      const bodyR = new Float32Array(loopFrames);
      crossfadeIntoOutput(left, right, bodyL, bodyR, loopFrames, fadeFrames);

      // Wrap the seamless body in short faded edges so one-shot playback
      // (file preview, sampler in one-shot mode) starts and ends at digital
      // silence instead of clicking on a mid-waveform sample. The loop region
      // is set to the body only, so samplers loop with no per-pass level dip.
      const padFrames = Math.min(
        Math.max(1, Math.floor((EDGE_FADE_MS / 1000) * sampleRate)),
        loopFrames,
      );
      const { outL, outR, loopStart, loopEnd } = padLoopEdges(bodyL, bodyR, padFrames);

      const wav = encodeWav24(outL, outR, sampleRate, {
        loopPoints: { start: loopStart, end: loopEnd },
      });

      onProgress?.({ elapsedSec: totalSec, totalSec, phase: "done" });

      return { wav, lengthSec, sampleRate };
    } finally {
      this.running = false;
    }
  }
}

function concat(chunks: Float32Array[], totalFrames: number): Float32Array {
  const out = new Float32Array(totalFrames);
  let offset = 0;
  for (const c of chunks) {
    if (offset + c.length > totalFrames) {
      out.set(c.subarray(0, totalFrames - offset), offset);
      offset = totalFrames;
      break;
    }
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function resize(src: Float32Array, target: number): Float32Array {
  if (src.length === target) return src;
  const out = new Float32Array(target);
  out.set(src.subarray(0, Math.min(src.length, target)));
  return out;
}

/**
 * Linear crossfade — see header comment for why linear (drones are
 * highly correlated, so equal-power introduces a ~3 dB mid-fade
 * loudness bump). Writes `loopFrames` of output from
 * `captured` (which must be loopFrames + fadeFrames long) so that
 * the output loops seamlessly at (0, loopFrames - 1).
 *
 * The first `fadeFrames` blend the "overshoot" (captured past the
 * loop end, faded out) into the natural head (captured from 0,
 * faded in). Samples after fadeFrames are a straight copy.
 *
 * Exported for unit-testing the seam-continuity math.
 */
export function crossfadeIntoOutput(
  capL: Float32Array,
  capR: Float32Array,
  outL: Float32Array,
  outR: Float32Array,
  loopFrames: number,
  fadeFrames: number,
): void {
  for (let i = 0; i < fadeFrames; i++) {
    const t = i / fadeFrames;
    const gOut = 1 - t; // fade out overshoot
    const gIn = t;      // fade in natural head
    outL[i] = capL[loopFrames + i] * gOut + capL[i] * gIn;
    outR[i] = capR[loopFrames + i] * gOut + capR[i] * gIn;
  }
  for (let i = fadeFrames; i < loopFrames; i++) {
    outL[i] = capL[i];
    outR[i] = capR[i];
  }
}

/**
 * Wrap a seamless loop body in short faded edges so the file plays cleanly
 * one-shot (no click at the absolute start/end) without disturbing how it
 * loops in a sampler.
 *
 * Layout — output is `padFrames + loopFrames + padFrames` long:
 *
 *   [ pre-roll ][ ===== seamless body ===== ][ tail ]
 *   0          loopStart                loopEnd      end
 *
 * The smpl loop region is [loopStart, loopEnd] = the body only, so a sampler
 * wraps loopEnd → loopStart across body[L-1] → body[0] — the same natural
 * seam crossfadeIntoOutput already made continuous. The pre-roll and tail are
 * never inside the loop, so looping has no per-pass level dip.
 *
 * Pre-roll = a faded-in copy of the body's *tail* (body[L-pad .. L-1]).
 * In the seamless loop the tail flows naturally into body[0], so leading the
 * file in with it lands smoothly on the loop start. The fade gain is i/pad:
 * exactly 0 at sample 0 (clean file start), ~1 at the loop start — the tiny
 * <0.05 dB step into body[0] is inaudible.
 *
 * Tail = a faded-out copy of the body's *head* (body[0 .. pad-1]), the natural
 * continuation past loopEnd. The fade gain is 1-(i+1)/pad: ~1 at the loop end
 * (smooth exit from the body), exactly 0 at the last sample (clean file end).
 *
 * Caller must ensure 1 ≤ padFrames ≤ loopFrames. Exported for unit-testing
 * the edge-silence and loop-region invariants.
 */
export function padLoopEdges(
  bodyL: Float32Array,
  bodyR: Float32Array,
  padFrames: number,
): { outL: Float32Array; outR: Float32Array; loopStart: number; loopEnd: number } {
  const loopFrames = bodyL.length;
  const outLen = loopFrames + 2 * padFrames;
  const outL = new Float32Array(outLen);
  const outR = new Float32Array(outLen);

  // Seamless body sits in the middle — the only region the loop covers.
  outL.set(bodyL, padFrames);
  outR.set(bodyR, padFrames);

  // Pre-roll: faded-in copy of the body tail, ramping from silence into
  // the loop start.
  for (let i = 0; i < padFrames; i++) {
    const g = i / padFrames; // 0 at file start (exact silence) → ~1 at loop start
    const src = loopFrames - padFrames + i;
    outL[i] = bodyL[src] * g;
    outR[i] = bodyR[src] * g;
  }

  // Tail: faded-out copy of the body head, the natural release past loopEnd,
  // ramping to exact silence at the file end.
  const tailBase = padFrames + loopFrames;
  for (let i = 0; i < padFrames; i++) {
    const g = 1 - (i + 1) / padFrames; // ~1 at loop end → 0 at file end (exact silence)
    outL[tailBase + i] = bodyL[i] * g;
    outR[tailBase + i] = bodyR[i] * g;
  }

  return { outL, outR, loopStart: padFrames, loopEnd: padFrames + loopFrames - 1 };
}
