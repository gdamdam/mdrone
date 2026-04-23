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
import {
  type FlowId,
  requestCloseSettings,
  requestExpandAdvanced,
  requestFlow,
  resetAllFlows,
  resetFlow,
} from "../tutorial/state";
import { FLOWS, FLOW_LABELS } from "../tutorial/flows";

interface HelpModalProps {
  onClose: () => void;
  /** Optional — closes any parent chrome (Settings modal) before the
   *  tutorial / hint overlays render, so they aren't occluded. */
  onBeforeTutorialReveal?: () => void;
}

export function HelpModal({ onClose, onBeforeTutorialReveal }: HelpModalProps) {
  const replayFlow = (id: FlowId) => {
    // Explicit replay — clear the done flag so the renderer accepts
    // the request. Close any Settings chrome so the spotlight hits
    // real UI, not modal backdrop. For the advanced flow, also ask
    // DroneView to expand its ADVANCED disclosure.
    resetFlow(id);
    onClose();
    onBeforeTutorialReveal?.();
    requestCloseSettings();
    if (id === "advanced") requestExpandAdvanced();
    window.setTimeout(() => requestFlow(id), 80);
  };
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
          A serious microtonal drone instrument in your browser. Pick a scene,
          let it breathe, and shape it with tonic, tuning, motion, and the FX chain.
        </p>

        <div className="fx-modal-params help-modal-body">
          <div className="fx-modal-section-label">TUTORIALS</div>
          <p className="fx-modal-desc">
            Three short guided tours. Each is 3–4 steps and can be
            replayed any time.
          </p>
          <div className="tutorial-help-row">
            {(Object.keys(FLOWS) as FlowId[]).map((id) => (
              <button
                key={id}
                type="button"
                className="header-btn"
                onClick={() => replayFlow(id)}
                title={`Replay the ${FLOW_LABELS[id].toLowerCase()} tour (${FLOWS[id].steps.length} steps)`}
              >
                {FLOW_LABELS[id].toUpperCase()}
              </button>
            ))}
          </div>
          <div className="tutorial-help-row" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="header-btn"
              onClick={resetAllFlows}
              title="Clear all tutorial completion flags so every flow is re-eligible to auto-trigger"
            >
              RESET ALL TUTORIALS
            </button>
          </div>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">GETTING STARTED</div>
          <p className="fx-modal-desc">
            First fresh launch opens the <strong>Welcome</strong> preset
            — drag WEATHER, and the room opens. After that, tap any{" "}
            <strong>preset</strong> in the panel at the top to load a
            scene. Hit <strong>▶ HOLD</strong> (or spacebar) to start and
            stop the drone. Everything — tonic, mode, macros, effects —
            can be tweaked while the drone is sounding.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">VIEWS</div>
          <p className="fx-modal-desc">
            <strong>DRONE</strong> — the instrument: presets, tonic,
            mode, macros, effects, climate, history slots, scale editor.
            <br />
            <strong>MEDITATE</strong> — 24 full-screen visualizers in
            four groups (GEOMETRIC / SPECTRAL / FIELD / HYPNOTIC).
            Dropdown picks one; double-click the canvas to cycle.
            Toolbar: ⛶ FULLSCREEN, ↗ POP OUT, 🎲 RND. Most accrete
            detail over minutes rather than react per frame; the README
            has the per-visualizer breakdown.
            <br />
            <strong>MIXER</strong> — master bus: HPF, 3-band EQ, glue
            compression, drive, brickwall limiter with ceiling, SAFE
            (headphone-safe) clamp, CLIP LED, LUFS-S + peak meter, trim.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">TONIC &amp; MODE</div>
          <p className="fx-modal-desc">
            The tonic wheel sets the root pitch. MODE picks which scale
            intervals stack on the root. Toggle to <strong>MICROTONAL</strong>
            {" "}and the mode tab swaps for a tuning + relation pair
            (e.g. Just 5-limit / Drone Triad) — 6 built-in tuning tables
            plus 16 curated authored ones (Pythagorean, Kirnberger III,
            31-TET, Yaman, Bayati, the house <strong>mdrone Signature</strong>
            {" "}hybrid, and more). The DETUNE sliders below fine-tune
            individual resolved intervals in cents; the panel auto-
            surfaces whenever a preset or share URL arrives with active
            offsets. Fine-tune updates retune voices smoothly in real time.
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
            The main tactile control — drag to change the room:
            X axis = <strong>DARK ↔ BRIGHT</strong> (filter + presence),
            Y axis = <strong>STILL ↔ MOVING</strong> (LFO depth + drift).
            Three visual modes (Settings): Waveform (circular oscilloscope),
            Flow Field (particle streams), Minimal (cursor only).
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">LFO 2 · FLICKER</div>
          <p className="fx-modal-desc">
            A second amplitude modulator inside <em>ADVANCED</em>,
            reaching from <strong>0.5 Hz</strong> (slow swell) to{" "}
            <strong>45 Hz</strong> (gamma-band buzz). The rate slider
            has coloured zones (δ delta / θ theta / α alpha / β beta /
            γ gamma) and landmark ticks you can tap to snap — plus a
            dashed <em>7.83 Hz</em> Schumann marker.
            Frequency is integer-locked to the breathing LFO (LFO 1)
            so the two modulators stay in constant relative phase.
            <br />
            <strong>● ON / OFF</strong> is the power button.{" "}
            <strong>AM</strong> modulates voice gain (works on speakers).
            {" "}<strong>DICHOTIC</strong> splits L/R pitch per voice;
            when it (or BOTH) is active a <strong>SPREAD</strong>{" "}
            slider appears below the mode row and the{" "}
            <strong>HEADPHONES</strong> badge at the top lights up.{" "}
            <strong>BOTH</strong> does both. The subtitle describes
            what the current setting will sound like, prefixed{" "}
            <em>(off)</em> while the power button is off; the line
            underneath reads{" "}
            <code>locked ×k → N Hz (breathing N Hz)</code> — the
            integer multiplier that keeps the two modulators in
            constant relative phase.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">RANDOM · GOOD DRONE · MUTATE</div>
          <p className="fx-modal-desc">
            <strong>🎲 RND</strong> loads a random scene. The first
            three RND clicks per session draw from a curated{" "}
            <em>arrival</em> pool (immediate beauty); after that it
            opens up to the full safe-random library.
            <br />
            <strong>GOOD DRONE</strong> (scene-actions row, next to
            MUTATE) is a guided randomize for the tuning layer only —
            picks a tuning + relation from a drone-friendly pool and
            adds ±2–5 ¢ detune on every non-root interval. Preset
            voicing is preserved. One click, instantly beautiful
            microtonal state.
            <br />
            <strong>MUTATE</strong> perturbs the current scene's
            macros, voice mix, and effect levels by the intensity
            slider — small intensity for a nudge, large for a hard
            shake. RND and MUTATE both reset the URL-deterministic
            evolve seed so reloads play back the same drift. Undo is
            global.
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
            (visible in MICROTONAL mode) opens the Scale Editor. You
            author a 13-degree tuning table in cents (P1 through P8),
            save it by name, and apply it as active. Shared URLs bundle
            the full cents array under the scene's explicit tuning id,
            so recipients reproduce the authored pitch grid exactly —
            even on older app versions that don't yet ship the authored
            tuning locally.
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
          <div className="fx-modal-section-label">JOURNEY · phased arc</div>
          <p className="fx-modal-desc">
            <strong>JOURNEY</strong> picks an authored multi-phase arc:{" "}
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
            output to a <strong>24-bit stereo WAV</strong> via a
            dedicated AudioWorklet tap — samples are bit-identical to
            what the engine produced, no intermediate codec. <strong>REC MOTION</strong> is{" "}
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
            octave. CC mapping covers ~46 targets grouped by{" "}
            <em>Macros / Weather / Mixer / Voices / Effects / Triggers
            / Presets</em>. Click a target, move a knob to learn.
            Triggers (PANIC, RND, MUTATE, PRESET ◀ / ▶, GROUP ◀ / ▶)
            fire once when the CC crosses ≥ 64; HOLD follows sustain-
            pedal state. Defaults: CC1 → WEATHER Y, CC2 → WEATHER X,
            CC64 → HOLD, CC71-76 → macros — every other target is
            unassigned until you bind it.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">PALETTE</div>
          <p className="fx-modal-desc">
            Four palettes under <em>Settings → PALETTE</em>: three
            warm dark themes (<strong>Ember</strong>,{" "}
            <strong>Copper</strong>, <strong>Dusk</strong>) and one
            light (<strong>Parchment</strong>) for bright rooms and
            stages where dark themes wash out.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">TEMPO SYNC · Ableton Link</div>
          <p className="fx-modal-desc">
            The breathing LFO RATE can lock to Ableton Link tempo. A
            chip next to RATE cycles <em>FREE / 1/1 / 1/2 / 1/4 / 1/8
            / 1/16</em>; any non-FREE mode runs one LFO cycle per note
            at the Link session tempo. Enable Link in{" "}
            <em>Settings → ABLETON LINK</em> and run the bridge
            companion (reused from mpump, one download covers both):{" "}
            <a
              href="https://github.com/gdamdam/mpump/releases"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/gdamdam/mpump/releases
            </a>.
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
