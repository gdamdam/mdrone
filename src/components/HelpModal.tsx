/**
 * HelpModal — a compact reference card for the instrument.
 *
 * Opened from the ? button inside the Settings modal header. Reuses
 * the fx-modal-* classes for visual consistency with every other
 * modal (settings, volume, effects). Content is static prose grouped
 * into short topical sections — the goal is orientation, not an
 * exhaustive manual.
 */

import { APP_VERSION } from "../config";

interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div className="fx-modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fx-modal-header">
          <div className="fx-modal-title">Help · mdrone v{APP_VERSION}</div>
          <button
            className="fx-modal-close"
            onClick={onClose}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
        <p className="fx-modal-desc">
          A browser drone instrument. Pick a scene, let it breathe, and
          shape it with the tonic wheel, macros, and the serial FX chain.
        </p>

        <div className="fx-modal-params help-modal-body">
          <div className="fx-modal-section-label">GETTING STARTED</div>
          <p className="fx-modal-desc">
            Tap any <strong>preset</strong> in the panel at the top to load
            a scene. Hit <strong>▶ HOLD</strong> (or the spacebar-equivalent
            in the header) to start and stop the drone. Everything else —
            tonic, mode, macros, effects — can be tweaked while the drone
            is sounding.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">VIEWS</div>
          <p className="fx-modal-desc">
            <strong>DRONE</strong> — the instrument: presets, tonic, mode,
            macros, effects, climate, history slots, scale editor.<br />
            <strong>MEDITATE</strong> — a full-screen pitch mandala.
            Twelve radial arcs by pitch class, accrued over a 30 s
            long integrator. Deliberately slow — the visual lags behind
            the sound, matching what's present over time, not at the
            instant.<br />
            <strong>MIXER</strong> — master bus: HPF, 3-band EQ, glue
            compression, drive, brickwall limiter with ceiling, SAFE
            (headphone-safe) clamp, CLIP LED, LUFS-S + peak meter, trim.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">TONIC &amp; MODE</div>
          <p className="fx-modal-desc">
            The tonic wheel sets the root pitch. MODE picks which scale
            intervals stack on the root. For microtonal work, the tuning
            and relation selects (e.g. Just 5-limit / Just Triad) replace
            the scale with a set of tuned intervals; the DETUNE sliders
            below fine-tune individual intervals in cents. Fine-tune
            updates retune voices smoothly in real time.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">MACROS</div>
          <p className="fx-modal-desc">
            <strong>DRIFT</strong> — per-voice pitch wander.{" "}
            <strong>AIR</strong> — reverb wet amount (PLATE/HALL/SHIMMER).{" "}
            <strong>TIME</strong> — climate LFO rate.{" "}
            <strong>SUB</strong> — voice sub layer weight (separate from
            the SUB effect, which is a true octave-down subharmonic).{" "}
            <strong>BLOOM</strong> — attack time for new voices.{" "}
            <strong>GLIDE</strong> — pitch slide when the tonic changes.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">EFFECTS CHAIN</div>
          <p className="fx-modal-desc">
            A 14-effect chain. The active-chain preview above the button
            grid shows enabled effects in their actual processing order,
            numbered 1..N. Each button is a toggle —{" "}
            <strong>click</strong> to flip, <strong>long-press</strong>{" "}
            to open parameters (every effect has at least an AMOUNT
            knob). <strong>Drag</strong> a button onto another to
            reorder the chain. Two granular slots:{" "}
            <strong>GRAIN</strong> is the drone-smooth cloud,{" "}
            <strong>CLOUD</strong> is the classic grain stutter with
            pitches snapped to the drone scale.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">WEATHER · XY control</div>
          <p className="fx-modal-desc">
            The signature expressive control. Drag to change the room:
            X axis = <strong>DARK ↔ BRIGHT</strong> (filter + presence),
            Y axis = <strong>STILL ↔ MOVING</strong> (LFO depth + drift).
            Three visual modes (Settings): Waveform (circular oscilloscope),
            Flow Field (particle streams), Minimal (cursor only).
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">RANDOM &amp; MUTATE</div>
          <p className="fx-modal-desc">
            <strong>🎲 RND</strong> loads a gentle variation of a random
            scene. <strong>MUTATE</strong> (in the GESTURES panel)
            perturbs the current scene's macros, voice mix and effect
            levels by the intensity slider next to it — small intensity
            for a nudge, large for a hard shake. Both reset the
            URL-deterministic evolve seed so reloads play back the same
            drift. Undo is global and recovers whatever state came
            before (see UNDO / REDO + A/B below).
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">UNDO / REDO + A/B</div>
          <p className="fx-modal-desc">
            The SHAPE panel carries a 50-entry history of scene state,
            debounced at 400 ms so a slider drag doesn't push 60 frames
            per second. <strong>↺</strong> /{" "}
            <strong>↻</strong> (or <strong>Cmd/Ctrl+Z</strong> /{" "}
            <strong>Cmd/Ctrl+Shift+Z</strong>) move through it.
            Two comparison slots — <strong>SAVE A</strong> /{" "}
            <strong>A</strong> and <strong>SAVE B</strong> /{" "}
            <strong>B</strong> — snap the current scene into a named
            slot and recall it later so you can tweak freely, swap to
            compare, and return without loss.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">SCALE EDITOR</div>
          <p className="fx-modal-desc">
            The <strong>✎</strong> button next to the tuning dropdown
            (visible when microtuning mode is active — a tuning and a
            relation are both selected) opens the Scale Editor. Six
            builtin tunings (equal, just 5-limit, meantone, harmonics,
            maqam rast, slendro) and six relations ship by default; the
            editor lets you author a 13-degree tuning table in cents
            (P1 through P8), save it by name, and apply it as active.
            Custom tunings travel with share URLs — recipients hear
            your authored pitch grid, not a silent fallback to equal.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">TANPURA TUNINGS</div>
          <p className="fx-modal-desc">
            When the TANPURA voice is active, the SHAPE panel exposes a
            <em> tuning</em> dropdown for the four plucked strings:
            <strong> Unison</strong> (all strings on the tonic),
            <strong> Sa Pa</strong> (tonic + fifth — the classical Hindustani default),
            <strong> Sa Ma</strong> (tonic + fourth), or
            <strong> Sa Ni</strong> (tonic + major seventh, for ragas that
            want a rising sense of motion). Changing the tuning rebuilds
            the tanpura voices smoothly over a short crossfade.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">MIXER &amp; LOUDNESS</div>
          <p className="fx-modal-desc">
            The master bus has a <strong>worklet brickwall limiter</strong>{" "}
            with ceiling and release — it holds the ceiling without
            pumping. <strong>SAFE</strong> clamps the output trim to
            −6 dBFS for headphone listening. The <strong>CLIP LED</strong>{" "}
            taps the <em>pre-limiter</em> signal, so it lights on input
            overshoot (you're driving too hot), not on the brickwall
            doing its job. <strong>LUFS-S</strong> is EBU R128
            K-weighted short-term loudness (3 s window); <strong>PEAK</strong>{" "}
            is sample peak. Both refresh at ~30 Hz.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">JOURNEY · ritual phases</div>
          <p className="fx-modal-desc">
            <strong>JOURNEY</strong> picks an authored multi-phase walk:{" "}
            <em>arrival → bloom → suspension → dissolve</em>. Pick one
            from the dropdown above the preset grid (morning, evening,
            dusk, void). Each phase gently steers a small set of macros
            toward authored targets over a few minutes; past the
            dissolve the scene rests on the final settings. Journey is
            deterministic from the share URL — two visitors hear the
            same sequence from phase 0.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">PARTNER · sympathetic drone</div>
          <p className="fx-modal-desc">
            <strong>PARTNER</strong> adds an optional second voice layer
            at a fixed musical relation to the main drone:{" "}
            <em>fifth</em> (+702 ¢), <em>octave-up</em> (+1200 ¢),{" "}
            <em>octave-down</em> (-1200 ¢), or <em>beat-detune</em>{" "}
            (+7 ¢ for slow audible beating). The partner doubles the
            voice count while it's on — keep an eye on CPU on lower-end
            devices.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">RECORD &amp; SHARE</div>
          <p className="fx-modal-desc">
            <strong>● REC</strong> (header) captures the full master
            output to a WAV file. <strong>REC MOTION</strong> is{" "}
            <em>opt-in</em> — enable it in Settings → Advanced to
            reveal the button in the preset panel. When on, it records
            meaningful gestures — tonic / octave / macro / climate /
            lfo changes — into the next share URL, capped at 60 s and
            200 events. Loading a share URL with a recording replays
            those gestures deterministically against the starting
            scene. <strong>⤴ SHARE</strong> builds a link that encodes
            the current scene plus any motion recording — open it
            anywhere to reconstruct the exact sound. Sessions can be
            saved, renamed, and loaded from the Settings modal (⚙).
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">KEYBOARD &amp; MIDI</div>
          <p className="fx-modal-desc">
            <strong>QWERTY tonic:</strong> A=C, W=C#, S=D, E=D#, D=E,
            F=F, T=F#, G=G, Y=G#, H=A, U=A#, J=B. Z/X = octave down/up.
            Spacebar = HOLD toggle. <strong>Cmd/Ctrl+Z</strong> undoes,
            <strong> Cmd/Ctrl+Shift+Z</strong> redoes.
            <br /><br />
            <strong>&lt; / &gt;</strong> = previous / next preset in the
            current group.
            <br /><br />
            <strong>MIDI:</strong> Enable in Settings. Note-on → tonic +
            octave. CC mapping with learn mode: click a target
            (WEATHER X/Y, DRIFT, AIR, etc.), move a physical knob to
            assign. Defaults: CC1 → WEATHER Y, CC2 → WEATHER X,
            CC64 → HOLD, CC71-76 → macros.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">ABOUT</div>
          <p className="fx-modal-desc">
            mdrone is free and open source under AGPL-3.0. Source and
            issues:{" "}
            <a
              href="https://github.com/gdamdam/mdrone"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/gdamdam/mdrone
            </a>
            . Session state lives only in your browser's localStorage —
            nothing is uploaded anywhere.
          </p>
        </div>
      </div>
    </div>
  );
}
