/**
 * Audio-chain debug bypass flags — temporary diagnostic surface for
 * isolating the source of the Safari "frrrr" hash. Activated via URL
 * query: `?audio-debug=no-limiter,no-glue,no-fx,...`.
 *
 * Not wired to UI; intended to be set by hand while listening on
 * Safari, reloading the page between tests. No session persistence —
 * removing the query disables everything.
 */

export type AudioDebugFlag =
  | "no-limiter"      // bypass the limiter DynamicsCompressor
  | "no-glue"         // bypass the glue DynamicsCompressor + makeup
  | "no-comp"         // bypass BOTH compressors
  | "no-drive"        // bypass WaveShaper + drivePre/Post
  | "no-hpf"          // bypass master HPF
  | "hpf40"           // raise HPF corner to 40 Hz (keep filter in path)
  | "no-eq"           // bypass the 3-band EQ
  | "no-width"        // bypass M/S width matrix
  | "no-loudness"     // skip the always-on loudness-meter worklet
  | "no-fx"           // skip FxChain entirely (voice -> masterBus direct)
  | "no-parallel"     // skip FxChain parallel reverb bus only
  | "no-insert-dsp"   // skip ALL serial-insert DSP wiring (worklets + native FX)
  | "no-worklet-fx"   // skip only worklet-backed inserts (plate, shimmer, freeze, granular, graincloud, hall, cistern)
  | "no-native-fx"    // skip only native-node inserts (tape, wow, sub, comb, ringmod, formant, delay)
  | "mono-voice"      // clamp to ONE voice layer and ONE interval
  | "no-master"       // skip MasterBus entirely (voice source -> destination)
  | "no-all";         // mono-voice + no-fx + no-master

const ALL_FLAGS: ReadonlySet<AudioDebugFlag> = new Set<AudioDebugFlag>([
  "no-limiter", "no-glue", "no-comp", "no-drive", "no-hpf", "hpf40",
  "no-eq", "no-width", "no-loudness", "no-fx", "no-parallel",
  "no-insert-dsp", "no-worklet-fx", "no-native-fx",
  "mono-voice", "no-master", "no-all",
]);

let cached: Set<AudioDebugFlag> | null = null;

export function readAudioDebugFlags(): Set<AudioDebugFlag> {
  if (cached) return cached;
  const set = new Set<AudioDebugFlag>();
  try {
    if (typeof window === "undefined") { cached = set; return set; }
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("audio-debug") || params.get("ab") || "";
    for (const token of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (ALL_FLAGS.has(token as AudioDebugFlag)) set.add(token as AudioDebugFlag);
    }
    if (set.has("no-all")) {
      set.add("mono-voice"); set.add("no-fx"); set.add("no-master");
    }
    if (set.has("no-comp")) {
      set.add("no-glue"); set.add("no-limiter");
    }
    if (set.size > 0) {
      // Loud banner so the user cannot forget the diagnostic is active.
      console.warn("[mdrone/audio-debug] active flags:", Array.from(set).join(", "));
    }
  } catch {
    /* noop */
  }
  cached = set;
  return set;
}

export function hasAudioDebugFlag(flag: AudioDebugFlag): boolean {
  return readAudioDebugFlags().has(flag);
}
