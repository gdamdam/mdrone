/**
 * MasterRecorder — studio-grade 24-bit stereo WAV capture.
 *
 * Taps the master signal in parallel through an AudioWorklet
 * (`fx-recorder-tap`), batches Float32 samples on the audio thread,
 * and encodes a 24-bit PCM WAV on stop. No intermediate codec — the
 * captured samples are bit-identical to what the engine produced.
 *
 * Memory note: Float32 stereo at the context's sample rate grows at
 * about 44 MB per 10 minutes at 48 kHz. The browser is not a DAW —
 * for long takes the recommended workflow is segmented recording
 * (see start({ segmentMinutes })), which finalizes a WAV every N
 * minutes and rotates buffers so peak memory is bounded per segment.
 * The single-take path is preserved when segmentMinutes is omitted.
 */
import { encodeWav24 } from "./wavEncoder";

export interface RecordingSupport {
  supported: boolean;
  reason?: string;
}

export interface MasterRecordingResult {
  /** 24-bit PCM WAV bytes ready to wrap in a Blob. */
  wav: ArrayBuffer;
  /** Capture duration in milliseconds, derived from sample count. */
  durationMs: number;
}

export interface MasterRecordingSegment extends MasterRecordingResult {
  /** 1-based segment index for filenames (pt01, pt02, …). */
  index: number;
}

export interface MasterRecorderStartOptions {
  /** When set, the recorder finalizes a WAV every N minutes and
   *  starts the next segment without dropping samples. The caller
   *  receives each finalized segment via onSegment. Omit for the
   *  legacy single-WAV behaviour. */
  segmentMinutes?: number;
  /** Receives each finalized segment when segmentMinutes is set. The
   *  final segment is also returned by stop() so the caller can name
   *  files consistently across segments and the trailing piece. */
  onSegment?: (seg: MasterRecordingSegment) => void;
}

/** Recommended max single-take length before peak memory becomes an
 *  issue on typical browsers. Surfaced as UI guidance and as the
 *  default segment length when the user opts in. */
export const RECOMMENDED_MAX_TAKE_MINUTES = 30;
export const SEGMENT_FILENAME_PAD = 2;

/** Helper for recording UIs — produce `pt01`, `pt02`, … filenames
 *  that match what MasterRecorder reports via onSegment. */
export function segmentFilename(base: string, index: number, ext = "wav"): string {
  const n = String(index).padStart(SEGMENT_FILENAME_PAD, "0");
  return `${base}-pt${n}.${ext}`;
}

/** Memory estimate for a given recording length, in bytes. The
 *  in-memory buffer is Float32 stereo (2 channels × 4 bytes/sample).
 *  Encoded WAV is 24-bit, so the on-disk file is ~3/4 of this; the
 *  peak number is what matters for browser memory pressure. */
export function estimateRecordingBytes(sampleRate: number, ms: number): number {
  return Math.max(0, Math.round((ms / 1000) * sampleRate * 2 * 4));
}

export class MasterRecorder {
  private readonly ctx: AudioContext;
  private readonly tapNode: AudioNode;
  private recorderNode: AudioWorkletNode | null = null;
  private chunksL: Float32Array[] = [];
  private chunksR: Float32Array[] = [];
  private totalFrames = 0;
  private capturing = false;
  private donePromise: Promise<void> | null = null;
  private memoryWarnAtFrames = Number.POSITIVE_INFINITY;
  private memoryWarnFired = false;
  private onMemoryWarning: (() => void) | null = null;
  /** Frames per segment; +Infinity disables segmentation. */
  private segmentFrames = Number.POSITIVE_INFINITY;
  /** 1-based index of the current segment. */
  private segmentIndex = 1;
  /** Frame count at the start of the current segment, so the rotated
   *  WAV's duration only reflects samples in that segment. */
  private segmentStartFrame = 0;
  private onSegment: ((seg: MasterRecordingSegment) => void) | null = null;

  constructor(ctx: AudioContext, tapNode: AudioNode) {
    this.ctx = ctx;
    this.tapNode = tapNode;
  }

  getRecordingSupport(): RecordingSupport {
    if (typeof AudioWorkletNode === "undefined") {
      return {
        supported: false,
        reason: "This browser does not support AudioWorklet.",
      };
    }
    return { supported: true };
  }

  /** Subscribe to a one-shot warning fired when capture passes the
   *  long-recording threshold (default 15 minutes). Returns an
   *  unsubscribe. The warning fires at most once per recording. */
  setMemoryWarning(thresholdMs: number, listener: () => void): () => void {
    this.memoryWarnAtFrames = Math.max(1, Math.floor((thresholdMs / 1000) * this.ctx.sampleRate));
    this.onMemoryWarning = listener;
    return () => {
      this.memoryWarnAtFrames = Number.POSITIVE_INFINITY;
      this.onMemoryWarning = null;
    };
  }

