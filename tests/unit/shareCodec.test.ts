import { describe, it, expect } from "vitest";
import {
  encodeScenePayload,
  decodeScenePayload,
  extractScenePayloadFromUrl,
} from "../../src/shareCodec";
import { normalizePortableScene } from "../../src/session";

// Use the app's own normalizer to mint a minimal valid PortableScene.
// normalizePortableScene requires `drone` and `mixer` to be records (the
// normalizer fills in defaults for missing fields). This avoids
// hand-rolling a fragile fixture that drifts from the shape.
const freshScene = () => {
  const s = normalizePortableScene({
    name: "VitestScene",
    drone: {},
    mixer: {},
    fx: {},
    ui: {},
  });
  if (!s) throw new Error("normalizePortableScene returned null");
  return s;
};

describe("shareCodec round-trip", () => {
  it("encode → extract → decode preserves the scene", async () => {
    const scene = freshScene();
    const { key, value } = await encodeScenePayload(scene);
    expect(["z", "b"]).toContain(key);
    expect(value.length).toBeGreaterThan(0);

    const url = `https://example.test/mdrone/?${key}=${encodeURIComponent(value)}`;
    const extracted = extractScenePayloadFromUrl(url);
    expect(extracted).not.toBeNull();

    const decoded = await decodeScenePayload(extracted!.payload, extracted!.compressed);
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe(scene.name);
    expect(decoded!.drone.root).toBe(scene.drone.root);
    expect(decoded!.drone.octave).toBe(scene.drone.octave);
  });

  it("preserves a mutated root note through round-trip", async () => {
    const scene = freshScene();
    scene.drone.root = "D";
    scene.drone.octave = 4;

    const { key, value } = await encodeScenePayload(scene);
    const extracted = extractScenePayloadFromUrl(
      `https://example.test/?${key}=${encodeURIComponent(value)}`,
    );
    expect(extracted).not.toBeNull();
    const decoded = await decodeScenePayload(extracted!.payload, extracted!.compressed);
    expect(decoded!.drone.root).toBe("D");
    expect(decoded!.drone.octave).toBe(4);
  });
});

describe("shareCodec malformed input", () => {
  it("extractScenePayloadFromUrl returns null when no z/b param is present", () => {
    expect(extractScenePayloadFromUrl("https://example.test/")).toBeNull();
    expect(extractScenePayloadFromUrl("https://example.test/?foo=bar")).toBeNull();
  });

  it("decodeScenePayload returns null for garbage base64 (uncompressed)", async () => {
    expect(await decodeScenePayload("!!!not-valid-base64!!!", false)).toBeNull();
  });

  it("decodeScenePayload returns null for garbage compressed payload", async () => {
    expect(await decodeScenePayload("AAAAAAAA", true)).toBeNull();
  });

  it("decodeScenePayload returns null for an empty payload", async () => {
    expect(await decodeScenePayload("", false)).toBeNull();
    expect(await decodeScenePayload("", true)).toBeNull();
  });
});
