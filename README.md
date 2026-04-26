<h1 align="center">mdrone</h1>
<p align="center"><strong>Hold a note. Shape the air. Save the atmosphere.</strong><br><br>A microtonal drone instrument in your browser.<br>Hand-authored voices, long-form motion, and shareable tunings.<br>No install. No account. Free.</p>

<p align="center">
  <a href="https://mdrone.org/">https://mdrone.org/</a>
</p>

<p align="center">
  <img src="public/mdrone_screenshot.png" alt="mdrone screenshot" width="1200">
</p>

<p align="center">
  <a href="https://github.com/gdamdam/mdrone"><img src="https://img.shields.io/github/package-json/v/gdamdam/mdrone?color=blue&label=version" alt="Version"></a>
  <a href="https://github.com/gdamdam/mdrone/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/Web%20Audio-API-FF6600" alt="Web Audio API">
  <img src="https://img.shields.io/badge/AudioWorklet-DSP-FF6600" alt="AudioWorklet">
</p>

---

## What it does

- **Holds a drone in the browser** — tonic, mode, timbre layers, climate, and master bus are ready immediately. First fresh launch lands on a dedicated **Welcome** preset; the next two handfuls of RND clicks draw from a curated arrival pool before opening the full library.
- **Shapes sound slowly** — macros, a breathing LFO, and a large XY WEATHER pad for brightness and motion.
- **Builds real texture** — eight authored voice models (TANPURA / REED / METAL / AIR / PIANO / FM / AMP / NOISE with colour control) and a 14-effect chain with worklet-based plate, shimmer, freeze, FDN hall/cistern, and two granular engines.
- **Evolves on its own** — preset morphing, URL-deterministic self-evolution, MUTATE, authored JOURNEYs, sympathetic PARTNER, and recorded gesture replay.
- **Tunes microtonally** — 6 built-in tuning tables plus 16 curated authored tunings (Pythagorean, Kirnberger III, 31-TET, Yaman, Bayati, the house **mdrone Signature** hybrid, …), 6 relation presets, a Scale Editor for your own 13-degree tables, per-interval ±25 ¢ fine detune that retunes voices live, and a **GOOD DRONE** one-click guided-randomize for beautiful tuning states.
- **Saves + shares** — named local sessions, share-URL encoding of the full scene + optional recorded gestures + custom tuning cents, WAV master recording.

---

## Table of Contents

