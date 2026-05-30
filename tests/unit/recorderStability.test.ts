/**
 * Stability regressions for the realtime capture paths — these guard
 * the two failure modes that leave a recording feature wedged for the
 * rest of the session:
 *
 *   1. LoopBouncer: an exception during post-capture encode must still
 *      clear `running`, or every later bounce throws "already in
 *      progress" until reload.
 *   2. MasterRecorder: stop()/cancel() await the worklet's "done"
 *      message; if that message never arrives (node GC'd, context
 *      killed mid-stop) the await must time out rather than hang the
 *      UI in a stuck-recording state forever.
 *
 * The classes touch browser-only globals (AudioWorkletNode, the audio
 * context, window timers). We mock the minimum surface — enough to
 * drive one capture + stop cycle deterministically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- shared fake worklet plumbing -----------------------------------------

interface FakeNodeBehavior {
  /** Deliver one full chunk of `frames` samples when "start" arrives. */
  framesOnStart?: number;
  /** Post "done" back when "stop" arrives. Set false to simulate a
   *  worklet that never acknowledges stop (the hang case). */
  doneOnStop?: boolean;
}

let nodeBehavior: FakeNodeBehavior = {};

class FakeWorkletNode {
  port: { postMessage: (m: any) => void; onmessage: ((e: any) => void) | null };
  constructor(_ctx: any, _name: string, _opts: any) {
    this.port = {
      onmessage: null,
      postMessage: (msg: any) => {
        if (msg?.type === "start" && nodeBehavior.framesOnStart) {
          const n = nodeBehavior.framesOnStart;
          this.port.onmessage?.({
            data: { type: "chunk", samples: [new Float32Array(n), new Float32Array(n)] },
          });
        } else if (msg?.type === "stop" && nodeBehavior.doneOnStop !== false) {
          this.port.onmessage?.({ data: { type: "done" } });
        }
      },
    };
  }
}

function makeCtx(sampleRate = 1000) {
  return {
    sampleRate,
    state: "running" as AudioContextState,
    currentTime: 1000, // large constant so elapsed-based exit never gates
    resume: vi.fn(async () => {}),
  };
}

const tapNode = { connect: vi.fn(), disconnect: vi.fn() } as any;

beforeEach(() => {
  nodeBehavior = {};
  (globalThis as any).AudioWorkletNode = FakeWorkletNode;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// --- LoopBouncer: lockout on encode failure -------------------------------

describe("LoopBouncer encode-failure recovery", () => {
  it("clears `running` when post-capture encode throws", async () => {
    // Force the encode step to throw — stands in for an OOM allocating
    // the output buffers on a long loop.
    vi.doMock("../../src/engine/wavEncoder", () => ({
      encodeWav24: () => {
        throw new Error("simulated encode OOM");
      },
    }));
    const { LoopBouncer } = await import("../../src/engine/LoopBouncer");

    const ctx = makeCtx(1000);
    // loopFrames = 0.1 * 1000 = 100, fadeFrames = floor(0.01*1000)=10 → 110 total.
    nodeBehavior = { framesOnStart: 110, doneOnStop: true };
    const bouncer = new LoopBouncer(ctx as any, tapNode);

    await expect(
      bouncer.bounce({ lengthSec: 0.1, fadeMs: 10 }),
    ).rejects.toThrow(/encode/i);

    // The regression: without the fix `running` stays true forever and
    // every later bounce is rejected with "already in progress".
    expect(bouncer.isBouncing()).toBe(false);
  });
});

// --- MasterRecorder: stop() must not hang ---------------------------------

describe("MasterRecorder stop without worklet ack", () => {
  it("resolves stop() even if the worklet never posts 'done'", async () => {
    vi.doMock("../../src/engine/wavEncoder", () => ({
      encodeWav24: () => new ArrayBuffer(8),
    }));
    const { MasterRecorder } = await import("../../src/engine/MasterRecorder");

    vi.useFakeTimers();
    const ctx = makeCtx(48_000);
    nodeBehavior = { framesOnStart: 4800, doneOnStop: false }; // never acks stop
    const rec = new MasterRecorder(ctx as any, tapNode);

    await rec.start();
    expect(rec.isRecording()).toBe(true);

    const stopped = rec.stop();
    // Advance past the safety timeout; without it this promise hangs.
    await vi.advanceTimersByTimeAsync(5000);
    const result = await stopped;

    expect(result).not.toBeNull();
    expect(rec.isRecording()).toBe(false);
  });
});
