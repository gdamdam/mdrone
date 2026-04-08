/**
 * VoiceBuilder — factory for drone voice timbres.
 *
 * Each builder returns a `Voice` object connected to a target GainNode
 * (usually AudioEngine's droneVoiceGain). A Voice is whatever nodes are
 * needed for that timbre — a single osc pair for SAW, a bank of sines
 * for ORGAN/BELL, a formant filter stack for CHOIR, etc. The engine
 * only needs the uniform `setFreq / setDrift / stop` interface.
 *
 * Six types, each with a strong identity:
 *   SAW    — bright analog brass bed (current default)
 *   SINE   — pure additive stack, Radigue/La Monte Young
 *   ORGAN  — Hammond-style drawbar stack (fundamental + 3rd + 5th + 8th)
 *   CHOIR  — saw source through a vowel-formant filter bank
 *   BELL   — inharmonic sine stack with bell-like ratios
 *   NOISE  — pink noise through a resonant bandpass at the root
 */

export type VoiceType = "saw" | "sine" | "organ" | "choir" | "bell" | "noise";

export interface Voice {
  setFreq(hz: number, glideSec: number): void;
  setDrift(cents: number): void;
  stop(): void;
}

/** Build a voice at `rootFreq * 2^(intervalCents/1200)` connected to `target`. */
export function buildVoice(
  type: VoiceType,
  ctx: AudioContext,
  target: AudioNode,
  rootFreq: number,
  intervalCents: number,
  driftCents: number,
  startAt: number,
): Voice {
  const targetFreq = rootFreq * Math.pow(2, intervalCents / 1200);
  switch (type) {
    case "saw":
      return buildSawVoice(ctx, target, targetFreq, driftCents, startAt);
    case "sine":
      return buildSineVoice(ctx, target, targetFreq, driftCents, startAt);
    case "organ":
      return buildOrganVoice(ctx, target, targetFreq, driftCents, startAt);
    case "choir":
      return buildChoirVoice(ctx, target, targetFreq, driftCents, startAt);
    case "bell":
      return buildBellVoice(ctx, target, targetFreq, driftCents, startAt);
    case "noise":
      return buildNoiseVoice(ctx, target, targetFreq, driftCents, startAt);
  }
}

