/** The two views mdrone supports — drone instrument and master mixer. */
export type ViewMode = "drone" | "mixer";

/** Mode scale — biases which partials/intervals are musically sensible. */
export type ScaleId =
  | "drone"
  | "major"
  | "minor"
  | "dorian"
  | "phrygian"
  | "just5"
  | "pentatonic";

/** 12-note pitch class. A4 = 440 Hz reference. */
export type PitchClass =
  | "C" | "C#" | "D" | "D#" | "E" | "F"
  | "F#" | "G" | "G#" | "A" | "A#" | "B";
