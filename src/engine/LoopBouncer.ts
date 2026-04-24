/**
 * LoopBouncer — bounce a short seamless-loop WAV from the live
 * master tap.
 *
 * Drones are the ideal case for seamless-loop export: no transients
 * means a short equal-power crossfade at the seam is inaudible. The
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
 *   3. Encode L seconds of output as 24-bit WAV with loop points.
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
      // shuts down cleanly before we disconnect.
      await done;
    } finally {
      window.clearInterval(progressTimer);
      try { this.tapNode.disconnect(node); } catch { /* ok */ }
    }

    if (this.cancelled) {
      this.running = false;
      this.cancelled = false;
      throw new BounceCancelledError();
    }

    onProgress?.({ elapsedSec: totalSec, totalSec, phase: "encoding" });

    // Flatten chunks and render the loop.
    const rawL = concat(chunksL, captured);
    const rawR = concat(chunksR, captured);

    // Trim to exact expected frame count, or pad with silence if
    // the tap produced slightly fewer samples (very unlikely but
    // possible at shutdown).
    const left = resize(rawL, totalFrames);
    const right = resize(rawR, totalFrames);

    const outL = new Float32Array(loopFrames);
    const outR = new Float32Array(loopFrames);
    crossfadeIntoOutput(left, right, outL, outR, loopFrames, fadeFrames);

    const wav = encodeWav24(outL, outR, sampleRate, {
      loopPoints: { start: 0, end: loopFrames - 1 },
    });

    this.running = false;
    onProgress?.({ elapsedSec: totalSec, totalSec, phase: "done" });

    return { wav, lengthSec, sampleRate };
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
 * Equal-power cosine crossfade. Writes `loopFrames` of output from
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
