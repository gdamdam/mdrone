<h1 align="center">mdrone</h1>
<p align="center"><strong>Hold a note. Shape the air. Save the atmosphere.</strong><br><br>A browser drone instrument for long tones, harmonic beds, and slow-moving space.<br>Pick a tonic, build a timbre stack, drift it through weather and effects.<br>No install. No account. Free.</p>

<p align="center">
  <a href="https://mdrone.mpump.live/">https://mdrone.mpump.live/</a>
</p>

<p align="center">
  <img src="public/mdrone_screenshot.png" alt="mloop screenshot" width="1200">
</p>

---

mdrone is a browser instrument for sustained sound.

It starts quickly, sounds physical, and stays focused on one job: sustained harmonic atmosphere.

- **Hold a drone in the browser** — tonic, mode, timbre layers, climate, and master bus are ready right away.
- **Shape the sound slowly** — drift, air, time, sub, bloom, glide, breathing LFO, and a large XY climate surface.
- **Build real texture** — four authored voice models and a nine-effect chain, including worklet-based plate, shimmer, and freeze.
- **Let the drone evolve** — preset morphing, self-evolution, tanpura pluck-rate control, random scene generation, and a dedicated listening view keep long tones alive.
- **Save sessions locally** — store, load, and rename browser sessions without leaving the app.
- **Record the master** — export the final stereo output as WAV when the browser supports the recording path.

The core idea is simple: mdrone owns sustain.

Go deeper if you want:
- 4 authored voice engines
- 9 effects
- 16 authored presets
- 14 Meditate visualizers
- Web MIDI note input
- saved browser sessions
- WAV master recording
- mixer matched to the mpump / mloop family vocabulary

<p align="center">
  <a href="https://github.com/gdamdam/mdrone"><img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version"></a>
  <a href="https://github.com/gdamdam/mdrone/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/Web%20Audio-API-FF6600" alt="Web Audio API">
  <img src="https://img.shields.io/badge/AudioWorklet-DSP-FF6600" alt="AudioWorklet">
</p>

---

## What you can do

- **Start a drone in seconds** — choose a tonic, mode, octave, and press HOLD.
- **Layer timbres** — combine tanpura, reed, metal, and air voices with independent levels.
- **Push the room around** — use DRIFT, AIR, TIME, SUB, BLOOM, GLIDE, breathing LFO, MORPH, EVOLVE, PLUCK, and the XY climate surface.
- **Build atmosphere fast** — plate, hall, shimmer, delay, tape, wow, sub, comb, and freeze are all one tap away, with long-press effect settings.
- **Listen inside the drone** — switch to MEDITATE for analyser-driven visualizers that breathe with the sound.
- **Play from hardware** — enable Web MIDI note input to retune the tonic from an external keyboard or controller.
- **Save your scene** — keep named sessions in browser storage and come back to them later.
- **Mix the output** — shape the final bus with HPF, 3-band EQ, glue, drive, limiter, and trim.

No install. No account. No personal tracking. Session data stays in your browser.

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

### Effects

| Effect | Character |
|---|---|
| **TAPE** | Saturation, head bump, and top-end rolloff |
| **WOW** | Slow wow plus faster flutter on a short delay line |
| **PLATE** | Worklet-based Dattorro-style plate reverb |
| **HALL** | Native convolver hall with authored early reflections and diffuse tail |
| **SHIMMER** | Worklet shimmer reverb plus octave-up source voice |
| **DELAY** | Warm feedback delay with lowpass and saturation in the loop |
| **SUB** | Psychoacoustic bass enhancer |
| **COMB** | Root-tracking resonant comb filter |
| **FREEZE** | Worklet freeze capture that latches a sustained layer in place |

---

## Features

**Performance**
- Header tonic selector, octave control, HOLD transport, and random scene trigger
- 7 scale sets: drone, major, minor, dorian, phrygian, just 5-limit, pentatonic
- 6 core macros: drift, air, time, sub, bloom, glide
- Breathing LFO with sine, triangle, square, and sawtooth shapes
- MORPH control for slow preset-to-preset transitions
- EVOLVE control for self-moving long-form scenes
- PLUCK control for tanpura re-pluck speed
- Large XY climate pad for brightness and motion
- Spacebar toggles HOLD
- 16 authored presets inspired by drone traditions and ambient composers
- Random startup scene and random scene generator
- Web MIDI note-in for tonic / octave performance from external devices

**Sound Design**
- Layer any combination of the 4 voice engines
- Per-layer level control
- Long-press effect settings for amount, resonance, delay time, sub center, and freeze mix
- Shimmer octave voice tied directly to the shimmer effect state
- Serial atmosphere chain with tape, wow, sub, comb, delay, plate, hall, shimmer, and freeze
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
- voice layer on/off state and levels
- macro values
- climate and LFO settings
- effect toggles
- mixer settings

Recording captures the final master output and downloads a WAV. Some browsers, especially ones without WebM audio recording support, will show recording as unavailable rather than pretending it worked.

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
    robots.txt          # search engines blocked from indexing deployments
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

### What mdrone does not collect

- **No accounts**: no sign-up, no email, no profile
- **No cookies**: no login cookies, no ad cookies, no analytics cookies
- **No user IDs**: no persistent personal identifier assigned to you
- **No fingerprinting**: no hidden identity built from your browser or device
- **No third-party trackers**: no ad networks or embedded analytics scripts

### What stays local

- **Sessions** stay in your browser on your device via `localStorage`
- **Audio** is synthesized locally in the browser with Web Audio and AudioWorklet
- **Recordings** are rendered and downloaded locally in the browser when supported
- **Open source**: full codebase on [GitHub](https://github.com/gdamdam/mdrone)

### Hosting

mdrone is hosted on [GitHub Pages](https://pages.github.com).

Search engines are blocked via `robots.txt` in deployments that serve the `public/` folder unchanged.

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
