/**
 * HelpModal — three-tab reference: Play · Reference · Concepts.
 *
 * Play (default) is tuned for the casual visitor: tutorial replays,
 * a 30-second getting-started card, keyboard shortcuts. Reference
 * holds the condensed feature list grouped by surface. Concepts is
 * one paragraph per domain concept (microtonality, cents, modes,
 * LFO, entrainment, drone music, Ableton Link) with a single
 * Wikipedia link each — no link spam elsewhere in the modal.
 *
 * Reuses the fx-modal-* classes for consistency with Settings / FX
 * modals and the settings-tabs class for the tab strip.
 */

import { useEffect, useId, useRef, useState } from "react";
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
   *  tutorial overlays render, so they aren't occluded. */
  onBeforeTutorialReveal?: () => void;
}

type Tab = "play" | "reference" | "concepts";

/** Wikipedia link helper — all external links from this modal go to
 *  Wikipedia, target=_blank, noopener noreferrer, never tracked. */
function W({ slug, children }: { slug: string; children: React.ReactNode }) {
  return (
    <a
      href={`https://en.wikipedia.org/wiki/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

export function HelpModal({ onClose, onBeforeTutorialReveal }: HelpModalProps) {
  const [tab, setTab] = useState<Tab>("play");
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && typeof opener.focus === "function") {
        try { opener.focus(); } catch { /* ok */ }
      }
    };
  }, [onClose]);

  const replayFlow = (id: FlowId) => {
    resetFlow(id);
    onClose();
    onBeforeTutorialReveal?.();
    requestCloseSettings();
    if (id === "advanced") requestExpandAdvanced();
    window.setTimeout(() => requestFlow(id), 80);
  };

  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div
        className="fx-modal help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fx-modal-header">
          <div className="fx-modal-title" id={titleId}>Help</div>
          <button ref={closeRef} className="fx-modal-close" onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
        </div>

        <div className="fx-modal-params help-modal-body">
          <div className="help-tabs" role="tablist" aria-label="Help sections">
            {([
              ["play", "PLAY"],
              ["reference", "REFERENCE"],
              ["concepts", "CONCEPTS"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "help-tab help-tab-active" : "help-tab"}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "play" && <PlayTab onReplay={replayFlow} />}
          {tab === "reference" && <ReferenceTab />}
          {tab === "concepts" && <ConceptsTab />}
        </div>
      </div>
    </div>
  );
}

/* ─────────── Play tab ─────────── */

function PlayTab({ onReplay }: { onReplay: (id: FlowId) => void }) {
  return (
    <>
      <p className="fx-modal-desc help-lede">
        A browser drone instrument — no install, no account. Tap <strong>HOLD</strong>,
        drag <strong>WEATHER</strong>, pick a preset. Everything else is optional.
      </p>

      <div className="fx-modal-section-label">GUIDED TOURS</div>
      <p className="fx-modal-desc">
        Each tour is 2–6 short steps — tap to start, × to dismiss.
      </p>
      <div className="tutorial-help-row">
        {(Object.keys(FLOWS) as FlowId[]).map((id) => (
          <button
            key={id}
            type="button"
            className="header-btn"
            onClick={() => onReplay(id)}
            title={`Replay the ${FLOW_LABELS[id].toLowerCase()} tour (${FLOWS[id].steps.length} steps)`}
          >
            {FLOW_LABELS[id].toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          className="header-btn"
          onClick={resetAllFlows}
          title="Clear every tutorial's completion flag so offer pills re-appear"
        >
          RESET ALL
        </button>
      </div>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">30-SECOND START</div>
      <ul className="help-list">
        <li><strong>HOLD</strong> (or <kbd>Space</kbd>) starts the drone.</li>
        <li><strong>WEATHER</strong> pad — drag to change brightness (X) and motion (Y).</li>
        <li><strong>Presets</strong> — tap the scene name at the top to browse, or <strong>RND</strong> for a safe random scene.</li>
        <li><strong>◉ MEDITATE</strong> (next to HOLD) — toggles a live visualizer tile above the WEATHER pad. Tap the canvas to expand to fullscreen.</li>
        <li><strong>MIXER</strong> (next to VOL) — opens the master bus drawer.</li>
      </ul>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">KEYBOARD</div>
      <ul className="help-list help-list-compact">
        <li><kbd>Space</kbd> — HOLD toggle</li>
        <li><kbd>&lt;</kbd> / <kbd>&gt;</kbd> — previous / next preset in group</li>
        <li><kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd> — undo · <kbd>⌘/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> — redo</li>
        <li>QWERTY tonic: A=C, W=C♯, S=D, E=D♯… (toggle the ⌨ button). <kbd>Z</kbd>/<kbd>X</kbd> shift octave.</li>
      </ul>
    </>
  );
}

/* ─────────── Reference tab ─────────── */

function ReferenceTab() {
  return (
    <>
      <div className="fx-modal-section-label">SURFACES</div>
      <ul className="help-list">
        <li><strong>DRONE</strong> — the instrument. Presets, tonic/mode, SHAPE macros, FX chain, ADVANCED (tuning + LFO).</li>
        <li><strong>MEDITATE</strong> — 25 visualizers in 4 groups by function: HARMONIC · LANDSCAPE · RITUAL · VOID/HYPNOTIC (B&amp;W first, then colour within each). All in one warm parchment / ember palette. Toggled inline via the header <strong>◉ MEDITATE</strong> button. Tile navigator: dropdown · ◂ ▸ cycle · ↻ reset · ↗ open. Fullscreen HUD adds 🎲 random + ↗ pop out. Screen wake-lock keeps the display on while MEDITATE is open. <em>DREAM MACHINE</em> uses a 10 Hz strobe — if your OS asks for reduced motion, it's automatically replaced with a slow ~0.2 Hz breath.</li>
        <li><strong>MIXER</strong> — master bus: HPF, 3-band EQ, <strong>MUD</strong> trim toggle (-3.5 dB @ 300 Hz, on by default), glue, drive, look-ahead brickwall limiter + ceiling, <strong>WIDTH</strong> (always-on bass-mono fold under 120 Hz), <strong>ROOM</strong> (parallel cathedral-IR send), <strong>COLOR</strong> (parallel saturation + air-band exciter). <strong>SAFE</strong> clamps to −6 dBFS for headphones.</li>
      </ul>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">SOUND</div>
      <ul className="help-list">
        <li><strong>Tonic</strong> — the root pitch everything colours.</li>
        <li><strong>MODE</strong> — SCALE stacks a diatonic mode; MICROTONAL swaps the whole tuning system (Pythagorean, Kirnberger III, 31-TET, Yaman, Bayati, Signature, …).</li>
        <li><strong>SHAPE macros</strong> — MOTION (MORPH · EVOLVE · TIME), BODY (DRIFT · AIR · SUB · BLOOM · GLIDE). The ? in the SHAPE header toggles inline hints.</li>
        <li><strong>Voices</strong> — TANPURA · REED · METAL · AIR · PIANO · FM · AMP · NOISE. Level sliders plus per-voice colour where it matters (e.g. NOISE COLOR). Each voice carries a sub-Hz pitch-drift LFO (~±2 cents) so stacks breathe; multiple intervals per layer are spread across the stereo field for true ensemble width.</li>
        <li><strong>Tanpura tuning</strong> — when TANPURA is active: Unison · Sa Pa · Sa Ma · Sa Ni. Rebuilds smoothly over a short crossfade.</li>
      </ul>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">MOTION</div>
      <ul className="help-list">
        <li><strong>LFO</strong> (ADVANCED) — breathing volume swell. Pick a waveform, set RATE, DEPTH. SYNC chip locks to Ableton Link tempo; ÷N chip locks rate to tonic Hz.</li>
        <li><strong>LFO 2 · FLICKER</strong> — second modulator from 0.5 Hz (swell) to 45 Hz (gamma buzz). AM / DICHOTIC / BOTH modes. Integer-locked to LFO 1 for constant relative phase.</li>
        <li><strong>WEATHER</strong> pad — X = DARK ↔ BRIGHT, Y = STILL ↔ MOVING. Three visual styles (Waveform · Flow Field · Minimal) in Settings → APPEARANCE.</li>
        <li><strong>JOURNEY</strong> — authored multi-phase arc (arrival → bloom → suspension → dissolve). Deterministic from share URL.</li>
        <li><strong>PARTNER</strong> — sympathetic second voice layer at fixed interval (fifth / octave-up / octave-down / beat-detune). Doubles voice count.</li>
      </ul>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">EFFECTS</div>
      <ul className="help-list">
        <li>14-effect chain. <strong>Click</strong> to toggle, <strong>long-press</strong> for parameters, <strong>drag</strong> to reorder.</li>
        <li>Active-chain preview above the grid shows enabled effects in processing order.</li>
        <li>Two granulars: <strong>GRAIN</strong> (drone-smooth cloud) vs <strong>CLOUD</strong> (stutter, pitches snapped to the scale).</li>
        <li><strong>FREEZE</strong> snapshots the live ring buffer when toggled on. Presets that ship FREEZE enabled defer the snapshot ~3 s after apply so voices fill the ring with steady-state audio first.</li>
        <li><strong>PLATE</strong> is a convolution reverb loaded with a real EMT 140 plate IR (Greg Hopkins, CC-BY) on both serial insert and parallel send.</li>
      </ul>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">DISCOVERY</div>
      <ul className="help-list">
        <li><strong>🎲 RND</strong> — safe random. First three per session are from a curated <em>arrival</em> pool; afterwards the full library. After each click the engine measures the new preset's LUFS and nudges a session-level trim so a string of RND clicks reads as roughly equal-loudness.</li>
        <li><strong>ATTUNE</strong> — guided randomize of the tuning layer only. Preserves preset voicing. Instantly beautiful microtonal state.</li>
        <li><strong>MUTATE</strong> — nudges current macros / voice mix / FX levels by the intensity slider. Small = nudge, large = shake.</li>
        <li><strong>Undo / Redo + A/B</strong> — 50-entry history (debounced 400 ms). Two comparison slots (SAVE A / A, SAVE B / B) snap & recall.</li>
      </ul>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">SAVE &amp; RECORD</div>
      <ul className="help-list">
        <li><strong>LINK</strong> — header button next to MIDI. Copies a self-contained URL of the current scene to your clipboard. Auto-shortened via the <code>s.mdrone.org</code> relay; if the relay is offline you get the full self-contained URL instead. Open it on any device and you land in the same drone landscape. Doubles as a personal bookmark — paste your own link anywhere to come back to a scene later.</li>
        <li><strong>● REC WAV</strong> — 24-bit stereo WAV of the master output via a parallel AudioWorklet tap (bit-identical, no codec). Auto-starts HOLD if the drone isn't playing. Filename is <code>mdrone-&lt;scene&gt;-&lt;date&gt;.wav</code>; you'll see a <em>WAV saved — M:SS</em> confirmation. Long takes (~15 min+) get a one-time memory nudge; the page warns before close while recording is active.</li>
        <li><strong>◌ LOOP</strong> — bounces a short seamless-loop WAV (10–60 s) with a linear crossfade at the seam and a RIFF <code>smpl</code> chunk so samplers auto-detect the loop region. Different from REC WAV: this is a sampler-ready loop, not a long-form take.</li>
        <li><strong>REC MOTION</strong> (opt-in in Settings → Advanced) — captures live gestures (60 s / 200 events) into the next share URL. <em>Not an audio file</em> — recipients hear the sweep you made by replaying the gestures over the synth.</li>
        <li><strong>Sessions</strong> — Settings → SESSION: name, save, load, rename. Local-only, never uploaded.</li>
        <li><strong>Scale editor</strong> — ✎ next to the tuning dropdown opens a 13-degree cents table editor. Authored tunings travel in the share URL.</li>
      </ul>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">CONTROL</div>
      <ul className="help-list">
        <li><strong>MIDI</strong> — header <kbd>MIDI ▾</kbd> dropdown: toggle <em>MIDI INPUT</em>, toggle <em>LEARN MODE</em>, or open <em>MAPPING</em>. In learn mode every mappable control glows — click one then move a CC. Multiple CCs can drive the same target; the × on each chip removes one. The mapping modal owns the table, named templates, and JSON import / export. ~52 targets across Macros / Weather / Mixer / Voices / Effects / Triggers / Presets. Defaults: CC1 WEATHER Y, CC2 WEATHER X, CC64 HOLD, CC71-76 macros. Note-on → tonic / octave.</li>
        <li><strong>Ableton Link</strong> — sync the LFO RATE to Link tempo. Needs the{" "}
          <a href="https://github.com/gdamdam/mpump/releases" target="_blank" rel="noopener noreferrer">
            mpump bridge
          </a>{" "}(tiny local helper).
        </li>
        <li><strong>Palette</strong> — Settings → APPEARANCE. Three warm dark themes (Ember · Copper · Dusk) + one light (Parchment) for bright rooms.</li>
      </ul>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">SETTINGS &amp; PERFORMANCE</div>
      <ul className="help-list">
        <li><strong>Low-Power Mode</strong> — Settings → SESSION → LOW-POWER MODE (off by default). For older laptops, low-end Windows machines, and weak tablets. Clamps the MEDITATE visualizer to 15 fps, throttles the loudness meter, and skips a small preset-change duck. The MEDITATE rAF loop also adapts automatically — if frames drop, it steps down 30 → 20 → 15 → 10 fps without you doing anything.</li>
        <li><strong>LIVE SAFE</strong> — Settings → SESSION → LIVE SAFE. Stage / pro mode. Clamps the voice cap to 4, suppresses the heaviest FX (halo / granular / graincloud / shimmer / freeze), engages low-power visuals. Saved scenes and share URLs are not modified — your settings are restored when LIVE SAFE is turned off, and any change you make while it's on is preserved.</li>
        <li><strong>Adaptive stability</strong> — when the audio thread is sustainedly struggling the engine auto-mitigates in stages (visuals → heavy FX → voice density) and restores conservatively after a stable window. Mitigated FX in the bar render as ON-but-striped so you can see audio protection — not your toggle — caused the suppression. Briefly shown stage badge in the CPU detail.</li>
        <li><strong>Copy Audio Report</strong> — when the CPU indicator appears, tap it for the detail modal and use <strong>COPY AUDIO REPORT</strong> to put a structured diagnostics payload on your clipboard. Same data via the console: <code>await __mdroneAudioReport()</code>. URLs are reduced to origin + path so share-encoded scene data is never included.</li>
        <li><strong>Offline / Install</strong> — mdrone caches itself as a PWA. After the first load you can hold a drone with no internet. Use your browser's install affordance ("Add to Home Screen" on iOS, install icon in the URL bar on desktop) to launch it as a standalone app.</li>
        <li><strong>Motion Sensitivity</strong> — when your OS prefers reduced motion, the DREAM MACHINE strobe is replaced with a slow breath, and looping decorative animations (header marquee, MIDI-learn pulses) are muted. Audible content is unaffected.</li>
      </ul>

      <div className="fx-modal-divider" />
      <div className="fx-modal-section-label">ABOUT</div>
      <p className="fx-modal-desc">
        Free and open source under AGPL-3.0.{" "}
        <a href="https://github.com/gdamdam/mdrone" target="_blank" rel="noopener noreferrer">
          github.com/gdamdam/mdrone
        </a>
        . All state lives in your browser's localStorage — nothing is uploaded.
      </p>
    </>
  );
}

/* ─────────── Concepts tab ─────────── */

function ConceptsTab() {
  return (
    <>
      <p className="fx-modal-desc help-lede">
        Short explanations of the ideas mdrone is built on. One link
        per topic, all to Wikipedia. Optional reading.
      </p>

      <div className="fx-modal-section-label">MICROTONALITY</div>
      <p className="fx-modal-desc">
        Most Western music uses 12 equal-tempered pitches per octave. Microtonal
        music uses intervals that fall <em>between</em> those pitches — the
        subtle differences you can hear when you switch from SCALE to MICROTONAL
        mode and try Pythagorean, Kirnberger III, or 31-TET.{" "}
        <W slug="Microtonal_music">Wikipedia · Microtonal music</W>
      </p>

      <div className="fx-modal-section-label">CENTS</div>
      <p className="fx-modal-desc">
        The unit used throughout the tuning UI and the share URL. 1200 cents =
        one octave; 100 cents = one equal-tempered semitone. The DETUNE sliders
        let you nudge individual intervals by ±25 ¢ — barely audible on a single
        note, clearly audible against the tonic.{" "}
        <W slug="Cent_(music)">Wikipedia · Cent (music)</W>
      </p>

      <div className="fx-modal-section-label">JUST INTONATION &amp; PYTHAGOREAN</div>
      <p className="fx-modal-desc">
        Tuning systems that derive every interval from small whole-number
        frequency ratios (3:2 for the fifth, 5:4 for the major third, etc.)
        rather than from 12-tone equal temperament. They sound startlingly
        consonant on a sustained drone.{" "}
        <W slug="Just_intonation">Wikipedia · Just intonation</W>
      </p>

      <div className="fx-modal-section-label">MUSICAL MODES</div>
      <p className="fx-modal-desc">
        Different ways to stack the seven notes of a diatonic scale on a chosen
        root — Major / Ionian, Minor / Aeolian, Dorian, Phrygian, Lydian,
        Mixolydian, Locrian. mdrone's SCALE mode lets you pick one; each has a
        distinct emotional colour.{" "}
        <W slug="Mode_(music)">Wikipedia · Mode (music)</W>
      </p>

      <div className="fx-modal-section-label">LFO — LOW-FREQUENCY OSCILLATION</div>
      <p className="fx-modal-desc">
        A slow oscillator (below the range of hearing) used to modulate another
        parameter — in mdrone, primarily the master volume so the drone breathes.
        Shape and rate set the character; depth sets how strongly.{" "}
        <W slug="Low-frequency_oscillation">Wikipedia · Low-frequency oscillation</W>
      </p>

      <div className="fx-modal-section-label">BRAINWAVE ENTRAINMENT</div>
      <p className="fx-modal-desc">
        The idea that rhythmic audio (or light) nudges neural oscillations
        toward matching frequencies — delta / theta / alpha / beta / gamma
        bands. The LFO 2 FLICKER rate slider exposes these bands with coloured
        zones. Scientific evidence is mixed; Wikipedia has a useful summary.{" "}
        <W slug="Brainwave_entrainment">Wikipedia · Brainwave entrainment</W>
      </p>

      <div className="fx-modal-section-label">DRONE MUSIC</div>
      <p className="fx-modal-desc">
        The genre: sustained tones and harmonic fields — La Monte Young, Pauline
        Oliveros, Éliane Radigue, Catherine Christer Hennix, Stars of the Lid, and
        many non-Western traditions (Indian tanpura, Tibetan ritual, Scottish
        pipes). mdrone is an instrument for this lineage, not just an effect.{" "}
        <W slug="Drone_music">Wikipedia · Drone music</W>
      </p>

      <div className="fx-modal-section-label">ABLETON LINK</div>
      <p className="fx-modal-desc">
        A networked clock that keeps DAWs and apps on the same local network in
        tempo sync. mdrone uses it (via the mpump bridge) to lock the LFO rate
        to a Live / Logic / Bitwig session so the drone breathes in time with
        whatever else is playing.{" "}
        <W slug="Ableton_Link">Wikipedia · Ableton Link</W>
      </p>
    </>
  );
}
