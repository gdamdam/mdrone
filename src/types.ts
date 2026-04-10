/** The views mdrone supports — instrument, master mixer, meditation. */
export type ViewMode = "drone" | "mixer" | "meditate";

/** Mode scale — biases which partials/intervals are musically sensible. */
export type ScaleId =
  | "drone"
  | "major"
  | "minor"
  | "dorian"
  | "phrygian"
  | "just5"
  | "pentatonic"
  | "meantone"
  | "harmonics"
  | "maqam-rast"
  | "slendro";

/** Microtuning table id — selects the pitch grid (cents per degree). */
export type TuningId =
  | "equal"
  | "just5"
  | "meantone"
  | "harmonics"
  | "maqam-rast"
  | "slendro";

/** Interval-relation preset — selects which degrees from the tuning to sound. */
export type RelationId =
  | "unison"
  | "tonic-fifth"
  | "tonic-fourth"
  | "drone-triad"
  | "harmonic-stack";

/** 12-note pitch class. A4 = 440 Hz reference. */
export type PitchClass =
  | "C" | "C#" | "D" | "D#" | "E" | "F"
  | "F#" | "G" | "G#" | "A" | "A#" | "B";
