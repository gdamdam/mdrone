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

/** 12-note pitch class. A4 = 440 Hz reference. */
export type PitchClass =
  | "C" | "C#" | "D" | "D#" | "E" | "F"
  | "F#" | "G" | "G#" | "A" | "A#" | "B";
