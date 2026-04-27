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

  it("preserves FM params through encode → decode round-trip", async () => {
    const scene = freshScene();
    scene.drone.fmRatio = 3.5;
    scene.drone.fmIndex = 4.5;

    const { key, value } = await encodeScenePayload(scene);
    const extracted = extractScenePayloadFromUrl(
      `https://example.test/?${key}=${encodeURIComponent(value)}`,
    );
    const decoded = await decodeScenePayload(extracted!.payload, extracted!.compressed);
    expect(decoded!.drone.fmRatio).toBe(3.5);
    expect(decoded!.drone.fmIndex).toBe(4.5);
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

  it("decodeScenePayload returns null when payload is JSON but not a scene object", async () => {
    // Valid base64 of `42` and `[]` and `"hello"` — JSON parses fine but
    // normalizePortableScene must reject anything that isn't a record
    // with drone+mixer subrecords. These are the partial-corruption-
    // after-successful-decode cases the audit flagged.
    const cases = ["42", "[]", '"hello"', "null", "true"];
    for (const json of cases) {
      const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      expect(await decodeScenePayload(b64, false)).toBeNull();
    }
  });

  it("decodeScenePayload returns null when the JSON object is missing drone or mixer", async () => {
    const cases = [
      "{}",
      '{"drone":{}}',         // mixer missing
      '{"mixer":{}}',         // drone missing
      '{"drone":null,"mixer":{}}',
      '{"drone":{},"mixer":"not-an-object"}',
    ];
    for (const json of cases) {
      const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      expect(await decodeScenePayload(b64, false)).toBeNull();
    }
  });
});

describe("normalizePortableScene defends against bad input", () => {
  it("returns null for non-record inputs", () => {
    expect(normalizePortableScene(null)).toBeNull();
    expect(normalizePortableScene(undefined)).toBeNull();
    expect(normalizePortableScene(42)).toBeNull();
    expect(normalizePortableScene("string")).toBeNull();
    expect(normalizePortableScene([])).toBeNull();
    expect(normalizePortableScene(true)).toBeNull();
  });

  it("drops a customTuning whose degrees array is the wrong length", () => {
    const s = normalizePortableScene({
      drone: {},
      mixer: {},
      fx: {},
      ui: {},
      customTuning: { id: "custom:bogus", label: "Bogus", degrees: [0, 100, 200] },
    });
    expect(s).not.toBeNull();
    expect(s!.customTuning).toBeUndefined();
  });

  it("preserves a customTuning with the required 13-degree shape", () => {
    const degrees = Array.from({ length: 13 }, (_, i) => i * 100);
    const s = normalizePortableScene({
      drone: {},
      mixer: {},
      fx: {},
      ui: {},
      customTuning: { id: "custom:ok", label: "OK", degrees },
    });
    expect(s).not.toBeNull();
    expect(s!.customTuning?.degrees).toHaveLength(13);
    expect(s!.customTuning?.degrees[12]).toBe(1200);
  });
});
