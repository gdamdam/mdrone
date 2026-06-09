/**
 * BUG 2 — mute/solo stash desyncs with scene loads. Mute/solo state and
 * the stashed pre-mute levels live outside the scene reducer ("Variant
 * C prototype"). Loading a preset/snapshot while a voice was muted left
 * the mute flag set, and un-muting then restored a stale pre-mute level
 * from the PREVIOUS scene over the freshly loaded one. On load, the
 * stash must be dropped and the flags cleared: the loaded scene's
 * levels are authoritative.
 */
import { describe, it, expect } from "vitest";
import {
  muteSoloAfterSceneLoad,
  type MuteSoloLocalState,
} from "../../src/components/droneViewLogic";
import type { VoiceType } from "../../src/engine/VoiceBuilder";

describe("muteSoloAfterSceneLoad", () => {
  it("drops the pre-mute stash so unmute can't restore a previous scene's level", () => {
    const prev: MuteSoloLocalState = {
      mutedVoices: new Set<VoiceType>(["tanpura"]),
      soloVoice: null,
      muteStash: { tanpura: 0.8 }, // level from the PREVIOUS scene
      soloStash: {},
    };
    const next = muteSoloAfterSceneLoad(prev);
    // Stale stash gone: the unmute path restores stash[id] only when it
    // is a number, so an empty stash means no stale write can happen.
    expect(next.muteStash.tanpura).toBeUndefined();
    expect(Object.keys(next.muteStash)).toHaveLength(0);
  });

  it("clears the mute flags — a loaded scene should sound as authored", () => {
    const prev: MuteSoloLocalState = {
      mutedVoices: new Set<VoiceType>(["tanpura", "noise"]),
      soloVoice: null,
      muteStash: { tanpura: 0.8, noise: 0.4 },
      soloStash: {},
    };
    const next = muteSoloAfterSceneLoad(prev);
    expect(next.mutedVoices.size).toBe(0);
  });

  it("clears solo state and its stash too", () => {
    const prev: MuteSoloLocalState = {
      mutedVoices: new Set<VoiceType>(),
      soloVoice: "reed",
      muteStash: {},
      soloStash: { tanpura: 0.7, piano: 0.5 },
    };
    const next = muteSoloAfterSceneLoad(prev);
    expect(next.soloVoice).toBeNull();
    expect(Object.keys(next.soloStash)).toHaveLength(0);
  });

  it("does not mutate the previous state object", () => {
    const muted = new Set<VoiceType>(["tanpura"]);
    const prev: MuteSoloLocalState = {
      mutedVoices: muted,
      soloVoice: "reed",
      muteStash: { tanpura: 0.8 },
      soloStash: { piano: 0.5 },
    };
    muteSoloAfterSceneLoad(prev);
    expect(muted.has("tanpura")).toBe(true);
    expect(prev.muteStash.tanpura).toBe(0.8);
    expect(prev.soloVoice).toBe("reed");
  });
});
