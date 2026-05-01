<h1 align="center">mdrone</h1>

<p align="center">
  <a href="https://github.com/gdamdam/mdrone"><img src="https://img.shields.io/github/package-json/v/gdamdam/mdrone?color=blue&label=version" alt="Version"></a>
  <a href="https://github.com/gdamdam/mdrone/actions/workflows/ci.yml"><img src="https://github.com/gdamdam/mdrone/workflows/CI/badge.svg" alt="CI"></a>
  <a href="https://github.com/gdamdam/mdrone/actions/workflows/stage-hardening.yml"><img src="https://github.com/gdamdam/mdrone/actions/workflows/stage-hardening.yml/badge.svg" alt="Stage hardening"></a>
  <a href="https://github.com/gdamdam/mdrone/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/Web%20Audio-API-FF6600" alt="Web Audio API">
  <img src="https://img.shields.io/badge/AudioWorklet-DSP-FF6600" alt="AudioWorklet">
</p>

<p align="center"><strong>Hold a note. Shape the air. Save the atmosphere.</strong><br><br>A microtonal drone instrument in your browser.<br>Hand-authored voices, long-form motion, recordable scenes.<br>No install. No account. Free.</p>

<p align="center">
  <a href="https://mdrone.org/">https://mdrone.org/</a>
</p>

<p align="center">
  <img src="public/mdrone_screenshot.png" alt="mdrone screenshot" width="1200">
</p>

---

## What it does

- **Holds a drone in the browser** — pick a tonic, a mode, layer voices, and the sound is there. Open the page, press play, leave it on for an hour.
- **Shapes sound slowly** — macros, a breathing LFO, a second flicker LFO, and an XY WEATHER pad for brightness and motion.
- **Builds real texture** — eight authored voice models (TANPURA, REED, METAL, AIR, PIANO, FM, AMP, NOISE) and a 15-effect chain with plate, shimmer, freeze, hall, cistern, granular, and harmonic-bloom HALO engines.
- **Evolves on its own** — preset morphing, deterministic self-evolution, one-shot mutation, authored multi-phase JOURNEYs, a sympathetic PARTNER voice, and recordable gesture replay.
- **Tunes microtonally** — 6 built-in tuning tables, 20 curated authored tunings (Pythagorean, Kirnberger III, 31-TET, Yaman, Bayati, the house **mdrone Signature** hybrid…), 6 relation presets, a Scale Editor for your own 13-degree tables, per-interval ±25 ¢ fine detune, and a **GOOD DRONE** one-click guided-randomize.
- **Visualises** — an inline live-visualizer tile and a fullscreen MEDITATE overlay with 25 authored visualizers (harmonic, landscape, ritual, void) sharing one warm parchment / ember palette.
- **Mixes** — a master-bus drawer with HPF, EQ, mud trim, glue, drive, look-ahead limiter, parallel cathedral-IR room send, color saturation, M/S width, headphone-safe mode, and LUFS / peak metering.
- **Saves + shares** — named local sessions, share-URL encoding of the full scene (plus optional gesture recording and custom tuning cents), 24-bit WAV master capture.
- **Works offline + installs** — full service worker; once the page loads, you can hold a drone in airplane mode. "Add to home screen" on iOS / "Install" on desktop runs it as a standalone PWA.

---

## Table of Contents

