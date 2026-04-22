/**
 * wavEncoder — 24-bit stereo PCM WAV encoder, shared between
 * MasterRecorder and LoopBouncer.
 *
 * Extracted from MasterRecorder when loop bounce was added — the
 * bounce path needs the same PCM encoder plus an optional RIFF
 * `smpl` chunk so samplers (Kontakt, Logic EXS/Alchemy, Ableton
 * Sampler, Decent Sampler, Renoise, Bitwig, etc.) auto-detect
 * the loop region.
 *
 * The `smpl` chunk is optional — when absent the output is a
 * plain stereo WAV, identical byte-for-byte to the prior
 * MasterRecorder format.
 */

export interface LoopPoints {
  /** First sample of the loop region (inclusive). */
  start: number;
  /** Last sample of the loop region (inclusive). */
  end: number;
}

export interface WavOptions {
  /** Write a RIFF `smpl` chunk with one forward loop covering [start, end]. */
  loopPoints?: LoopPoints;
}

/**
 * Encode stereo Float32 channels as 24-bit little-endian PCM WAV.
 * Returns a complete RIFF buffer ready to wrap in a Blob.
 */
export function encodeWav24(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  opts: WavOptions = {},
): ArrayBuffer {
  const numCh = 2;
  const length = left.length;
  const bytesPerSample = 3;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;

  // smpl chunk = 8 (chunk hdr) + 36 (fixed fields) + 24 (one loop)
  const smplSize = opts.loopPoints ? 8 + 36 + 24 : 0;
  const totalSize = 44 + dataSize + smplSize;

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

  // 24-bit signed: range -(2^23) .. 2^23 - 1. Dither not applied —
  // the source is float and 24 bits is ~144 dB headroom, well below
  // any self-noise we care about.
  let offset = 44;
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

  // Optional `smpl` chunk. Format (sampler metadata) per the WAV
  // spec: 36 bytes of header + 24 bytes per loop. We write exactly
  // one forward loop covering the requested region.
  if (opts.loopPoints) {
    const { start, end } = opts.loopPoints;
    writeString(offset, "smpl");
    view.setUint32(offset + 4, 36 + 24, true);       // chunk payload size
    view.setUint32(offset + 8, 0, true);              // manufacturer
    view.setUint32(offset + 12, 0, true);             // product
    view.setUint32(offset + 16, Math.round(1e9 / sampleRate), true); // sample period (ns)
    view.setUint32(offset + 20, 60, true);            // MIDI unity note (middle C)
    view.setUint32(offset + 24, 0, true);             // MIDI pitch fraction
    view.setUint32(offset + 28, 0, true);             // SMPTE format
    view.setUint32(offset + 32, 0, true);             // SMPTE offset
    view.setUint32(offset + 36, 1, true);             // num sample loops
    view.setUint32(offset + 40, 0, true);             // sampler data (extra bytes)
    // Loop descriptor (24 bytes)
    view.setUint32(offset + 44, 0, true);             // cue point ID
    view.setUint32(offset + 48, 0, true);             // loop type (0 = forward)
    view.setUint32(offset + 52, start, true);         // start sample
    view.setUint32(offset + 56, end, true);           // end sample
    view.setUint32(offset + 60, 0, true);             // fraction
    view.setUint32(offset + 64, 0, true);             // play count (0 = infinite)
  }

  return ab;
}
