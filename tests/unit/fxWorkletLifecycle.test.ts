/**
 * Worklet lifecycle regressions — per the AudioWorklet spec a processor
 * whose process() returns true is kept alive and rendering even after
 * its node is disconnected. Two leaks guarded here:
 *
 *   1. FDN reverb swap (setReverbSeed → swapFdnReverb): the stale
 *      hall/cistern nodes were only disconnected, so every preset
 *      change left two full Freeverb networks running forever.
 *      Fix: post {type:"stop"} to the stale node (the VoiceBuilder
 *      pattern) and have FdnReverbProcessor return false once stopped.
 *
 *   2. Recorder tap (MasterRecorder / LoopBouncer): the tap node is
 *      created fresh per take/bounce and already receives {type:"stop"},
 *      but RecorderTapProcessor kept returning true after finalizing —
 *      one idle-but-alive processor accumulated per take.
 *      Fix: return false from process() once "stop" has been handled.
 *
 * The processor classes live in src/engine/fxChainProcessor.js, a plain
 * worklet script (no imports/exports), so we evaluate it with stubbed
 * worklet globals and drive the registered classes directly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- evaluate the worklet script with stub globals -------------------------

type Registry = Map<string, new (options?: any) => any>;

function loadProcessors(): Registry {
  const registry: Registry = new Map();
  class FakeAudioWorkletProcessor {
    port: { onmessage: ((e: any) => void) | null; postMessage: (m: any) => void; posted: any[] };
    constructor() {
      const posted: any[] = [];
      this.port = { onmessage: null, posted, postMessage: (m: any) => { posted.push(m); } };
    }
  }
  const src = readFileSync(
    path.resolve(__dirname, "../../src/engine/fxChainProcessor.js"),
    "utf8",
  );
  // The script declares classes with bare references to the worklet
  // globals; passing them as function parameters scopes them without
  // polluting globalThis.
  const evalScript = new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", src);
  evalScript(
    FakeAudioWorkletProcessor,
    (name: string, cls: any) => { registry.set(name, cls); },
    48000,
  );
  return registry;
}

const stereoBlock = () => [[new Float32Array(128), new Float32Array(128)]];
const fdnParams = () => ({
  size: Float32Array.of(0.5),
  damping: Float32Array.of(0.5),
  decay: Float32Array.of(0.84),
  mix: Float32Array.of(1),
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).AudioWorkletNode;
});

// --- BUG 1 (processor side): FDN reverb must terminate on "stop" -----------

describe("FdnReverbProcessor stop lifecycle", () => {
  it("process() returns false after receiving {type:'stop'}", () => {
    const Fdn = loadProcessors().get("fx-fdn-reverb")!;
    const p: any = new Fdn({ processorOptions: { seed: 1234 } });

    // Alive and rendering before the stop message.
    expect(p.process(stereoBlock(), stereoBlock(), fdnParams())).toBe(true);

    p.port.onmessage!({ data: { type: "stop" } });

    // The leak: without stop handling this stays true forever and the
    // disconnected reverb keeps burning a full Freeverb network per
    // preset change.
    expect(p.process(stereoBlock(), stereoBlock(), fdnParams())).toBe(false);
  });
});

// --- BUG 1 (TS side): swapFdnReverb must post "stop" to the stale node -----

describe("FxChain.swapFdnReverb stale-node teardown", () => {
  it("posts {type:'stop'} to the old FDN worklet when swapping", async () => {
    const { FxChain } = await import("../../src/engine/FxChain");

    class FakeWorkletNode {
      port = { postMessage: vi.fn(), onmessage: null };
      parameters = { get: () => undefined };
      connect = vi.fn();
      disconnect = vi.fn();
    }
    (globalThis as any).AudioWorkletNode = FakeWorkletNode;

    const stale = new FakeWorkletNode();
    const wetGainParam = {
      value: 0, // silent wet path → swap runs synchronously (no setTimeout)
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    };
    // Minimal `this` for the private method — FxChain's full constructor
    // needs a real AudioContext graph, so we drive swapFdnReverb against
    // a hand-built receiver instead.
    const self: any = {
      ctx: { currentTime: 0, createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }) },
      reverbSeed: 42,
      hallWorklet: stale,
      cisternWorklet: null,
      hallSerialTrim: { connect: vi.fn() },
      cisternSerialTrim: null,
      inserts: {
        hall: {
          wetGain: { gain: wetGainParam },
          insertIn: { connect: vi.fn(), disconnect: vi.fn() },
        },
      },
    };

    (FxChain.prototype as any).swapFdnReverb.call(self, "hall");

    // The fresh node must replace the stale one…
    expect(self.hallWorklet).not.toBe(stale);
    // …and the stale node must be told to terminate, not just be
    // disconnected (disconnect alone leaves the processor running).
    expect(stale.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(stale.disconnect).toHaveBeenCalled();
  });
});

// --- BUG 2: recorder tap must terminate after stop/finalize ----------------

describe("RecorderTapProcessor stop lifecycle", () => {
  it("process() returns false once the recording is finalized", () => {
    const Tap = loadProcessors().get("fx-recorder-tap")!;
    const t: any = new Tap();

    t.port.onmessage!({ data: { type: "start" } });
    expect(t.process(stereoBlock())).toBe(true);

    t.port.onmessage!({ data: { type: "stop" } });

    // Existing protocol still intact: partial batch flushed, "done" acked.
    expect(t.port.posted.some((m: any) => m?.type === "chunk")).toBe(true);
    expect(t.port.posted.some((m: any) => m?.type === "done")).toBe(true);

    // The leak: MasterRecorder/LoopBouncer create one tap per take, so
    // a processor that keeps returning true accumulates forever.
    expect(t.process(stereoBlock())).toBe(false);
  });

  it("keeps running while merely idle (created but not yet stopped)", () => {
    const Tap = loadProcessors().get("fx-recorder-tap")!;
    const t: any = new Tap();
    // Not capturing yet — must stay alive so a later "start" works.
    expect(t.process(stereoBlock())).toBe(true);
  });
});
