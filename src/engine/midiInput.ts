/**
 * midiInput — thin Web MIDI wrapper.
 *
 * Handles: access request, input enumeration, live connect/disconnect
 * events, and note-on fan-out to a user-supplied callback. Only
 * note-on (0x90) with velocity > 0 is reported; note-off, CC, pitch
 * bend, and system messages are ignored.
 *
 * Usage from React is via the useMidiInput hook below, which owns
 * the MIDIAccess lifecycle and cleans up listeners on unmount.
 */

import { useEffect, useRef, useState, useCallback } from "react";

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
}

export interface UseMidiInputResult {
  supported: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  devices: MidiDevice[];
  lastNote: number | null;
  error: string | null;
}

/** Convert a MIDI note number (0..127) to pitch class + octave.
 *  MIDI 60 = C4, following the common convention the rest of the
 *  app already uses for A4 = 440 Hz. */
export function midiNoteToPitch(note: number): {
  pitchClass: "C" | "C#" | "D" | "D#" | "E" | "F" | "F#" | "G" | "G#" | "A" | "A#" | "B";
  octave: number;
} {
  const classes = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  ] as const;
  const pitchClass = classes[((note % 12) + 12) % 12];
  const octave = Math.floor(note / 12) - 1;
  return { pitchClass, octave };
}

// Minimal surface we use — just a forEach-capable inputs collection.
// This avoids requiring the full Map<K,V> interface so a real browser
// MIDIInputMap assigns cleanly.
interface MidiInputsLike {
  forEach(cb: (input: MIDIInputLike) => void): void;
}
type MidiAccessLike = {
  inputs: MidiInputsLike;
  onstatechange: ((e: { port: MIDIInputLike }) => void) | null;
};

// Minimal local typings — avoid requiring @types/webmidi. We use
// loose string/null unions so the real browser MIDIInput (whose
// name/manufacturer can be `null`) assigns cleanly.
interface MIDIInputLike {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  state: "connected" | "disconnected";
  onmidimessage: ((e: { data: Uint8Array }) => void) | null;
}

export function useMidiInput(
  onNote: (note: number, velocity: number) => void,
): UseMidiInputResult {
  const [supported] = useState(() =>
    typeof navigator !== "undefined" && typeof (navigator as Navigator & {
      requestMIDIAccess?: () => Promise<MidiAccessLike>;
    }).requestMIDIAccess === "function",
  );
  const [enabled, setEnabledState] = useState(false);
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [lastNote, setLastNote] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accessRef = useRef<MidiAccessLike | null>(null);
  const onNoteRef = useRef(onNote);
  const enabledRef = useRef(enabled);
  useEffect(() => { onNoteRef.current = onNote; });
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const refreshDevices = useCallback(() => {
    const a = accessRef.current;
    if (!a) return;
    const list: MidiDevice[] = [];
    a.inputs.forEach((inp) => {
      list.push({
        id: inp.id,
        name: inp.name ?? "MIDI Input",
        manufacturer: inp.manufacturer ?? "",
        state: inp.state,
      });
    });
    setDevices(list);
  }, []);

  const attachListeners = useCallback(() => {
    const a = accessRef.current;
    if (!a) return;
    a.inputs.forEach((inp) => {
      inp.onmidimessage = (e) => {
        const [status, d1, d2] = e.data;
        // Note-on (0x90) with non-zero velocity. Any channel.
        if ((status & 0xf0) === 0x90 && d2 > 0) {
          setLastNote(d1);
          onNoteRef.current(d1, d2);
        }
      };
    });
  }, []);

  const detachListeners = useCallback(() => {
    const a = accessRef.current;
    if (!a) return;
    a.inputs.forEach((inp) => { inp.onmidimessage = null; });
  }, []);

  const setEnabled = useCallback(
    (on: boolean) => {
      if (!supported) {
        setError("Web MIDI is not available in this browser.");
        return;
      }
      if (on && !accessRef.current) {
        (navigator as Navigator & {
          requestMIDIAccess: () => Promise<MidiAccessLike>;
        })
          .requestMIDIAccess()
          .then((access) => {
            // Browser MIDIAccess uses richer types than our minimal
            // local interface; cast through unknown to bypass the
            // structural mismatch (onmidimessage event shape, etc.).
            accessRef.current = access as unknown as MidiAccessLike;
            access.onstatechange = () => {
              refreshDevices();
              if (enabledRef.current) attachListeners();
            };
            refreshDevices();
            attachListeners();
            setEnabledState(true);
            setError(null);
          })
          .catch((e: Error) => {
            setError(e?.message ?? "MIDI access denied");
            setEnabledState(false);
          });
        return;
      }
      if (on) {
        attachListeners();
        setEnabledState(true);
      } else {
        detachListeners();
        setEnabledState(false);
      }
    },
    [supported, refreshDevices, attachListeners, detachListeners],
  );

  useEffect(() => {
    return () => {
      const a = accessRef.current;
      if (a) {
        a.inputs.forEach((inp) => { inp.onmidimessage = null; });
        a.onstatechange = null;
      }
    };
  }, []);

  return { supported, enabled, setEnabled, devices, lastNote, error };
}
