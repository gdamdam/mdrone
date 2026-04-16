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

    const wav = MasterRecorder.encodeWav24(left, right, this.ctx.sampleRate);
    const wavBlob = new Blob([wav], { type: "audio/wav" });

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
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

  /** Encode stereo Float32 channels as 24-bit little-endian PCM WAV. */
  private static encodeWav24(
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
  ): ArrayBuffer {
    const numCh = 2;
    const length = left.length;
    const bytesPerSample = 3; // 24-bit
    const blockAlign = numCh * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const totalSize = 44 + dataSize;

    const ab = new ArrayBuffer(totalSize);
    const view = new DataView(ab);
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, "RIFF");
    view.setUint32(4, totalSize - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);           // fmt chunk size
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 24, true);           // bits per sample
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    // 24-bit signed: range -(2^23) .. 2^23 - 1. Dither is not applied
    // here — the source samples are float, and 24 bits is already
    // 144 dB of headroom which is well below any self-noise we care
    // about in a music export.
    for (let i = 0; i < length; i++) {
      let s = Math.max(-1, Math.min(1, left[i]));
      let n = s < 0 ? s * 0x800000 : s * 0x7fffff;
      n = n | 0;
      view.setUint8(offset, n & 0xff);
      view.setUint8(offset + 1, (n >> 8) & 0xff);
      view.setUint8(offset + 2, (n >> 16) & 0xff);
      offset += 3;

      s = Math.max(-1, Math.min(1, right[i]));
      n = s < 0 ? s * 0x800000 : s * 0x7fffff;
      n = n | 0;
      view.setUint8(offset, n & 0xff);
      view.setUint8(offset + 1, (n >> 8) & 0xff);
      view.setUint8(offset + 2, (n >> 16) & 0xff);
      offset += 3;
    }

    return ab;
  }
}
