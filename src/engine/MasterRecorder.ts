export interface RecordingSupport {
  supported: boolean;
  reason?: string;
}

export class MasterRecorder {
  private readonly ctx: AudioContext;
  private readonly tapNode: AudioNode;
  private recDest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private recChunks: Blob[] = [];

  constructor(ctx: AudioContext, tapNode: AudioNode) {
    this.ctx = ctx;
    this.tapNode = tapNode;
  }

  getRecordingSupport(): RecordingSupport {
    if (typeof MediaRecorder === "undefined") {
      return { supported: false, reason: "This browser does not support MediaRecorder." };
    }

    const supportsWebm =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ||
      MediaRecorder.isTypeSupported("audio/webm");
    if (!supportsWebm) {
      return {
        supported: false,
        reason: "This browser cannot export the WebM audio stream mdrone uses for WAV rendering.",
      };
    }

    return { supported: true };
  }

  async start(): Promise<void> {
    if (this.recorder) return;

    const support = this.getRecordingSupport();
    if (!support.supported) {
      throw new Error(support.reason ?? "Master recording is unavailable in this browser.");
    }

    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.recDest = this.ctx.createMediaStreamDestination();
    this.tapNode.connect(this.recDest);
    this.recChunks = [];

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    this.recorder = new MediaRecorder(this.recDest.stream, { mimeType: mime });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recChunks.push(e.data);
    };
    this.recorder.start(200);
  }

  async stop(): Promise<void> {
    if (!this.recorder || !this.recDest) return;

    const chunks = this.recChunks;
    const rec = this.recorder;
    const recDest = this.recDest;

    const stopPromise = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    rec.stop();
    await stopPromise;

    try { this.tapNode.disconnect(recDest); } catch { /* ok */ }
    this.recorder = null;
    this.recDest = null;

    const blob = new Blob(chunks, { type: chunks[0]?.type ?? "audio/webm" });
    if (blob.size === 0) return;

    const arrayBuf = await blob.arrayBuffer();
    const decoded = await this.ctx.decodeAudioData(arrayBuf.slice(0));
    const wav = MasterRecorder.encodeWav(decoded);
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
    return this.recorder !== null;
  }

  private static encodeWav(buffer: AudioBuffer): ArrayBuffer {
    const numCh = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2;
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
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const chans: Float32Array[] = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));

    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }

    return ab;
  }
}