- [Three Views](#three-views)
- [Audio Engine](#audio-engine)
- [Voices](#voices)
- [Effects](#effects)
- [Microtuning](#microtuning)
- [Motion & Evolution](#motion--evolution)
- [Mixer](#mixer)
- [MEDITATE view](#meditate-view)
- [Sessions, Sharing, Recording](#sessions-sharing-recording)
- [Keyboard & MIDI](#keyboard--midi)
- [Interface](#interface)
- [Deployment](#deployment)
- [Project Layout](#project-layout)
- [Privacy](#privacy)
- [License](#license)

---

## Three Views

| View | Purpose |
|---|---|
| **DRONE** | The instrument: header tonic / octave / HOLD transport, preset library, voice stack, macros, breathing LFO, climate XY pad, effect chain, undo/redo + A/B snapshot slots, SCALE editor, GESTURES panel. The header's **◉ MEDITATE** toggle (next to HOLD) opens an inline live-visualizer tile above the WEATHER pad; tap the tile's canvas to expand to fullscreen. |
| **MEDITATE (inline)** | Live preview tile rendered inside DRONE: 16:9 canvas + bottom navigator (visualizer dropdown, ◂ prev / ▸ next / ↻ reset / ↗ open). 25 authored visualizers grouped by function: HARMONIC / LANDSCAPE / RITUAL / VOID · HYPNOTIC (B&W-first within each). All share one warm parchment / ember palette. Many accrete complexity over minutes: SEDIMENT STRATA, TAPE DECAY, RESONANT BODY, PETROGLYPHS, ILLUMINATED GLYPHS, HARMONIC EMBER, SHORTWAVE STATIC. |
| **MIXER** | Master bus: HPF, 3-band EQ, MUD trim toggle, glue compression, drive, look-ahead brickwall limiter (Chrome/FF) or native comp (Safari) with ceiling, ROOM (parallel cathedral-IR send), COLOR (parallel saturation + air-band exciter), WIDTH (M/S matrix with bass-mono fold), SAFE (headphone-safe) toggle, CLIP LED (pre-limiter peak), LUFS-S + PEAK metering, FADE controller, final output trim. Opened via the header **MIXER** button (next to VOL); slides up as a bottom drawer. |

---

## Audio Engine

All sound is synthesised in real time with the Web Audio API. No sample library is required.

- **Voice engine** — AudioWorklet-backed drone voices. Each active layer spawns one worklet voice per interval in the selected mode, mixed through per-layer gains. Tonic changes glide; interval changes rebuild with a short crossfade; BLOOM controls stack fade-in. Each voice carries a sub-Hz pitch-drift LFO (~±2 cents) so the stack breathes instead of sitting frozen, and is positioned in the stereo field by a per-voice `StereoPanner` (intervals spread across ±0.6) for true stereo separation rather than reverb-only width.
- **Climate** — the WEATHER XY pad drives brightness (filter cutoff) on X and motion (LFO depth + drift) on Y. TIME controls the weather LFO rate. A separate user LFO adds breathing/tremolo on voice gain. An optional second modulator — the **LFO 2 · FLICKER** panel — reaches 0.5–45 Hz with AM and per-voice dichotic L/R detune, phase-locked to the breathing LFO (see below).
- **Atmosphere chain** — the dry signal and shimmer octave source feed a **14-effect chain before the master bus**. Effects can run serial (wet-insert) or parallel (send) per preset. The chain order is user-reorderable via drag.
- **Master bus** — HPF, 3-band EQ, **mud trim** (peaking -3.5 dB @ 300 Hz, on by default, toggleable), glue compression, drive, parallel **COLOR** sends (asymmetric tanh saturation + 4–10 kHz exciter, default 0), parallel **ROOM** send (cathedral-IR convolver, default 0), **look-ahead brickwall limiter worklet** on Chrome/FF (Safari keeps the native DynamicsCompressor for the prior worklet-hash regression), trim, **bass-mono fold** below 120 Hz, **M/S width** matrix, **session loudness trim** (auto-leveled by RND so a string of random presets reads as roughly equal-loudness), and analyser taps (pre-limiter for CLIP, post-limiter for LUFS/PEAK).
- **Oversampling** — `tanh` nonlinearities in AMP, TANPURA jawari, METAL, and REED are 2× oversampled to keep aliasing below the noise floor. (Master DRIVE runs at native rate — gentle tanh stays clean enough at unity, and 2× oversampling there triggered a Safari-specific signal-correlated hash.)
- **Reverbs** — PLATE is now a **ConvolverNode loaded with a real EMT 140 plate IR** (Greg Hopkins via oramics/sampled, CC-BY); the algorithmic Dattorro it replaced is still registered but unused. HALL and CISTERN are **FDN worklets** (replacing the earlier noise-IR convolvers); size + damping tuned per-preset. The master ROOM send uses a separate **ConvolverNode loaded with a real cathedral IR** (Saint-Lawrence Church, Molenbeek-Wersbeek, Public Domain CC).
- **Recording** — the final post-limiter, post-trim master can be captured and rendered to WAV through `MediaRecorder` + WebM audio when the browser supports both.
- **Determinism** — reverb IRs and evolve drift are seeded from a per-scene PRNG (FNV-1a hash of the preset ID or share-URL seed). Same URL ⇒ same tail, same drift.

---

## Voices

Eight authored voice models with per-voice physicality (jawari nonlinearity, soundboard coupling, bellows AM, modal bowls, cabinet shaping, noise colour).

| Voice | Character |
|---|---|
| **TANPURA** | Karplus-Strong plucked string with jawari nonlinearity + auto-repluck cycle. Supports classical tunings (unison, Sa-Pa, Sa-Ma, Sa-Ni). |
| **REED** | Harmonium / shruti-box additive reed stack with bellows motion and warm saturation. `shape` selects odd-partial (clarinet) / even-partial (bowed) / balanced (organ) / pure sine. |
| **METAL** | Inharmonic partial cloud with slow 0.08 Hz re-excitation and singing-bowl / bell character. |
| **AIR** | Pink-noise resonator voice for tuned wind, breath, and open-pipe texture. |
| **PIANO** | Long-decay felted sustain layer for soft tonal beds. |
| **FM** | Dual-operator FM voice for metallic drones and bell-like overtones. Slow index LFO (±55% over 30–50 s) keeps DX7-style bells alive. |
| **AMP** | Sustained amp / cabinet drone source with harmonic body. `tanh` drive runs at 2× oversample. |
| **NOISE** | Coloured noise bed — `noiseColor` ranges 0 (white) → 1 (deep brown). Used as tape hiss, cistern air, feedback weather, or a rumbling chamber floor under the tonal voices. |

---

## Effects

The chain holds 14 effects. Each is a toggle (click) with a long-press settings modal (AMOUNT + effect-specific params). Order is user-reorderable via drag.

| Effect | Character |
|---|---|
| **TAPE** | Saturation, head bump, top-end rolloff |
| **WOW** | Slow wow plus faster flutter on a short delay line |
| **SUB** | True octave-down subharmonic — triangle at root/2, amplitude-tracked, summed in parallel |
| **COMB** | Root-tracking resonant comb filter with soft-clipped feedback |
| **DELAY** | Warm feedback delay with lowpass and saturation in the loop |
| **PLATE** | Convolution plate reverb — Greg Hopkins EMT 140 IR (CC-BY) on both serial insert and parallel send |
| **HALL** | Worklet FDN hall (size ≈ 0.45, bright damping) |
| **SHIMMER** | Worklet shimmer reverb plus octave-up source voice |
| **FREEZE** | Phase-vocoder magnitude-hold capture. Ring buffer always fills with live audio so toggling FREEZE on snapshots whatever is playing right now; presets that ship FREEZE enabled defer the snapshot ~3 s after apply so voices ramp into the ring first |
| **CISTERN** | Worklet FDN cathedral-scale reverb (size ≈ 1.2, dark damping, ~28 s tail) |
| **GRANULAR** | Drone-smooth grain cloud — medium grains at moderate density, trapezoid envelope, per-channel envelope-sum normalised |
| **GRAINCLOUD** | Classic grain stutter — 40 ms grains at 25/s, falling-exponential envelope, ordered time-stretch replay, pitches snapped to the drone scale |
| **RINGMOD** | Ring modulator for inharmonic shimmer and bell-like sidebands |
| **FORMANT** | Parallel band-pass vowel formant body (rewrite in 1.9.0; previous serial-peaking stack was ~20 dB hot in midrange) |

AIR controls the reverb-family wet return. Both HALL and CISTERN can be routed serially (wet-insert) or parallel (send) per preset; serial routing adds a make-up gain trim so minimal presets don't sit lower than layered ones.

---

## Microtuning

- **6 built-in tuning tables**: equal (12-TET), just 5-limit, ¼-comma meantone, harmonic series, maqam rast, slendro.
- **16 curated authored tunings** shipped alongside the built-ins:
  - *Historical / Western*: Pythagorean (3-limit), Kirnberger III, Werckmeister III, Young 7-limit WTP lattice, Just 7-limit, Partch 11-limit subset.
  - *Xenharmonic EDOs*: 15-TET (Catler), 17-TET, 19-TET, 22-EDO (Erlich), 31-TET (Huygens).
  - *World*: Yaman (Hindustani), Pelog (Javanese), Bayati (Arabic maqam).
  - *Concept / house*: Otonal 16:32 zero-beat reference, Spectral Primes, Skewed Pythagorean, Cluster 22-Sruti, Hollow (open-fifth), and the house **mdrone Signature** — a just × 31-TET hybrid tuned so every built-in relation resolves to pure just intervals, with 31-TET meantone pitches in the interstitial slots.
- **6 relation presets**: unison, tonic-fifth, tonic-fourth, minor triad, drone triad, harmonic stack.
- **Per-interval ±25 ¢ fine detune** that retunes voices live. The DETUNE panel auto-surfaces whenever a scene arrives with non-zero offsets.
- **GOOD DRONE** (in the scene-actions row next to MUTATE) — one-click guided randomize: pulls a tuning + relation from a drone-friendly pool and applies ±2–5 ¢ detune on every non-root interval so the result is immediately beautiful and alive.
- **Scale Editor** (✎ next to the tuning picker, visible in MICROTONAL mode) — author a 13-degree table in cents, save to `localStorage`, apply as active. Shared URLs bundle the full cents array under the scene's explicit tuning id so recipients reproduce authored microtonality exactly — even for authored tunings not yet present in older app versions.
- **11 mode scales** (when not in microtonal mode): drone, major, minor, dorian, phrygian, just 5-limit, pentatonic, meantone, harmonics, maqam-rast, slendro.

---

## Motion & Evolution

The instrument has five motion/evolution systems arranged by timescale. MORPH and EVOLVE are continuous macros; the GESTURES panel (disclosed in the SHAPE column) holds the on-demand and scripted ones.

| System | Timescale | What it does |
|---|---|---|
| **MORPH** | seconds | Controls how slowly the drone cross-fades when you load another preset. 0 = snap, 1 = ~20 s glacial fade. |
| **EVOLVE** | minutes | Continuous macro drift while a preset is held. 0 = dead-still, 1 = active drift. URL-seeded — same share URL ⇒ same arc. |
| **MUTATE** | instant | One-shot random perturbation of macros / voice mix / effect levels by the intensity slider. Fires once per click. URL-seeded. |
| **JOURNEY** | ~20 min | Authored 4-phase ritual: arrival → bloom → suspension → dissolve. Replaces EVOLVE drift while active. Four shipped: morning, evening, dusk, void. URL-seeded. |
| **REC MOTION** | 60 s / 200 events | Captures live tonic / octave / macro / climate / LFO moves into the next share URL. On load, replays deterministically against the starting scene. Opt-in: enable in Settings → Advanced. |

**PARTNER** adds a sympathetic second voice layer at a fixed musical relation (fifth, octave-up, octave-down, +7 ¢ beat-detune). It's a voicing control, not a motion gesture — doubles voice count while active.

**Undo / redo + A/B slots** (SHAPE panel): a 50-entry debounced history of scene state. `Cmd/Ctrl+Z` undoes, `Cmd/Ctrl+Shift+Z` redoes. Two A/B slots (SAVE A / A recall / SAVE B / B recall) for compare-and-return workflows.

---

## LFO 2 · FLICKER

A second amplitude modulator inside the ADVANCED disclosure, covering **0.5 Hz → 45 Hz**. Integer-phase-locked to the breathing LFO (LFO 1) so the two modulators never drift against each other.

- **● ON / OFF** — power button. Off by default; the subtitle still describes the current state, prefixed `(off)`.
- **Rate slider** — zone-coloured gradient (δ delta / θ theta / α alpha / β beta / γ gamma) with tappable landmark ticks at 2 / 6 / 10 / 20 / 40 Hz and a dashed 7.83 Hz "Schumann" marker.
- **AM** — sums a second oscillator into the voice-gain param. Works on speakers. Slow rates sound like a swell, mid rates like tremolo, upper rates like metallic roughness.
- **DICHOTIC** — splits L/R pitch per voice by the SPREAD cents (applied to reed / metal / piano / fm / amp / tanpura). Headphones required for the phantom beat to fuse in the head.
- **BOTH** — both paths active.
- The subtitle rewrites live: e.g. `alpha-band pulse at 10.00 Hz · locked ×25 to breathing` or `L/R detune ±4.0 ¢ — headphones · locked ×25 to breathing`.

It's a second modulator in the tradition of Scelsi, Niblock and Radigue — drone pieces built on beating and slow amplitude changes.

---

## Mixer

Master-bus controls matched to the mpump / mloop family vocabulary:

- **HPF** with quick OFF / 20 / 30 / 40 Hz stepping
- **3-band EQ** (low, mid, high)
- **MUD** — toggleable peaking cut (-3.5 dB @ 300 Hz, Q=1.0). On by default; clears the lower-mid pile-up that drone stacks accumulate. Off when a thinner, more open body is wanted.
- **GLUE** — soft compressor amount
- **DRIVE** — soft-clip waveshaper (gentle `tanh` curve, native rate)
- **LIMITER** — look-ahead brickwall worklet (Chrome/FF, true-peak, 96-sample look-ahead) or native DynamicsCompressor (Safari) with ceiling control and release
- **WIDTH** — M/S width matrix; 0 = mono fold, 1 = identity, 2 = exaggerated sides. Bass under 120 Hz is always folded to mono regardless of width (pro-mix bass-mono rule)
- **ROOM** — parallel cathedral-IR send (real recording from Saint-Lawrence Church, Molenbeek-Wersbeek, Public Domain CC). Default 0; at 1 the wet sums at unity with the dry
- **COLOR** — single knob driving parallel saturation (asymmetric tanh + 5 Hz DC trap) and 4–10 kHz air-band exciter together; analog density and openness on one perceptual axis
- **SAFE** — headphone-safe mode, clamps outputTrim to −6 dBFS
- **FADE** — slow-envelope master fade in / out over 30 s / 2 min / 5 min / 20 min
- **CLIP LED** — taps the **pre-limiter** signal so it reports input overshoot, not the brickwall holding its ceiling
- **LUFS-S + PEAK** — EBU R128 K-weighted short-term (3 s window) loudness + sample-peak readout, updated ~30 Hz
- **VOL** — final output trim
- **Loudness-aware RND** — after each random-scene click the engine measures the new preset's LUFS and nudges a session-level trim so a string of RND clicks reads as roughly equal-loudness

---

## MEDITATE view

The header **◉ MEDITATE** toggle (next to HOLD) shows / hides an inline live-visualizer tile rendered above the WEATHER pad inside DRONE. The tile is 16:9 with a bottom **navigator strip**: visualizer dropdown · ◂ prev · ▸ next · ↻ reset · ↗ open. Tap the tile's canvas to expand to a fullscreen overlay; in fullscreen, an idle-fading bottom HUD exposes the same controls plus 🎲 random and ⛶ / ↙ pop-out.

25 authored visualizers organised into four **function-based** groups in the picker. Within each group, **B&W / monochromatic** visualizers are listed first, then **colour**. All share one warm parchment / ember palette so the visualizer surface reads as a coherent family rather than a grab-bag.

- **HARMONIC** — scenes that show the drone's pitch / tuning / phase / beats / voice identity. pitch beats, phase portrait, stereo vectorscope, beating field, resonant body, pitch tonnetz, waveform ring, harmonic ember.
- **LANDSCAPE** — slow accreting fields: rock carvings, textile, strata, tape. petroglyphs, illuminated glyphs, sediment strata, spectral prayer rug, tape decay.
- **RITUAL** — ornate / painterly / ceremonial. iron filings, cymatics, crystal lattice, scrying mirror, Rothko field.
- **VOID · HYPNOTIC** — minimal negative space or stroboscopic / psychotropic. void monolith, moiré field, feedback tunnel, shortwave static, flow field, star gate, dream machine *(10 Hz flicker — warning shown; close eyes for the classic usage)*.

Most visualizers follow a drone-native ethos: slow time, heavy / matte material, no per-frame fast reactivity. They **accrete over minutes** rather than react per-frame — SEDIMENT STRATA deposits rock layers at the bottom and the pile grows upward, PETROGLYPHS carves 24 authentic Camunian motifs (orante, warrior, archer, stag, sun-wheel, hut, scalariform, labyrinth, ibex, dancer, hunter, mounted rider, paddle/scepter, sun face, …) onto a weathered cliff face, ILLUMINATED GLYPHS stacks 32 gilt runes (12 canonical + 12 alternates + 8 alchemical: sun ☉, moon ☾, mercury ☿, venus ♀, mars ♂, saturn ♄, jupiter ♃, fire △) on dark vellum, RESONANT BODY blends the anatomies of whichever voices (TANPURA / REED / METAL / AIR / PIANO / FM / AMP / NOISE) are currently active into a single breathing organism, and HARMONIC EMBER burns the actual harmonic series as log-radius arcs on a polar plot with the core ember sized relative to canvas so loudness visibly scales.

TAPE DECAY reacts hard to **sound character**: spectral centroid drives the palette hue and scratch tilt, chord changes trigger splice flashes + per-pitch track ticks, transients ignite a row-sliced wow-flutter warp that decays over a few seconds, sustained low-band slowly accumulates a burn factor that scorches the scan band. BEATING FIELD takes the active pitch classes and renders their interference as slow horizontal bands. STEREO VECTORSCOPE shows L×R correlation via a 30-sample pseudo-stereo trace. SHORTWAVE STATIC gives each pitch class its own carrier on a tuning dial, with a live demodulated oscilloscope trace when the dial locks. VOID MONOLITH centres a tall slab whose width breathes with low-band energy, etches active pitches as horizontal bands, and sweeps travelling pulses + horizontal shockwaves on transients.

Dropdown in the tile or HUD picks the active visualizer; ◂ / ▸ cycles. **↻** fully reinitializes — clears every offscreen accumulator + live overlay so accreting visualizers start fresh. ↗ on the tile expands to fullscreen; ⛶ inside the HUD goes to true browser-fullscreen on the canvas. ↗ POP OUT in the HUD streams the canvas to a separate window for second-monitor use. 🎲 RND fires a random scene without leaving the visualizer.

---

## Sessions, Sharing, Recording

**Sessions** are named local saves in `localStorage`. Save / Load / Rename from the Settings modal.

A saved session includes the active preset, tonic / octave / mode, microtuning + relation + fine detune offsets, voice layers + levels, macros, climate, LFO, LFO 2 / FLICKER state (power + rate + mode + dichotic spread), effect toggles + per-effect levels, effect chain order, mixer, evolve seed, journey, partner, and the optional motion recording.

**Share URLs** build a compressed scene encoding of everything above. URLs are backward compatible — older URLs missing newer fields load with sensible defaults. Custom and authored tuning cents travel with the URL (see *Microtuning*).

**Recording** captures the final master output to a **24-bit stereo WAV** via a dedicated AudioWorklet tap. Samples are bit-identical to what the engine produced — no intermediate codec. Memory cost is ~44 MB per 10 minutes at 48 kHz, so render long sessions in shorter passes.

---

## Keyboard & MIDI

### Keyboard shortcuts

| Key | Action |
|---|---|
| `A W S E D F T G Y H U J` | Tonic (C C# D D# E F F# G G# A A# B) |
| `Z` / `X` | Octave down / up |
| `Space` | HOLD toggle |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `<` / `>` | Previous / next preset in group |

QWERTY tonic requires the ⌨ button enabled in the SHAPE column.

### MIDI

Web MIDI note-in retunes tonic + octave from external hardware. CC mapping with learn mode: click a target, move a knob to assign.

**~46 assignable targets** organised into groups that mirror the instrument:

| Group | Targets |
|---|---|
| Macros | DRIFT, AIR, TIME, SUB, BLOOM, GLIDE, MORPH, EVOLVE, PLUCK |
| Weather | WEATHER X, WEATHER Y, LFO RATE, LFO DEPTH |
| Mixer | VOL, HPF, EQ LOW / MID / HIGH, GLUE, DRIVE, CEILING |
| Voices | TANPURA, REED, METAL, AIR VX, PIANO, FM, AMP |
| Effects | TAPE, WOW, SUB (fx), COMB, DELAY, PLATE, HALL, SHIMMER, FREEZE, CISTERN, GRANULAR, GRAINCLOUD, RINGMOD, FORMANT |
| Triggers | HOLD, PANIC, RND, MUTATE (fire on rising edge ≥ 64; HOLD follows sustain-pedal state) |
| Presets | PRESET ◀ / ▶ (prev/next across the whole library), GROUP ◀ / ▶ (prev/next within the current group) — map four pads and walk the preset library live |

Defaults:

| CC | Default target |
|---|---|
| CC1 (mod wheel) | WEATHER Y |
| CC2 (breath) | WEATHER X |
| CC7 (volume) | VOL |
| CC64 (sustain) | HOLD |
| CC71–76 | DRIFT, AIR, TIME, BLOOM, GLIDE, SUB |

Every other target is unassigned by default — learn to bind.

### Tempo sync (Ableton Link)

mdrone has no transport clock (drones aren't timed), but the breathing LFO RATE now syncs to Ableton Link tempo. A small chip next to RATE cycles through **FREE / 1/1 / 1/2 / 1/4 / 1/8 / 1/16**; any non-FREE mode locks one LFO cycle to that note value at the Link session tempo. The macro slider becomes read-only while locked and follows tempo changes in real time.

mdrone reuses mpump's Link Bridge — a tiny cross-platform companion that bridges Ableton Link (UDP multicast) ↔ browser (WebSocket on localhost). Download once, works for both instruments.

1. **Download**: [github.com/gdamdam/mpump/releases](https://github.com/gdamdam/mpump/releases) — macOS / Windows / Linux binaries, ~5 MB
2. **Run** the bridge app (Tauri, opens a small always-on-top window)
3. **Enable** Ableton Link in mdrone → Settings → ABLETON LINK
4. Open Ableton Live (or any Link-enabled app) — tempo syncs automatically

Auto-detect also runs at page load — if the bridge is already running, mdrone attaches silently. Nothing leaves your machine: the bridge only makes local UDP (peer discovery on LAN) and localhost WebSocket connections.

Tanpura PLUCK sync is deferred — the current scheduling is randomized "every 5–7 seconds per string / rate" which doesn't map cleanly to beats. A bar-locked variant is future work.

---

## Interface

- 4 palettes: 3 warm dark (Ember, Copper, Dusk) + 1 light (Parchment, for bright rooms / stages)
- Responsive two-column layout that collapses for smaller screens
- Sticky header with transport, tonic, RND, session, recording, and MIDI access
- `docs/parameters.md` — auto-generated parameter reference (regenerate via `npm run docs:params`)

---

## Deployment

GitHub Pages deploy via the `gh-pages` package:

```bash
npm run deploy
```

That builds the app and publishes `dist/` to the `gh-pages` branch.

---

## Project Layout

```text
mdrone/
  public/
    about.html          # explainer / SEO page
    robots.txt          # allow search crawlers, block selected AI crawlers
    sitemap.xml         # crawlable URLs for search engines
  src/
    components/         # React UI — drone, meditate, mixer, header, footer, modals
    engine/             # Audio engine, voice builder, FX chain, worklet processors, presets, MIDI
    scene/              # Scene manager, scene model, snapshot/share plumbing
    styles/             # Global CSS
    microtuning.ts      # Tuning tables + custom-tuning registry
    App.tsx             # Singleton engine bootstrap + theme init
    config.ts           # App version + storage keys
    session.ts          # Saved session types + browser persistence helpers
    themes.ts           # Palette definitions and theme application
    types.ts            # Shared app types
  scripts/
    build-worklet.mjs       # Concatenates voice modules into droneVoiceProcessor.js
    build-parameters-doc.mjs # Regenerates docs/parameters.md
    write-version-json.mjs  # Writes public/version.json for the footer
  tests/                # node:test suites — codec, sessions, presets, DSP smoke
```

---

## Privacy

mdrone does not use accounts, cookies, ads, or personal tracking.

### Anonymous page counts

mdrone uses [GoatCounter](https://goatcounter.com) for anonymous, cookieless page-view counting. GoatCounter does not collect personal data, does not use cookies, and does not track across sites.

Besides page-views, mdrone counts a handful of anonymous feature events (preset applied, visualizer picked, share created, etc.) deduped once per page-load. No IDs, no correlation, no timings. DNT disables all counting.

### What mdrone does not collect

- **No accounts** — no sign-up, email, or profile
- **No cookies** — no login, ad, or tracking cookies
- **No user IDs** — no persistent personal identifier
- **No fingerprinting** — no device/browser identity
- **No ad networks** — no third-party ad or surveillance trackers

### What stays local

- **Sessions** — `localStorage` on your device
- **Audio** — synthesised locally via Web Audio and AudioWorklet
- **Recordings** — rendered and downloaded locally
- **Custom tunings** — `localStorage`
- **Open source** — full codebase on [GitHub](https://github.com/gdamdam/mdrone)

### Hosting

mdrone is hosted on [GitHub Pages](https://pages.github.com). Normal search crawlers are allowed via `robots.txt`. The sitemap advertises the public explainer at `/about.html`.

Your drone stays on your device. Always.

---

## License

[AGPL-3.0](LICENSE)

## Trademark

"mdrone" is an unregistered trademark of the author. Use of the name or logo for derivative projects or services may cause confusion and is not permitted.

---

Built with Claude Code. Design, architecture, UX, audio chain, and creative direction by [gdamdam](https://github.com/gdamdam).
