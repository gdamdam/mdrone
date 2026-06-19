/**
 * linkBridge ingest hardening — the Ableton Link bridge WebSocket is
 * loopback-only, but the raw `msg.x ?? prev.x` ingest only rejected
 * null/undefined, so a buggy or hostile local process could feed
 * NaN/Infinity/strings straight into tempo-driven LFO math. These tests
 * pin the clamp/finite-guard behaviour of sanitizeLinkMessage.
 */
import { describe, it, expect } from "vitest";
import { sanitizeLinkMessage, type LinkState } from "../../src/engine/linkBridge";

const prev: LinkState = {
  tempo: 120,
  beat: 4,
  phase: 1,
  playing: false,
  peers: 2,
  clients: 1,
  connected: true,
};

describe("sanitizeLinkMessage", () => {
  it("accepts in-range finite numeric fields and the playing flag", () => {
    const s = sanitizeLinkMessage(
      { tempo: 174, beat: 12.5, phase: 2.5, peers: 3, clients: 1, playing: true },
      prev,
    );
    expect(s.tempo).toBe(174);
    expect(s.beat).toBe(12.5);
    expect(s.phase).toBe(2.5);
    expect(s.peers).toBe(3);
    expect(s.playing).toBe(true);
    expect(s.connected).toBe(true);
  });

  it("rejects NaN / Infinity / non-number, falling back to previous", () => {
    const s = sanitizeLinkMessage(
      { tempo: NaN, beat: Infinity, phase: "evil", peers: null, clients: undefined },
      prev,
    );
    expect(s.tempo).toBe(prev.tempo);
    expect(s.beat).toBe(prev.beat);
    expect(s.phase).toBe(prev.phase);
    expect(s.peers).toBe(prev.peers);
    expect(s.clients).toBe(prev.clients);
  });

  it("clamps an out-of-range tempo into the Link range", () => {
    expect(sanitizeLinkMessage({ tempo: 99999 }, prev).tempo).toBe(999);
    expect(sanitizeLinkMessage({ tempo: 1 }, prev).tempo).toBe(20);
  });

  it("floors fractional peer/client counts", () => {
    const s = sanitizeLinkMessage({ peers: 3.9, clients: 2.2 }, prev);
    expect(s.peers).toBe(3);
    expect(s.clients).toBe(2);
  });
});