// ─────────────────────────────────────────────────────────────────────
// SAW — detuned sawtooth pair (current default)
// ─────────────────────────────────────────────────────────────────────
function buildSawVoice(
  ctx: AudioContext,
  target: AudioNode,
  freq: number,
  drift: number,
  startAt: number,
): Voice {
  const a = ctx.createOscillator();
  a.type = "sawtooth";
  a.frequency.value = freq;
  a.detune.value = -drift;
  const b = ctx.createOscillator();
  b.type = "sawtooth";
  b.frequency.value = freq;
  b.detune.value = drift;
  a.connect(target);
  b.connect(target);
  a.start(startAt);
  b.start(startAt);
  return {
    setFreq: (hz, glideSec) => {
      const now = ctx.currentTime;
      for (const o of [a, b]) {
        o.frequency.cancelScheduledValues(now);
        o.frequency.setValueAtTime(o.frequency.value, now);
        o.frequency.linearRampToValueAtTime(hz, now + glideSec);
      }
    },
    setDrift: (cents) => {
      const now = ctx.currentTime;
      a.detune.setTargetAtTime(-cents, now, 0.05);
      b.detune.setTargetAtTime(cents, now, 0.05);
    },
    stop: () => {
      try { a.stop(); a.disconnect(); } catch { /* ok */ }
      try { b.stop(); b.disconnect(); } catch { /* ok */ }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// SINE — additive stack of pure sines at integer harmonic ratios
// ─────────────────────────────────────────────────────────────────────
function buildSineVoice(
  ctx: AudioContext,
  target: AudioNode,
  freq: number,
  drift: number,
  startAt: number,
): Voice {
  // Partials at 1f, 2f, 3f, 4f, 5f with 1/n² amplitude falloff (softer than 1/n).
  const partials = [1, 2, 3, 4, 5];
  const amps = [0.6, 0.28, 0.14, 0.08, 0.05];
  const stackGain = ctx.createGain();
  stackGain.gain.value = 0.55;
  stackGain.connect(target);

  const oscs: OscillatorNode[] = [];
  partials.forEach((ratio, i) => {
    const a = ctx.createOscillator();
    a.type = "sine";
    a.frequency.value = freq * ratio;
    a.detune.value = -drift * (i === 0 ? 1 : 0.4);
    const b = ctx.createOscillator();
    b.type = "sine";
    b.frequency.value = freq * ratio;
    b.detune.value = drift * (i === 0 ? 1 : 0.4);
    const g = ctx.createGain();
    g.gain.value = amps[i];
    a.connect(g).connect(stackGain);
    b.connect(g);
    a.start(startAt);
    b.start(startAt);
    oscs.push(a, b);
  });

  return {
    setFreq: (hz, glideSec) => {
      const now = ctx.currentTime;
      oscs.forEach((o, i) => {
        const ratio = partials[Math.floor(i / 2)];
        const target = hz * ratio;
        o.frequency.cancelScheduledValues(now);
        o.frequency.setValueAtTime(o.frequency.value, now);
        o.frequency.linearRampToValueAtTime(target, now + glideSec);
      });
    },
    setDrift: (cents) => {
      const now = ctx.currentTime;
      oscs.forEach((o, i) => {
        const partialIdx = Math.floor(i / 2);
        const scale = partialIdx === 0 ? 1 : 0.4;
        const sign = i % 2 === 0 ? -1 : 1;
        o.detune.setTargetAtTime(sign * cents * scale, now, 0.05);
      });
    },
    stop: () => {
      for (const o of oscs) { try { o.stop(); o.disconnect(); } catch { /* ok */ } }
      try { stackGain.disconnect(); } catch { /* ok */ }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// ORGAN — Hammond-style drawbar stack
// ─────────────────────────────────────────────────────────────────────
function buildOrganVoice(
  ctx: AudioContext,
  target: AudioNode,
  freq: number,
  drift: number,
  startAt: number,
): Voice {
  // Drawbar ratios: fundamental, octave, 5th (3x), octave+5th (6x), 3rd (5x)
  // Amplitudes approximate the classic 8-8-8-4-2 drawbar setting.
  const drawbars = [
    { ratio: 1,   amp: 0.55 }, // fundamental (16')
    { ratio: 2,   amp: 0.40 }, // octave (8')
    { ratio: 3,   amp: 0.22 }, // twelfth (5 1/3')
    { ratio: 4,   amp: 0.15 }, // double octave (4')
    { ratio: 6,   amp: 0.10 }, // nineteenth (2 2/3')
  ];
  const stackGain = ctx.createGain();
  stackGain.gain.value = 0.5;
  stackGain.connect(target);

  const oscs: OscillatorNode[] = [];
  drawbars.forEach((bar, i) => {
    const a = ctx.createOscillator();
    a.type = "sine";
    a.frequency.value = freq * bar.ratio;
    a.detune.value = -drift * (i === 0 ? 1 : 0.3);
    const b = ctx.createOscillator();
    b.type = "sine";
    b.frequency.value = freq * bar.ratio;
    b.detune.value = drift * (i === 0 ? 1 : 0.3);
    const g = ctx.createGain();
    g.gain.value = bar.amp;
    a.connect(g).connect(stackGain);
    b.connect(g);
    a.start(startAt);
    b.start(startAt);
    oscs.push(a, b);
  });

  return {
    setFreq: (hz, glideSec) => {
      const now = ctx.currentTime;
      oscs.forEach((o, i) => {
        const ratio = drawbars[Math.floor(i / 2)].ratio;
        const t = hz * ratio;
        o.frequency.cancelScheduledValues(now);
        o.frequency.setValueAtTime(o.frequency.value, now);
        o.frequency.linearRampToValueAtTime(t, now + glideSec);
      });
    },
    setDrift: (cents) => {
      const now = ctx.currentTime;
      oscs.forEach((o, i) => {
        const barIdx = Math.floor(i / 2);
        const scale = barIdx === 0 ? 1 : 0.3;
        const sign = i % 2 === 0 ? -1 : 1;
        o.detune.setTargetAtTime(sign * cents * scale, now, 0.05);
      });
    },
    stop: () => {
      for (const o of oscs) { try { o.stop(); o.disconnect(); } catch { /* ok */ } }
      try { stackGain.disconnect(); } catch { /* ok */ }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// CHOIR — saw source through a vowel formant filter bank
// ─────────────────────────────────────────────────────────────────────
function buildChoirVoice(
  ctx: AudioContext,
  target: AudioNode,
  freq: number,
  drift: number,
  startAt: number,
): Voice {
  // Formant frequencies approximating the vowel "Ah" (male choir).
  // Broader Q + lower center so the fundamental isn't squashed, plus
  // a direct dry send so low notes aren't starved of body.
  const formants = [
    { f: 700,  q: 4,  amp: 1.0 },   // F1 — throat
    { f: 1220, q: 5,  amp: 0.7 },   // F2 — mouth
    { f: 2600, q: 7,  amp: 0.45 },  // F3 — brightness
  ];
  const stackGain = ctx.createGain();
  stackGain.gain.value = 3.5; // generous compensation for formant filter attenuation
  stackGain.connect(target);

  // Source: detuned saw pair
  const a = ctx.createOscillator();
  a.type = "sawtooth";
  a.frequency.value = freq;
  a.detune.value = -drift;
  const b = ctx.createOscillator();
  b.type = "sawtooth";
  b.frequency.value = freq;
  b.detune.value = drift;
  const preGain = ctx.createGain();
  preGain.gain.value = 0.5;
  a.connect(preGain);
  b.connect(preGain);

  // Parallel formant filters
  for (const fm of formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = fm.f;
    bp.Q.value = fm.q;
    const fg = ctx.createGain();
    fg.gain.value = fm.amp;
    preGain.connect(bp).connect(fg).connect(stackGain);
  }

  // Small dry send so the fundamental is always audible even at low notes
  const dry = ctx.createGain();
  dry.gain.value = 0.15;
  preGain.connect(dry).connect(stackGain);

  a.start(startAt);
  b.start(startAt);

  return {
    setFreq: (hz, glideSec) => {
      const now = ctx.currentTime;
      for (const o of [a, b]) {
        o.frequency.cancelScheduledValues(now);
        o.frequency.setValueAtTime(o.frequency.value, now);
        o.frequency.linearRampToValueAtTime(hz, now + glideSec);
      }
    },
    setDrift: (cents) => {
      const now = ctx.currentTime;
      a.detune.setTargetAtTime(-cents, now, 0.05);
      b.detune.setTargetAtTime(cents, now, 0.05);
    },
    stop: () => {
      try { a.stop(); a.disconnect(); } catch { /* ok */ }
      try { b.stop(); b.disconnect(); } catch { /* ok */ }
      try { preGain.disconnect(); } catch { /* ok */ }
      try { stackGain.disconnect(); } catch { /* ok */ }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// BELL — "singing bowl" partials. Real church-bell ratios (2.01, 2.83…)
// sound chaotic sustained — too dissonant for a drone. These are
// gentler: mostly harmonic with a subtly stretched upper partial and
// one inharmonic 5.4× for the metallic shimmer.
// ─────────────────────────────────────────────────────────────────────
function buildBellVoice(
  ctx: AudioContext,
  target: AudioNode,
  freq: number,
  drift: number,
  startAt: number,
): Voice {
  const partials = [
    { ratio: 1.0,  amp: 0.65 }, // fundamental — strong
    { ratio: 2.0,  amp: 0.40 }, // clean octave
    { ratio: 3.0,  amp: 0.22 }, // twelfth (harmonic)
    { ratio: 4.0,  amp: 0.12 }, // double octave (harmonic)
    { ratio: 5.4,  amp: 0.08 }, // stretched upper — gives the "metallic" flavor
  ];
  const stackGain = ctx.createGain();
  stackGain.gain.value = 0.48;
  stackGain.connect(target);

  const oscs: OscillatorNode[] = [];
  partials.forEach((p, i) => {
    const a = ctx.createOscillator();
    a.type = "sine";
    a.frequency.value = freq * p.ratio;
    a.detune.value = -drift * (i === 0 ? 1 : 0.25);
    const b = ctx.createOscillator();
    b.type = "sine";
    b.frequency.value = freq * p.ratio;
    b.detune.value = drift * (i === 0 ? 1 : 0.25);
    const g = ctx.createGain();
    g.gain.value = p.amp;
    a.connect(g).connect(stackGain);
    b.connect(g);
    a.start(startAt);
    b.start(startAt);
    oscs.push(a, b);
  });

  return {
    setFreq: (hz, glideSec) => {
      const now = ctx.currentTime;
      oscs.forEach((o, i) => {
        const ratio = partials[Math.floor(i / 2)].ratio;
        const t = hz * ratio;
        o.frequency.cancelScheduledValues(now);
        o.frequency.setValueAtTime(o.frequency.value, now);
        o.frequency.linearRampToValueAtTime(t, now + glideSec);
      });
    },
    setDrift: (cents) => {
      const now = ctx.currentTime;
      oscs.forEach((o, i) => {
        const pIdx = Math.floor(i / 2);
        const scale = pIdx === 0 ? 1 : 0.25;
        const sign = i % 2 === 0 ? -1 : 1;
        o.detune.setTargetAtTime(sign * cents * scale, now, 0.05);
      });
    },
    stop: () => {
      for (const o of oscs) { try { o.stop(); o.disconnect(); } catch { /* ok */ } }
      try { stackGain.disconnect(); } catch { /* ok */ }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// NOISE — pink noise through a resonant bandpass at the root
// ─────────────────────────────────────────────────────────────────────
function buildNoiseVoice(
  ctx: AudioContext,
  target: AudioNode,
  freq: number,
  _drift: number,
  startAt: number,
): Voice {
  // 10-second pink noise loop — long enough that the loop boundary
  // click is infrequent, and the buffer is faded at the edges so the
  // boundary is (nearly) continuous.
  const buffer = makePinkNoise(ctx, 10.0);
  // Fade in/out the first and last 1024 samples to hide the loop seam.
  const fadeSamples = 1024;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < fadeSamples; i++) {
      const g = i / fadeSamples;
      data[i] *= g;
      data[data.length - 1 - i] *= g;
    }
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  // Two parallel bandpasses — one at the root, one at 2× (adds body).
  const bp1 = ctx.createBiquadFilter();
  bp1.type = "bandpass";
  bp1.frequency.value = freq;
  bp1.Q.value = 10; // moderate — wide enough to pass real energy
  const bp2 = ctx.createBiquadFilter();
  bp2.type = "bandpass";
  bp2.frequency.value = freq * 2;
  bp2.Q.value = 14;
  const bp2Gain = ctx.createGain();
  bp2Gain.gain.value = 0.35;

  const stackGain = ctx.createGain();
  stackGain.gain.value = 14.0; // very heavy compensation — narrow BP on pink noise is quiet

  source.connect(bp1).connect(stackGain);
  source.connect(bp2).connect(bp2Gain).connect(stackGain);
  stackGain.connect(target);
  source.start(startAt);

  return {
    setFreq: (hz, glideSec) => {
      const now = ctx.currentTime;
      for (const [bp, mult] of [[bp1, 1], [bp2, 2]] as const) {
        bp.frequency.cancelScheduledValues(now);
        bp.frequency.setValueAtTime(bp.frequency.value, now);
        bp.frequency.linearRampToValueAtTime(hz * mult, now + glideSec);
      }
    },
    setDrift: (_cents) => {
      // Noise voices don't have per-oscillator detune — DRIFT is
      // carried by the other voices in the stack.
    },
    stop: () => {
      try { source.stop(); source.disconnect(); } catch { /* ok */ }
      try { bp1.disconnect(); } catch { /* ok */ }
      try { bp2.disconnect(); } catch { /* ok */ }
      try { bp2Gain.disconnect(); } catch { /* ok */ }
      try { stackGain.disconnect(); } catch { /* ok */ }
    },
  };
}

/** Generate a stereo pink-noise buffer via Paul Kellet's filter. */
function makePinkNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(seconds * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  return buffer;
}