  async start(opts: MasterRecorderStartOptions = {}): Promise<void> {
    if (this.capturing) return;
    const support = this.getRecordingSupport();
    if (!support.supported) {
      throw new Error(support.reason ?? "Master recording is unavailable.");
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (opts.segmentMinutes && opts.segmentMinutes > 0) {
      this.segmentFrames = Math.max(
        1,
        Math.floor(opts.segmentMinutes * 60 * this.ctx.sampleRate),
      );
      this.onSegment = opts.onSegment ?? null;
    } else {
      this.segmentFrames = Number.POSITIVE_INFINITY;
      this.onSegment = null;
    }
    this.segmentIndex = 1;
    this.segmentStartFrame = 0;

    // Build the tap lazily — AudioWorklet registration may not be
    // complete on first page load; wait for it if necessary.
    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(this.ctx, "fx-recorder-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
    } catch {
      throw new Error("Recorder worklet not ready. Wait a moment and try again.");
    }

    this.chunksL = [];
    this.chunksR = [];
    this.totalFrames = 0;
    this.memoryWarnFired = false;

    let resolveDone!: () => void;
    this.donePromise = new Promise<void>((r) => { resolveDone = r; });

    node.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "chunk" && Array.isArray(msg.samples)) {
        const left = msg.samples[0] as Float32Array;
        const right = msg.samples[1] as Float32Array;
        this.chunksL.push(left);
        this.chunksR.push(right);
        this.totalFrames += left.length;
        if (
          !this.memoryWarnFired &&
          this.totalFrames >= this.memoryWarnAtFrames &&
          this.onMemoryWarning
        ) {
          this.memoryWarnFired = true;
          try { this.onMemoryWarning(); } catch { /* swallow listener errors */ }
        }
        // Segment rotation — finalize a WAV when the running count
        // for this segment crosses the threshold. Samples already
        // captured beyond the threshold stay with the rotated piece;
        // we never split inside an audio-thread chunk.
        if (this.totalFrames - this.segmentStartFrame >= this.segmentFrames) {
          this.finalizeSegment();
        }
      } else if (msg.type === "done") {
        resolveDone();
      }
    };

    // Parallel tap — does not interrupt the path to destination.
    this.tapNode.connect(node);
    node.port.postMessage({ type: "start" });
    this.recorderNode = node;
    this.capturing = true;
  }

  /** Stop capture and return the encoded WAV + duration. The caller
   *  is responsible for naming + downloading. Returns null if there
   *  was no capture or zero frames were recorded. */
  async stop(): Promise<MasterRecordingResult | null> {
    const node = this.recorderNode;
    if (!node || !this.capturing) return null;
    this.capturing = false;

    node.port.postMessage({ type: "stop" });
    await this.donePromise;

    try { this.tapNode.disconnect(node); } catch { /* ok */ }
    this.recorderNode = null;

    const frames = this.totalFrames - this.segmentStartFrame;
    if (frames <= 0) {
      // All captured samples were already finalized by segment
      // rotation — nothing trailing to encode. Caller should rely on
      // onSegment receipts for the full take.
      this.chunksL = [];
      this.chunksR = [];
      this.onSegment = null;
      return null;
    }
    const left = this.concatChunks(this.chunksL, frames);
    const right = this.concatChunks(this.chunksR, frames);
    this.chunksL = [];
    this.chunksR = [];

    const wav = encodeWav24(left, right, this.ctx.sampleRate);
    const durationMs = Math.round((frames / this.ctx.sampleRate) * 1000);
    // If we were segmenting, hand the trailing slice to onSegment too
    // so the consumer sees a uniform stream of segments.
    if (this.onSegment && Number.isFinite(this.segmentFrames)) {
      const trailing: MasterRecordingSegment = { wav, durationMs, index: this.segmentIndex };
      try { this.onSegment(trailing); } catch { /* swallow */ }
    }
    this.onSegment = null;
    return { wav, durationMs };
  }

  isRecording(): boolean {
    return this.capturing;
  }

  /** Total elapsed milliseconds since start(). */
  elapsedMs(): number {
    if (this.totalFrames === 0) return 0;
    return Math.round((this.totalFrames / this.ctx.sampleRate) * 1000);
  }

  /** Approx peak in-memory bytes held by the recorder right now —
   *  Float32 stereo. UI uses this for the size readout / threshold
   *  warnings; bounded per segment when segmentation is active. */
  approxBytes(): number {
    const framesInSegment = this.totalFrames - this.segmentStartFrame;
    return framesInSegment * 2 * 4;
  }

  /** Currently-active segment index (1-based). 1 even when
   *  segmentation is disabled, so callers can format filenames
   *  uniformly. */
  currentSegmentIndex(): number { return this.segmentIndex; }

  /** Discard the current capture without producing a WAV. Cleanly
   *  disconnects the recorder worklet and resets buffers — same
   *  shape as stop() returning null but avoids the encode step. */
  async cancel(): Promise<void> {
    const node = this.recorderNode;
    if (!node || !this.capturing) return;
    this.capturing = false;
    node.port.postMessage({ type: "stop" });
    try { await this.donePromise; } catch { /* swallow */ }
    try { this.tapNode.disconnect(node); } catch { /* ok */ }
    this.recorderNode = null;
    this.chunksL = [];
    this.chunksR = [];
    this.totalFrames = 0;
    this.segmentStartFrame = 0;
    this.segmentIndex = 1;
    this.onSegment = null;
  }

  private finalizeSegment(): void {
    const startFrame = this.segmentStartFrame;
    const endFrame = this.totalFrames;
    const frames = endFrame - startFrame;
    if (frames <= 0) return;
    const left = this.concatChunks(this.chunksL, frames);
    const right = this.concatChunks(this.chunksR, frames);
    // Rotate buffers — we own only the *next* segment's samples now.
    this.chunksL = [];
    this.chunksR = [];
    this.segmentStartFrame = endFrame;
    const wav = encodeWav24(left, right, this.ctx.sampleRate);
    const durationMs = Math.round((frames / this.ctx.sampleRate) * 1000);
    const seg: MasterRecordingSegment = { wav, durationMs, index: this.segmentIndex };
    this.segmentIndex += 1;
    if (this.onSegment) {
      try { this.onSegment(seg); } catch { /* listener errors must not stop capture */ }
    }
  }

  private concatChunks(chunks: Float32Array[], totalFrames: number): Float32Array {
    const out = new Float32Array(totalFrames);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

}
