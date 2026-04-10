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
            macros, effects, climate.<br />
            <strong>MEDITATE</strong> — a full-screen visualizer that
            breathes with the drone.<br />
            <strong>MIXER</strong> — master bus: HPF, 3-band EQ, glue
            compression, drive, limiter.
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
            <strong>TIME</strong> — delay feedback and time.{" "}
            <strong>SUB</strong> — sub-octave bloom.{" "}
            <strong>BLOOM</strong> — attack time for new voices.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">EFFECTS CHAIN</div>
          <p className="fx-modal-desc">
            A serial chain in a fixed DSP order. The active-chain preview
            above the button grid shows the currently enabled effects in
            their actual processing order, numbered 1..N. Each button is
            a toggle — <strong>click</strong> to flip, <strong>long-press</strong>{" "}
            to open parameters. The little number badge on a lit button is
            its position in the live chain.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">CLIMATE</div>
          <p className="fx-modal-desc">
            The XY surface cross-fades macro blends so you can steer the
            timbre in two dimensions at once. Horizontal and vertical axes
            are preset-specific.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">RANDOM &amp; UNDO</div>
          <p className="fx-modal-desc">
            <strong>🎲 RND</strong> loads a gentle variation of a random
            scene. <strong>↶</strong> restores the scene that was playing
            before the last RND.
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">RECORD &amp; SHARE</div>
          <p className="fx-modal-desc">
            <strong>● REC</strong> captures the full master output to a
            WAV file. <strong>⤴ SHARE</strong> builds a link that encodes
            the current scene — open it anywhere to reconstruct the exact
            sound. Sessions can be saved, renamed, and loaded from the
            Settings modal (⚙).
          </p>

          <div className="fx-modal-divider" />
          <div className="fx-modal-section-label">KEYBOARD &amp; MIDI</div>
          <p className="fx-modal-desc">
            QWERTY keys drive the tonic (A=C, W=C#, S=D, … J=B). Z/X shift
            octave down/up. Enable Web MIDI in Settings to let an external
            keyboard drive the tonic as well.
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