- [Layout](#layout)
- [Audio Engine](#audio-engine)
- [Voices](#voices)
- [Effects](#effects)
- [Microtuning](#microtuning)
- [Motion & Evolution](#motion--evolution)
- [Mixer](#mixer)
- [Visualizers](#visualizers)
- [Sessions, Sharing, Recording](#sessions-sharing-recording)
- [Keyboard, MIDI & Link](#keyboard-midi--link)
- [Accessibility](#accessibility)
- [Privacy](#privacy)
- [Reliability & Diagnostics](#reliability--diagnostics)
- [Going Deeper](#going-deeper)
- [License](#license)

---

## Layout

mdrone is one screen — the **DRONE** instrument — with two surfaces that slide in on demand:

- The header **◉ MEDITATE** toggle reveals an inline 16:9 live visualizer above the WEATHER pad. Tap it to expand fullscreen.
- The header **MIXER** button (next to VOL) slides up the master-bus drawer.

Everything else — header transport, preset library, voice stack, macros, breathing LFO, climate XY pad, effect chain, undo / redo + A/B snapshots, SCALE editor, GESTURES panel — lives in the main DRONE column.

---

## Audio Engine

All sound is synthesised in real time with the Web Audio API and AudioWorklet. No samples are loaded for the voices.

- **Voices** are AudioWorklet-backed. Each layer spawns one worklet voice per interval in the selected mode, mixed through per-layer gains. Tonic changes glide; interval changes rebuild with a short crossfade. Each voice carries a sub-Hz pitch-drift LFO so the stack breathes, and is panned across the stereo field for true separation.
- **Climate** — the WEATHER XY pad drives brightness on X and motion on Y. A user LFO adds slow breathing on voice gain. A second LFO (FLICKER, 0.5–45 Hz) is integer-phase-locked to the breather and offers AM, dichotic L/R detune, or both.
- **Effect chain** — 15 effects, drag-reorderable, each runnable serial (insert) or parallel (send) per preset.
- **Master bus** — HPF, 3-band EQ, optional mud trim, glue compression, drive, parallel cathedral-IR room send, color saturation + air exciter, look-ahead brickwall limiter (Chrome / FF; Safari falls back to native compression), bass-mono fold, M/S width, session-level loudness leveling, and pre/post-limiter analyser taps.
- **Reverbs** — PLATE uses a real EMT 140 IR (Greg Hopkins, CC-BY); HALL and CISTERN are FDN worklets; the master ROOM send uses a recording of Saint-Lawrence Church, Molenbeek-Wersbeek (Public Domain CC).
- **Determinism** — IR seeds and evolve drift derive from a per-scene PRNG (FNV-1a hash of the preset ID or share-URL seed). Same URL ⇒ same tail.
- **Recording** — the final post-limiter master is captured to **24-bit stereo WAV** through a dedicated worklet tap (bit-identical, no codec).
- **Adaptive stability** — when the audio thread is sustainedly struggling (drift between `AudioContext.currentTime` and wall-clock), the engine auto-mitigates in three stages, each gated by a cooldown so the graph isn't flapped on noisy signals:
  1. **Visuals** — engages a low-power overlay (clamps MEDITATE FPS and the loudness meter). Composed with the user's persisted setting; never overwrites it.
  2. **Heavy FX** — temporarily suppresses shimmer / granular / graincloud / halo. The FxBar still shows them as ON with a striped "suppressed" cue, since user intent is preserved — autosave, share URLs, and snapshots all read user-intent state, not the runtime overlay.
  3. **Voice density** — progressively lowers the max active voice layers. The first reduction is decisive (7 → 4); continued struggle steps further (4 → 3) down to a musical floor of 3. The original cap is restored on recovery.
  Mitigation is fast (~9 s cooldown). Recovery is slow (~20 s cooldown + a 30 s underrun-free window) so a brief lull doesn't bounce a performance back into danger. Stages unwind one at a time. Notifications are calm and infrequent ("Audio under load — simplifying FX.", "Audio recovered."). Saved scenes, share URLs, and persisted settings are never mutated — mitigation is runtime-only.

---

## Voices

Eight authored models with per-voice physicality (jawari nonlinearity, soundboard coupling, bellows AM, modal bowls, cabinet shaping, noise colour).

| Voice | Character |
|---|---|
| **TANPURA** | Karplus-Strong plucked string with jawari nonlinearity + auto-repluck. Classical tuning options (unison, Sa-Pa, Sa-Ma, Sa-Ni). |
| **REED** | Harmonium / shruti-box additive reed stack with bellows motion. `shape` selects clarinet / bowed / organ / sine. |
| **METAL** | Inharmonic partial cloud with slow re-excitation — singing-bowl, bell. |
| **AIR** | Pink-noise resonator for tuned wind, breath, open-pipe texture. |
| **PIANO** | Long-decay felted sustain layer. |
| **FM** | Dual-operator FM voice with slow index drift — DX7-style bells that stay alive. |
| **AMP** | Sustained amp / cabinet drone with harmonic body, oversampled drive. |
| **NOISE** | Coloured noise bed (white → brown) — tape hiss, cistern air, chamber floor. |

---

## Effects

15 effects, click to toggle, long-press for the settings modal (AMOUNT + per-effect params). Drag to reorder.

| Effect | Character |
|---|---|
| **TAPE** | Saturation, head bump, top-end rolloff |
| **WOW** | Slow wow + faster flutter on a short delay line |
| **SUB** | True octave-down subharmonic (triangle, amplitude-tracked, parallel sum) |
| **COMB** | Root-tracking resonant comb with soft-clipped feedback |
| **RINGMOD** | Inharmonic shimmer and bell sidebands |
| **FORMANT** | Parallel band-pass vowel formant body |
| **DELAY** | Warm feedback delay, lowpass + saturation in the loop |
| **PLATE** | Convolution plate (EMT 140 IR) |
| **HALL** | FDN hall worklet |
| **SHIMMER** | Shimmer worklet + octave-up source voice |
| **FREEZE** | Phase-vocoder magnitude-hold capture |
| **CISTERN** | FDN cathedral-scale worklet (~28 s tail) |
| **GRANULAR** | Drone-smooth grain cloud, envelope-sum normalised |
| **GRAINCLOUD** | Classic 40 ms grain stutter, pitches snapped to scale |
| **HALO** | Multi-band harmonic-partial bloom — synthesises upper partials over the drone with adjustable tilt |

---

## Microtuning

- **6 built-in tuning tables** — equal (12-TET), just 5-limit, ¼-comma meantone, harmonic series, maqam rast, slendro.
- **20 curated authored tunings** — historical (Pythagorean, Kirnberger III, Werckmeister III, Young 7-limit, Just 7-limit, Partch 11-limit), xenharmonic EDOs (15-TET, 17-TET, 19-TET, 22-EDO, 31-TET), world (Yaman, Pelog, Bayati), concept (Otonal 16:32, Spectral Primes, Skewed Pythagorean, Cluster 22-Sruti, Hollow open-fifth), and the house **mdrone Signature** just × 31-TET hybrid.
- **6 relation presets** — unison, tonic-fifth, tonic-fourth, minor triad, drone triad, harmonic stack.
- **±25 ¢ fine detune per interval**, retunes voices live.
- **GOOD DRONE** — one-click guided randomize that picks a drone-friendly tuning + relation and adds gentle ±2–5 ¢ detune.
- **Scale Editor** — author your own 13-degree table in cents and save it locally; shared URLs bundle the full cents array so recipients reproduce authored microtonality exactly.

---

## Motion & Evolution

Five systems arranged by timescale. MORPH and EVOLVE are continuous macros; the rest live in the GESTURES panel.

| System | Timescale | What it does |
|---|---|---|
| **MORPH** | seconds | Cross-fade time when loading another preset. 0 = snap, 1 = ~20 s glacial. |
| **EVOLVE** | minutes | Continuous URL-seeded drift while a preset is held. |
| **MUTATE** | instant | One-shot random perturbation of macros / mix / fx, scaled by intensity. |
| **JOURNEY** | ~20 min | Authored 4-phase ritual (arrival → bloom → suspension → dissolve). Four shipped: morning, evening, dusk, void. |
| **REC MOTION** | 60 s / 200 events | Records live moves into the share URL; replays deterministically on load. |

**PARTNER** layers a sympathetic second voice at a fixed musical relation (fifth, octave, beat-detuned). **Undo / redo + A/B slots** keep a 50-entry history with two compare-and-return slots.

---

## Mixer

Master-bus drawer with: **HPF**, **3-band EQ**, **MUD** trim, **GLUE**, **DRIVE**, **LIMITER** (look-ahead worklet on Chrome/FF, native on Safari), **WIDTH** (M/S with bass-mono fold under 120 Hz), **ROOM** (cathedral-IR send), **COLOR** (saturation + air exciter on one knob), **SAFE** headphone-safe mode, **FADE** (30 s → 20 min), pre-limiter **CLIP LED**, **LUFS-S + PEAK** meters, and **VOL**. RND clicks are loudness-aware so a string of random presets reads roughly equal-loudness.

---

## Visualizers

25 authored visualizers in four function-based groups (B&W first within each):

- **HARMONIC** — pitch / phase / beat / voice-identity scenes (phase portrait, vectorscope, beating field, resonant body, tonnetz, harmonic ember…).
- **LANDSCAPE** — slow accreting fields (petroglyphs, illuminated glyphs, sediment strata, prayer rug, tape decay).
- **RITUAL** — ornate / painterly (iron filings, cymatics, crystal lattice, scrying mirror, Rothko field).
- **VOID · HYPNOTIC** — minimal or stroboscopic (void monolith, moiré, feedback tunnel, shortwave static, dream machine — *10 Hz flicker, warning shown*).

Drone-native ethos: slow time, matte material, accrete over minutes rather than react per-frame.

---

## Sessions, Sharing, Recording

- **Sessions** are named local saves in `localStorage` (Settings modal). They include scene, tuning + detune, voices, macros, climate, both LFOs, effect chain, mixer, evolve seed, journey, partner, and the optional motion recording.
- **Share URLs** compress the full scene; older URLs load with sensible defaults for newer fields. Custom and authored tuning cents travel inside the URL.
- **REC WAV** captures the post-limiter master to 24-bit stereo WAV via a parallel worklet tap (bit-identical, no codec). The button auto-starts HOLD if the drone isn't already playing, so you never get a silent file. Saves as `mdrone-<scene>-<YYYY-MM-DD-HHMM>.wav`, confirms with a `WAV saved — M:SS` toast, and prompts before close/reload while recording is active. The button tooltip surfaces live elapsed time and estimated in-memory size while recording — the browser is not a DAW, so for long sessions:
  - **Recommended max take length: 30 minutes.** Float32 stereo at 48 kHz grows ~44 MB per 10 min in memory until stop. Staged toast warnings fire at 10, 20, and 30 min so you can decide to stop and start a new take.
  - **Segmented recording** is supported by the engine: pass `segmentMinutes` to `startMasterRecording({ segmentMinutes, onSegment })` and the recorder finalizes a WAV every N minutes without dropping samples, naming files `mdrone-<scene>-<timestamp>-pt01.wav`, `pt02`, … so a long take stays bounded in memory per segment.
- **LOOP** bounces a short seamless-loop WAV at the selected length with a linear crossfade at the seam and a RIFF `smpl` chunk so samplers auto-detect the loop region.
- **REC MOTION** is a separate, opt-in capture of your live gestures (60 s / 200 events) that travels inside the share URL — not an audio file. Three captures, three concepts: **REC WAV** = audio file · **LOOP** = sampler-ready loop WAV · **REC MOTION** = gesture replay encoded into a share link.

---

## Keyboard, MIDI & Link

**Keyboard** — `A W S E D F T G Y H U J` for tonic, `Z` / `X` for octave, `Space` for HOLD, `Cmd/Ctrl+Z` / `Shift+Z` for undo / redo, `<` / `>` for previous / next preset.

**MIDI** — Web MIDI note-in retunes tonic + octave. The header **MIDI ▾** dropdown holds INPUT toggle, an Ableton-style **LEARN MODE** (click any control, wiggle a CC to bind), and a **MAPPING…** modal with templates and JSON import / export. ~52 assignable targets across macros, weather, mixer, voices, effects, triggers, and preset stepping. Multiple CCs per target are supported. Defaults: CC1 → WEATHER Y, CC2 → WEATHER X, CC7 → VOL, CC64 → HOLD, CC71–76 → DRIFT, AIR, TIME, BLOOM, GLIDE, SUB.

**Ableton Link** — the breathing LFO RATE syncs to Link tempo via a small chip (FREE / 1/1 / 1/2 / 1/4 / 1/8 / 1/16). mdrone reuses mpump's [Link Bridge](https://github.com/gdamdam/mpump/releases) — a tiny cross-platform companion that bridges Link (UDP multicast) ↔ browser (localhost WebSocket). Run the bridge, enable Link in Settings, and any Link-enabled app syncs automatically. Nothing leaves your machine.

---

## Accessibility

- **`prefers-reduced-motion` honoured.** When your OS asks for reduced motion, the **DREAM MACHINE** 10 Hz strobe is replaced by a slow ~0.2 Hz breath, and looping decorative animations (header marquee, MIDI-learn pulses, weather glow) are muted. Audible content is unaffected.
- **Screen-reader labels** on every icon button and canvas (MEDITATE visualizer, WEATHER pad, VU meter).
- **44 × 44 touch targets** on touch devices — the compact mouse UI is preserved on desktop.
- **Top-level error boundary** so a render exception in one panel doesn't blank the whole app.
- **Low-Power Mode** (Settings → SESSION → LOW-POWER MODE, off by default) — for older laptops, low-end Windows machines, and weak tablets. Clamps the MEDITATE visualizer to 15 fps, throttles the loudness meter to 5 Hz, and skips the master-bus preset-change duck.

## Privacy

mdrone has no accounts, no cookies, no ads, no fingerprinting, no third-party trackers. Sessions, custom tunings, and recordings stay on your device. Anonymous, cookieless page-view counting via [GoatCounter](https://goatcounter.com); a handful of feature events are deduped once per page-load. DNT disables all counting. Hosted on GitHub Pages.

---

## Reliability & Diagnostics

Three layered systems exist for keeping audio stable and debugging it when something slips.

- **Adaptive stability** — described under [Audio Engine](#audio-engine). Reactive: the engine itself responds to sustained struggle by dropping visuals → heavy FX → voice density and restoring conservatively after a stable window.
- **LIVE SAFE** — explicit user-initiated mode, surfaced as a **LIVE SAFE pill in the header** (next to MIXER) and also reachable from *Settings → LIVE SAFE*. Trades richness for reliability before stepping on stage: clamps the voice cap to 4, suppresses the heaviest FX (halo / granular / graincloud / shimmer / freeze / cistern), engages low-power visuals. The pill goes steady red-orange when active — distinct from the auto CPU-warning blink — so the stage state is impossible to miss during a set, and the tooltip shows how many heavy FX are currently bypassed. Conservative revert: if you change something while LIVE SAFE is on, your change wins on disable. Saved scenes and share URLs are not modified. A derived `stageRiskOf(preset)` helper classifies presets `low | medium | high` from voice density × heavy-FX intersection, with an optional per-preset `stageRiskOverride` escape hatch for the rare measures-heavy-but-fine case.
- **Preset certification** — hands-and-ears auditioning devtool installed on `window.__presetCert` (see `src/devtools/presetCertification.ts`). `await __presetCert.start({ auditionMs, requireAudition })` steps through every visible preset; `requireAudition: true` rejects `mark()` until the listening window has elapsed, so the semi-automated flow can enforce a real audition. Each entry captures voice layers, user-intended FX, adaptive stage, underrun count, and an environment snapshot (UA, AudioContext sampleRate / baseLatency / outputLatency / state / audioWorklet) alongside human tag / scores / verdict / notes. Export as Markdown or JSON. The offline `npm run audit:presets` (LUFS, peak, RMS, DC, band energy, L/R correlation per preset) and a runtime cert export merge into one report via `npm run audit:certify` → `tmp/preset-certification.md`.
- **Copy Audio Report** — when the *CPU* warning indicator appears, tapping it opens a detail modal with a **COPY AUDIO REPORT** button. Produces a structured Markdown payload (browser/device, AudioContext, load monitor, adaptive + LIVE SAFE state, voice cap, user-intended vs effective FX, mixer state, audio-debug flags, optional trace ring). The same report is available in the console as `await __mdroneAudioReport()`. URLs are reduced to origin + path so share-encoded scene data is never included; localStorage / session names / custom tuning arrays are not read.

If the audio thread hashes or crackles, reload with `?audio-debug=trace` in the URL to enable a 512-event ring buffer. Underruns auto-dump it; `__mdroneDumpTrace()` triggers a manual dump. Per-stage bypass flags (`?audio-debug=no-fx`, `no-master`, `no-limiter`, `no-glue`, `no-eq`, etc.) help isolate which DSP stage is responsible.

The voice worklet's `sanitizeState()` clamps non-finite feedback state to 0 once per block. When that clamp ever fires it now posts a `nan-diag` message back to the main thread (throttled to ~once per second per voice) which the console surfaces as `[mdrone:nan-diag] voice=<type> fires=<n> {field: count, ...}`. Open the console while playing — silence means the engine never produces NaN/Infinity in real use; any output names the voice and state field so the underlying instability can be fixed at the source.

### Stage hardening

The path from "passes Chromium smoke tests" to "credible live instrument" is documented in [`docs/stage-hardening.md`](docs/stage-hardening.md). The short version:

- **Browser matrix** — `npm run test:e2e:all` runs the full suite across `chromium`, `firefox`, `webkit`, and `edge` projects defined in `playwright.config.ts`. Install browsers with `npx playwright install chromium firefox webkit`. PR CI keeps Chromium-only via `npm run test:e2e` so it stays fast.
- **Long-hold audio burn-in** — `MDRONE_LONG_HOLD=1 LONG_HOLD_MS=900000 npm run test:e2e:long` runs `e2e/audio-longhold.spec.ts`, which loads a heavy preset, holds for the configured duration, then asserts AudioContext stays running, underruns stay within budget, adaptive stage stays within budget, and the load monitor isn't struggling at the end. Knobs: `LONG_HOLD_MS`, `MDRONE_LONG_HOLD_PRESET` (default `High Shimmer`), `MDRONE_LONG_HOLD_MAX_UNDERRUNS` (default `0`), `MDRONE_LONG_HOLD_MAX_ADAPTIVE_STAGE` (default `1`).
- **Scheduled CI** — `.github/workflows/stage-hardening.yml` runs daily and on manual dispatch across Ubuntu Chromium, Ubuntu Firefox, macOS WebKit, Windows Chromium, and Windows Edge. Each job runs the fast e2e for its browser project then the long-hold audio burn-in. Intentionally separate from PR CI.
- **Real Safari / iOS checklist** — Playwright WebKit is not the same as real Safari or iOS Safari. Before calling a release stage-ready, the doc lists a manual checklist: 60 min default-preset hold, 30 min heavy-preset hold, RND torture, LIVE SAFE toggle under playback, 10-min WAV record, background/foreground, sleep/wake, Bluetooth headphones — and archive a Copy Audio Report after each.

---

## Going Deeper

If you want to dig past the overview:

- **Parameter reference** — `docs/parameters.md` is auto-generated; regenerate via `npm run docs:params`.
- **Source layout** — `src/components/` (React UI), `src/engine/` (audio engine, voices, FX, worklets, presets, MIDI), `src/scene/` (scene model, share/snapshot codec), `src/microtuning.ts` (tuning tables + custom registry), `scripts/` (worklet bundle, doc + version generators), `tests/` (node:test suites).
- **Local dev** — standard Vite app: `npm run dev` for the dev server, `npm run build` for a production bundle, `npm run test` / `npm run test:unit` / `npm run test:e2e` for the three test suites. Stage-hardening commands: `npm run test:e2e:all` (cross-browser), `npm run test:e2e:long` (long-hold audio burn-in), `npm run audit:presets` (offline LUFS / peak / band-energy per preset), `npm run audit:certify` (merge offline audit + runtime cert into one Markdown report).
- **CI** — every push to `main` and every PR runs lint + typecheck + node tests + vitest + Playwright E2E + build via `.github/workflows/ci.yml`. The separate `.github/workflows/stage-hardening.yml` runs the cross-browser matrix and long-hold burn-in daily and on manual dispatch. Status visible from the badge above.
- **Releases** — tag-gated, not push-to-main. To cut a release:
  ```
  npm run release           # bumps patch (or `release minor` / `release major` / `release X.Y.Z`),
                            # regenerates CHANGELOG.md from git history, stages both files
  git commit -m "X.Y.Z — release: <summary>"
  git tag vX.Y.Z
  git push origin main --tags
  ```
  The `--tags` push triggers `.github/workflows/deploy.yml`, which re-runs every CI check and only then publishes `dist/` to the `gh-pages` branch (mdrone.org). Push to `main` without a tag never deploys — every commit is *checked* but doesn't ship until you cut a release. `npm run deploy` still exists as a manual escape hatch from a developer machine.
- **Code** — full source on [GitHub](https://github.com/gdamdam/mdrone).

---

## License

[AGPL-3.0](LICENSE)

## Trademark

"mdrone" is an unregistered trademark of the author. Use of the name or logo for derivative projects or services may cause confusion and is not permitted.

---

Built with Claude Code. Design, architecture, UX, audio chain, and creative direction by [gdamdam](https://github.com/gdamdam).
