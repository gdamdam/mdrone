/**
 * MasterRecorder — studio-grade 24-bit stereo WAV capture.
 *
 * Taps the master signal in parallel through an AudioWorklet
 * (`fx-recorder-tap`), batches Float32 samples on the audio thread,
 * and encodes a 24-bit PCM WAV on stop. No intermediate codec — the
 * captured samples are bit-identical to what the engine produced.
 *
 * Memory note: Float32 stereo at the context's sample rate grows at
 * about 44 MB per 10 minutes at 48 kHz. Long sessions should be
 * rendered in shorter passes; there is no streaming-to-disk path.
 */
import { encodeWav24 } from "./wavEncoder";

export interface RecordingSupport {
  supported: boolean;
  reason?: string;
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

  async start(): Promise<void> {
    if (this.capturing) return;
    const support = this.getRecordingSupport();
    if (!support.supported) {
      throw new Error(support.reason ?? "Master recording is unavailable.");
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();

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

  async stop(): Promise<void> {
    const node = this.recorderNode;
    if (!node || !this.capturing) return;
    this.capturing = false;

    node.port.postMessage({ type: "stop" });
    await this.donePromise;

    try { this.tapNode.disconnect(node); } catch { /* ok */ }
    this.recorderNode = null;

    if (this.totalFrames === 0) return;

    const left = this.concatChunks(this.chunksL, this.totalFrames);
    const right = this.concatChunks(this.chunksR, this.totalFrames);
    this.chunksL = [];
    this.chunksR = [];

    const wav = encodeWav24(left, right, this.ctx.sampleRate);
    const wavBlob = new Blob([wav], { type: "audio/wav" });

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(wavBlob);
    a.download = `mdrone-${ts}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  isRecording(): boolean {
    return this.capturing;
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
