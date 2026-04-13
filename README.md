<h1 align="center">mdrone</h1>
<p align="center"><strong>Hold a note. Shape the air. Save the atmosphere.</strong><br><br>A browser drone instrument for long tones, harmonic beds, and slow-moving space.<br>Pick a tonic, build a timbre stack, drift it through weather and effects.<br>No install. No account. Free.</p>

<p align="center">
  <a href="https://mdrone.mpump.live/">https://mdrone.mpump.live/</a>
</p>

<p align="center">
  <img src="public/mdrone_screenshot.png" alt="mdrone screenshot" width="1200">
</p>

---

mdrone is a browser instrument for sustained sound.

It starts quickly, sounds physical, and stays focused on one job: sustained harmonic atmosphere.

- **Hold a drone in the browser** — tonic, mode, timbre layers, climate, and master bus are ready right away.
- **Shape the sound slowly** — drift, air, time, sub, bloom, glide, breathing LFO, and a large XY climate surface.
- **Build real texture** — seven authored voice models and a 14-effect chain, including worklet-based plate, shimmer, freeze, cistern, and two granular engines (smooth cloud + classic stutter).
- **Let the drone evolve** — preset morphing, URL-deterministic self-evolution, MUTATE perturbations, ritual JOURNEY phases, random scene generation, and a dedicated listening view keep long tones alive.
- **Tune microtonally** — six tunings (equal, just 5-limit, meantone, harmonics, maqam-rast, slendro), six relation presets, and per-interval ±25 ¢ fine detune that updates voices live.
- **Add a sympathetic partner** — optional second drone layer at a fifth, octave, or beat-detune relation with no extra editor.
- **Record meaningful gestures** — capture macro / tonic / climate moves into the share URL and replay them deterministically anywhere.
- **Save sessions locally** — store, load, and rename browser sessions without leaving the app.
- **Record the master** — export the final stereo output as WAV when the browser supports the recording path.
- **Share** — every scene encodes into a URL link and a share-card image, with backwards-compatible decoding for legacy URLs.

The core idea is simple: mdrone owns sustain.

Go deeper if you want:
- 7 authored voice engines (tanpura, reed, metal, air, piano, fm, amp) with formant bodies, body resonators, and proper amp cabinet shaping
- 14 effects including a true octave-down sub and two granular engines (pitch-quantised stutter + drone-smooth cloud)
- 43 authored presets across 5 genre groups
- 6 microtonal tunings + 6 relation presets + per-interval fine detune
- 4 ritual journeys (morning, evening, dusk, void) each with 4 phases
- URL-deterministic evolve loop seeded by a per-scene PRNG
- Optional motion recording in the share URL (60 s / 200 events cap — hidden by default, enable in Settings → Advanced)
- 14 Meditate visualizers
- Web MIDI note input
- saved browser sessions
- WAV master recording
- mixer matched to the mpump / mloop family vocabulary

<p align="center">
  <a href="https://github.com/gdamdam/mdrone"><img src="https://img.shields.io/badge/version-1.7.5-blue" alt="Version"></a>
  <a href="https://github.com/gdamdam/mdrone/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/Web%20Audio-API-FF6600" alt="Web Audio API">
  <img src="https://img.shields.io/badge/AudioWorklet-DSP-FF6600" alt="AudioWorklet">
</p>

---

## What you can do

