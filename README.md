<h1 align="center">mdrone</h1>
<p align="center"><strong>Hold a note. Shape the air. Save the atmosphere.</strong><br><br>A browser drone instrument for long tones, harmonic beds, and slow-moving space.<br>Pick a tonic, build a timbre stack, drift it through weather and effects.<br>No install. No account. Free.</p>

---

mdrone is a browser instrument for sustained sound.

It starts quickly, sounds physical, and stays focused on one job: sustained harmonic atmosphere.

- **Hold a drone in the browser** — tonic, mode, timbre layers, climate, and master bus are ready right away.
- **Shape the sound slowly** — drift, air, time, sub, bloom, glide, breathing LFO, and a large XY climate surface.
- **Build real texture** — four authored voice models and a nine-effect chain, including worklet-based plate, shimmer, and freeze.
- **Save sessions locally** — store, load, and rename browser sessions without leaving the app.
- **Record the master** — export the final stereo output as WAV when the browser supports the recording path.

The core idea is simple: mdrone owns sustain.

Go deeper if you want:
- 4 authored voice engines
- 9 effects
- saved browser sessions
- WAV master recording
- mixer matched to the mpump / mloop family vocabulary

<p align="center">
  <img src="https://img.shields.io/badge/version-0.0.1-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License">
  <img src="https://img.shields.io/badge/Web%20Audio-API-FF6600" alt="Web Audio API">
  <img src="https://img.shields.io/badge/AudioWorklet-DSP-FF6600" alt="AudioWorklet">
</p>

---

## What you can do

- **Start a drone in seconds** — choose a tonic, mode, octave, and press HOLD.
- **Layer timbres** — combine tanpura, reed, metal, and air voices with independent levels.
- **Push the room around** — use DRIFT, AIR, TIME, SUB, BLOOM, GLIDE, breathing LFO, and the XY climate surface.
- **Build atmosphere fast** — plate, hall, shimmer, delay, tape, wow, sub, comb, and freeze are all one tap away, with long-press settings.
- **Save your scene** — keep named sessions in browser storage and come back to them later.
- **Mix the output** — shape the final bus with HPF, 3-band EQ, glue, drive, limiter, and trim.

No install. No account. No personal tracking. Session data stays in your browser.

---

## Table of Contents

- [Two Views](#two-views)
- [Audio Engine](#audio-engine)
- [Voices And Effects](#voices-and-effects)
- [Features](#features)
- [Sessions And Recording](#sessions-and-recording)
- [Deployment](#deployment)
- [Project Layout](#project-layout)
- [Privacy](#privacy)
- [License](#license)

---

## Two Views

| View | Description |
|---|---|
| **DRONE** | Header tonic / octave / hold controls, preset library, mode selection, layered voice stack, macros, breathing LFO, climate XY pad, and effect strip with long-press configuration |
| **MIXER** | Master bus with HPF, 3-band EQ, glue compressor, drive, limiter, ceiling, clip indicator, and final output trim |

---

## Audio Engine

All sound is synthesized in real time with the Web Audio API. No sample library is required for the core instrument.

**Voice Engine**: AudioWorklet-backed drone voices. Each active layer spawns one worklet voice per interval in the selected mode, mixed through per-layer gains. Tonic changes glide, interval changes rebuild with a short crossfade, and bloom controls the stack fade-in.

**Climate And Motion**: The climate XY pad maps brightness to the main filter cutoff and motion to filter-sweep depth. TIME controls the weather LFO rate. A separate user LFO adds breathing/tremolo on the voice gain.

**Atmosphere Chain**: The dry signal and shimmer octave source feed a dedicated FX chain before the master bus. AIR controls the global wet return.

**Master Bus**: HPF, 3-band EQ, glue compression, drive, limiter, trim, and analyser. The mixer vocabulary matches the wider mpump / mloop family so the three apps read like one system.

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
- 6 modal stacks: major, minor, dorian, phrygian, just 5-limit, pentatonic
- 6 core macros: drift, air, time, sub, bloom, glide
- Breathing LFO with sine, triangle, square, and sawtooth shapes
- Large XY climate pad for brightness and motion
- Spacebar toggles HOLD
- 16 authored presets inspired by drone traditions and ambient composers

**Sound Design**
- Layer any combination of the 4 voice engines
- Per-layer level control
- Long-press effect settings for amount, resonance, delay time, sub center, and freeze mix
- Shimmer octave voice tied directly to the shimmer effect state

**Mixer**
- HPF with quick OFF / 20 / 30 / 40 Hz stepping
- 3-band EQ
- Glue amount control
- Soft-clip drive
- Limiter with ceiling control
- Clip LED and final output trim

**Interface**
- Warm ember-led palette system
- Responsive two-column layout that collapses for smaller screens
- Sticky header with transport, tonic, random scene, sessions, and recording controls
- Session persistence via browser storage

---

## Sessions And Recording

mdrone supports named local sessions stored in `localStorage`.

- **Save** overwrites the current named session or creates a new named one
- **Load** restores the drone state and mixer state together
- **Rename** updates the saved session name in place

Sessions include:
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
    components/         # React UI for drone, mixer, header, footer, effects
    engine/             # Audio engine, voice builder, FX chain, worklet processors, presets
    styles/             # global CSS
    App.tsx             # singleton engine bootstrap + theme init
    config.ts           # app version + storage keys
    session.ts          # saved session types + browser persistence helpers
    themes.ts           # palette definitions and theme application
    types.ts            # shared app types
```

---

## Privacy

mdrone does not require an account and does not need a backend to store your instrument state.

- Sessions are saved locally in your browser
- Audio is synthesized locally in your browser
- Search engines are blocked via `robots.txt` in deployments that serve the `public/` folder unchanged

---

## License

mdrone is licensed under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.

If you modify mdrone and run it for users over a network, the AGPL requires that you also make the corresponding source available under the same license.