- **Start a drone in seconds** — choose a tonic, mode, octave, and press HOLD.
- **Layer timbres** — combine tanpura, reed, metal, air, piano, FM, and amp voices with independent levels.
- **Shape the WEATHER** — the signature XY control changes the whole room. X = dark ↔ bright, Y = still ↔ moving. Three visual modes: waveform oscilloscope (default), flow field, minimal.
- **Push the room around** — DRIFT, AIR, TIME, BLOOM, GLIDE, MORPH, EVOLVE, SUB, breathing LFO, and the WEATHER XY surface.
- **Build atmosphere fast** — tape, wow, sub (true octave-down), comb, ringmod, formant (5 vowel presets + shift), delay, plate (Dattorro with decay/damping/diffusion), hall, shimmer, freeze, cistern, granular (drone-smooth cloud), graincloud (classic grain stutter) — all one tap away with per-effect settings.
- **Tune microtonally** — pick a tuning (just 5-limit, meantone, harmonics, maqam-rast, slendro, equal) and a relation, then nudge each interval in cents with the DETUNE sliders. Voices retune live.
- **Mutate** — click MUTATE to perturb the current scene by an intensity slider. Deterministic from the URL via a per-scene PRNG seed.
- **Walk a ritual journey** — pick JOURNEY and the scene drifts through arrival → bloom → suspension → dissolve over a few minutes, deterministic from the share URL.
- **Add a sympathetic partner** — toggle PARTNER to layer a second drone voice at a fifth, octave, or beat-detune relation.
- **Record gestures into the share URL** (opt-in) — enable `MOTION RECORDING` in Settings → Advanced to reveal REC MOTION. Captures meaningful tonic / macro / climate moves; share that URL and the next visitor sees the same performance replay.
- **Listen inside the drone** — switch to MEDITATE for analyser-driven visualizers that breathe with the sound.
- **Play from hardware** — Web MIDI note-on → tonic + octave. CC mapping with learn mode: 10 assignable targets (WEATHER X/Y, DRIFT, AIR, TIME, BLOOM, GLIDE, SUB, VOL, HOLD). Sensible defaults out of the box.
- **Save your scene** — keep named sessions in browser storage and come back to them later.
- **Mix the output** — shape the final bus with HPF, 3-band EQ, glue, drive, limiter, and trim.

No install. No account. No personal tracking. Anonymous page counts via [GoatCounter](https://goatcounter.com). Session data stays in your browser.

---

## Table of Contents

- [Three Views](#three-views)
- [Audio Engine](#audio-engine)
- [Voices And Effects](#voices-and-effects)
- [Features](#features)
- [Sessions And Recording](#sessions-and-recording)
- [Deployment](#deployment)
- [Project Layout](#project-layout)
- [Privacy](#privacy)
- [License](#license)

---

## Three Views

| View | Description |
|---|---|
| **DRONE** | Header tonic / octave / hold controls, preset library, mode selection, layered voice stack, macros, breathing LFO, climate XY pad, and effect strip with long-press configuration |
| **MEDITATE** | Full-screen visualizer layer that breathes with the analyser output and turns the drone into a focused listening surface |
| **MIXER** | Master bus with HPF, 3-band EQ, glue compressor, drive, limiter, ceiling, clip indicator, and final output trim |

---

## Audio Engine

All sound is synthesized in real time with the Web Audio API. No sample library is required for the core instrument.

**Voice Engine**: AudioWorklet-backed drone voices. Each active layer spawns one worklet voice per interval in the selected mode, mixed through per-layer gains. Tonic changes glide, interval changes rebuild with a short crossfade, and bloom controls the stack fade-in.

**Climate And Motion**: The climate XY pad maps brightness to the main filter cutoff and motion to filter-sweep depth. TIME controls the weather LFO rate. A separate user LFO adds breathing/tremolo on the voice gain.

**Atmosphere Chain**: The dry signal and shimmer octave source feed a fixed serial FX chain before the master bus. TAPE, WOW, SUB, COMB, DELAY, PLATE, HALL, SHIMMER, and FREEZE can be toggled independently, and long-press settings expose per-effect controls such as amount, feedback, resonance, sub center, and freeze mix. AIR controls the reverb-family wet return.

**Master Bus**: HPF, 3-band EQ, glue compression, drive, limiter, trim, and analyser. The mixer vocabulary matches the wider mpump / mloop family so the three apps read like one system.

**Preset Motion**: MORPH slows preset transitions into long crossfades, EVOLVE lets scenes slowly drift by themselves during playback, and PLUCK changes the tanpura re-pluck cycle without affecting the other voices.

**Meditate View**: A separate visualizer surface reads the analyser and mood of the current drone, then drives multiple long-form canvases for focused listening rather than editing.

**MIDI**: Web MIDI note-in can retune the current tonic and octave from external hardware keyboards or controllers. No MIDI output or clock sync is involved; it is purely a note-in performance control.

**Recording**: The final post-limiter, post-trim master can be captured and rendered to WAV through the browser recording path when `MediaRecorder` plus WebM audio support are available.

---

## Voices And Effects

### Voices

| Voice | Character |
|---|---|
| **TANPURA** | Karplus-Strong plucked string with jawari-style nonlinearity and auto-repluck cycle |
| **REED** | Harmonium / shruti-box additive reed stack with bellows motion and warm saturation |
| **METAL** | Inharmonic partial cloud with slow random walks and singing-bowl / bell character |
| **AIR** | Pink-noise resonator voice for tuned wind, breath, and open-pipe texture |
| **PIANO** | Long-decay felt-piano sustain layer for soft tonal beds |
| **FM** | Dual-operator FM voice for metallic drones and bell-like overtones |
| **AMP** | Sustained amp / cabinet drone source with harmonic body |

### Effects

The serial chain is fixed in this order:

| Effect | Character |
|---|---|
| **TAPE** | Saturation, head bump, and top-end rolloff |
| **WOW** | Slow wow plus faster flutter on a short delay line |
| **SUB** | True octave-down subharmonic — triangle oscillator at root/2 amplitude-tracked by an envelope follower, summed in parallel with the dry |
| **COMB** | Root-tracking resonant comb filter with soft-clipped feedback |
| **RINGMOD** | Ring modulator for inharmonic shimmer and bell-like sidebands |
| **FORMANT** | Vowel-shape formant filter for vocal-throat coloration |
| **DELAY** | Warm feedback delay with lowpass and saturation in the loop |
| **PLATE** | Worklet-based Dattorro-style plate reverb |
| **HALL** | Native convolver hall with authored early reflections and diffuse tail |
| **SHIMMER** | Worklet shimmer reverb plus octave-up source voice |
| **FREEZE** | Worklet freeze capture that latches a sustained layer in place |
| **CISTERN** | Long, dark room reverb for deep cavern / underground spaces |
| **GRANULAR** | Drone-smooth grain cloud — medium grains at moderate density, soft trapezoid envelope, per-channel envelope-sum normalised |
| **GRAINCLOUD** | Classic granular stutter — 40 ms grains at 25/s, falling-exponential envelope, ordered time-stretch replay, pitches snapped to the drone scale |

---

## Features

**Performance**
- Header tonic selector, octave control, HOLD transport, RND, ↶ undo, and SHARE
- 11 scale sets: drone, major, minor, dorian, phrygian, just 5-limit, pentatonic, meantone, harmonics, maqam-rast, slendro
- 6 microtonal tunings + 6 relation presets + per-interval ±25 ¢ fine detune
- 6 core macros: drift, air, time, sub, bloom, glide
- Breathing LFO with sine, triangle, square, and sawtooth shapes
- MORPH control for slow preset-to-preset transitions
- EVOLVE control for self-moving long-form scenes
- PLUCK control for tanpura re-pluck speed
- Large XY climate pad for brightness and motion
- Spacebar toggles HOLD
- 43 authored presets across 5 genre groups (Sacred, Minimal, Organ, Ambient, Noise)
- Authored regional presets for Javanese gamelan and Arabic maqam traditions
- Random startup scene and random scene generator
- Web MIDI note-in for tonic / octave performance from external devices

**Evolve, Mutate, Journey, Partner**
- URL-deterministic evolve loop — same share URL ⇒ same drift over time, seeded by a per-scene PRNG
- MUTATE button perturbs the current scene by an intensity slider; deterministic from the URL
- JOURNEY mode walks a scene through authored arrival → bloom → suspension → dissolve phases
- 4 shipped journeys: morning, evening, dusk, void
- PARTNER toggle adds a sympathetic second drone layer at a fifth / octave-up / octave-down / beat-detune relation
- Motion recording (opt-in via Settings → Advanced): REC MOTION captures meaningful gestures (tonic, octave, macros, climate, lfo) into the share URL and replays them deterministically on load. Capped at 60 s / 200 events.

**Sound Design**
- Layer any combination of the 7 voice engines
- Per-layer level control
- Long-press effect settings for amount, resonance, delay time, sub center, and freeze mix
- Shimmer octave voice tied directly to the shimmer effect state
- 14-effect serial chain (tape, wow, sub, comb, ringmod, formant, delay, plate, hall, shimmer, freeze, cistern, granular, graincloud)
- Preset-specific loudness trim so scenes stay in a usable range

**Mixer**
- HPF with quick OFF / 20 / 30 / 40 Hz stepping
- 3-band EQ
- Glue amount control
- Soft-clip drive
- Limiter with ceiling control
- Clip LED and final output trim

**Interface**
- 3 warm palettes: Ember, Copper, Dusk
- Responsive two-column layout that collapses for smaller screens
- Sticky header with transport, tonic, random scene, sessions, recording, and MIDI access
- MEDITATE view with 14 analyser-driven visualizers and fullscreen mode
- Session persistence via browser storage

---

## Sessions And Recording

mdrone supports named local sessions stored in `localStorage`.

- **Save** overwrites the current named session or creates a new named one
- **Load** restores the drone state and mixer state together
- **Rename** updates the saved session name in place

Sessions include:
- active preset id
- tonic, octave, mode
- microtuning + relation + per-interval fine detune offsets
- voice layer on/off state and levels
- macro values
- climate and LFO settings
- effect toggles + per-effect parameter levels
- mixer settings
- evolve seed (for URL-deterministic drift)
- journey id (when an authored ritual phase walk is active)
- sympathetic partner state (relation + enabled)
- optional motion recording (compact gesture event list)

Recording captures the final master output and downloads a WAV. Some browsers, especially ones without WebM audio recording support, will show recording as unavailable rather than pretending it worked.

Sharing builds a compressed URL that encodes the full scene. URLs are backward compatible — older URLs missing the newer fields (journey, partner, motion, seed) load with sensible defaults.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| A W S E D F T G Y H U J | Tonic (C C# D D# E F F# G G# A A# B) |
| Z / X | Octave down / up |
| Spacebar | HOLD toggle |
| < | Previous preset in group |
| > | Next preset in group |

QWERTY tonic requires the ⌨ button enabled in the SHAPE column.

## MIDI CC mapping

10 assignable targets with sensible defaults. Enable MIDI in Settings, then use the CC MAPPING section to learn new assignments (click a target, move a knob).

| CC | Default target |
|----|---------------|
| CC1 (mod wheel) | WEATHER Y |
| CC2 (breath) | WEATHER X |
| CC7 (volume) | VOL |
| CC64 (sustain) | HOLD |
| CC71–76 | DRIFT, AIR, TIME, BLOOM, GLIDE, SUB |

---

## Deployment

GitHub Pages deploy is wired through the `gh-pages` package.

```bash
npm run deploy
```

That command builds the app and publishes `dist/` to the `gh-pages` branch.

---

## Project Layout

```text
mdrone/
  public/
    about.html          # explainer / SEO page
    landing.html        # legacy redirect to about.html
    robots.txt          # allow search crawlers, block selected AI crawlers
    sitemap.xml         # crawlable URLs for search engines
  src/
    components/         # React UI for drone, meditate, mixer, header, footer, sessions, effects
    engine/             # Audio engine, voice builder, FX chain, worklet processors, presets, MIDI input
    styles/             # global CSS
    App.tsx             # singleton engine bootstrap + theme init
    config.ts           # app version + storage keys
    session.ts          # saved session types + browser persistence helpers
    themes.ts           # palette definitions and theme application
    types.ts            # shared app types
```

---

## Privacy

mdrone does not use accounts, cookies, ads, or personal tracking.

It keeps the instrument self-contained so the drone stays yours.

### Anonymous page counts

mdrone uses [GoatCounter](https://goatcounter.com) for anonymous, cookieless page-view counting. GoatCounter does not collect personal data, does not use cookies, and does not track users across sites.

### What mdrone does not collect

- **No accounts**: no sign-up, no email, no profile
- **No cookies**: no login cookies, no ad cookies, no tracking cookies
- **No user IDs**: no persistent personal identifier assigned to you
- **No fingerprinting**: no hidden identity built from your browser or device
- **No ad networks**: no third-party ad or surveillance trackers

### What stays local

- **Sessions** stay in your browser on your device via `localStorage`
- **Audio** is synthesized locally in the browser with Web Audio and AudioWorklet
- **Recordings** are rendered and downloaded locally in the browser when supported
- **Open source**: full codebase on [GitHub](https://github.com/gdamdam/mdrone)

### Hosting

mdrone is hosted on [GitHub Pages](https://pages.github.com).

Normal search crawlers are allowed via `robots.txt`; `GPTBot`,
`Google-Extended`, and `ClaudeBot` are blocked. The sitemap advertises
the public explainer page at `/about.html`.

---

Your drone stays on your device. Always.

---

## License

[AGPL-3.0](LICENSE)

## Trademark

"mdrone" is an unregistered trademark of the author.
Use of the name or logo for derivative projects or services may cause confusion and is not permitted.

---

Built with Claude Code. Design, architecture, UX, audio chain, and creative direction by [gdamdam](https://github.com/gdamdam).
