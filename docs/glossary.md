# mdrone — Glossary of Musical & Technical Terms

A reference for every musical, acoustic, DSP, and tuning term that appears in the mdrone UI, README, or share-link surface. Plain-language definitions written for a curious user, not a DSP engineer.

---

## 1. Drone fundamentals

- **Drone** — A continuously sustained pitch (or stack of pitches). The instrument's whole reason for existing: a sound that *holds* rather than starts and stops.
- **Tonic** — The "home" note of the scale. Selected by the keyboard row `A W S E D F T G Y H U J`. Everything else in mdrone is tuned in relation to this.
- **Octave** — A doubling (or halving) of frequency. `Z` / `X` shift the tonic up or down an octave; filenames encode it as `a2`, `fs3`, etc.
- **Mode** — The set of intervals (relative to the tonic) that the active voices play. Examples used inside mdrone: unison, tonic-fifth, tonic-fourth, minor triad, drone triad, harmonic stack.
- **Interval** — The musical distance between two pitches (e.g. a fifth, a fourth, an octave). mdrone exposes 13 interval slots per scale.
- **Voice / Layer** — A single sustained sound source. mdrone stacks multiple voices, each tuned to one interval of the chosen mode.
- **HOLD** — The single Play / Stop control for the drone. Spacebar.
- **PARTNER** — A sympathetic second voice locked at a fixed musical relation to the tonic (fifth, octave, beat-detuned).

---

## 2. Voices (the eight authored instruments)

- **TANPURA** — A long-necked Indian plucked drone instrument. Modeled here with **Karplus-Strong** synthesis (a feedback-delay technique that imitates a plucked string), plus **jawari** — the buzzing nonlinearity created by the curved tanpura bridge that gives the instrument its shimmer. *Auto-repluck* re-excites the string at musical intervals. Tuning options reference Indian classical: **Sa** (tonic), **Pa** (fifth), **Ma** (fourth), **Ni** (seventh).
- **REED** — Models a **harmonium** / **shruti box** (Indian bellows-driven free-reed instruments). Built as an *additive reed stack* (multiple harmonics summed) with **bellows AM** (amplitude modulation imitating the breathing of the bellows). Shapes: clarinet, bowed, organ, sine.
- **METAL** — *Inharmonic* partial cloud — partials that are NOT integer multiples of the fundamental, like a struck bell or singing bowl. Slow re-excitation gives the impression of a continually rung body.
- **AIR** — A **pink-noise resonator**: filtered noise tuned to a pitch. Produces wind, breath, and open-pipe textures.
- **PIANO** — Long-decay **felted** piano sustain. Felting damps the hammer attack, leaving the body resonance.
- **FM** — **Frequency Modulation** synthesis with two operators (carrier + modulator). Slow *index drift* shifts the brightness over time. The DX7 reference points to Yamaha's classic FM bell sound.
- **AMP** — Sustained amplifier / cabinet drone with **harmonic body** and **oversampled drive** (saturated at a higher sample rate to reduce aliasing).
- **NOISE** — Coloured noise (white through brown). **COLOR** is the spectral tilt; brown noise has more low end, white is flat across the spectrum.

### Voice physics terms used in the README

- **Karplus-Strong** — Plucked-string algorithm using a delay line + low-pass feedback.
- **Jawari** — Sanskrit/Hindi term for the angled bridge of a tanpura/sitar that produces the buzzing, harmonic-rich tone.
- **Soundboard coupling** — Models how the resonant body re-radiates string energy.
- **Modal bowls** — Bell / bowl modeled as a sum of vibrational modes (inharmonic partials).
- **Cabinet shaping** — EQ + nonlinearity of an amplifier speaker cabinet.

---

## 3. Effects (the FX chain)

15 effects, click to toggle, long-press for AMOUNT + per-effect params, drag to reorder.

- **TAPE** — Saturation + low-pass head bump + top-end rolloff that imitates analog tape.
- **WOW & FLUTTER** — Slow pitch wobble (wow, ~0.5 Hz) + faster wobble (flutter, ~5 Hz) — pitch-instability artifacts of tape transports.
- **SUB** — A clean octave-down voice generated from the source by amplitude tracking (true subharmonic, not pitch-shifted). Triangle wave summed in parallel.
- **COMB** — A **comb filter**: a delay + feedback creating evenly spaced spectral peaks/notches. Root-tracking means the resonance follows the tonic.
- **RINGMOD** — **Ring modulation**: multiplying two signals together to produce sum and difference frequencies. Yields inharmonic, bell-like sidebands.
- **FORMANT** — Vowel-like resonant peaks. mdrone uses parallel band-pass filters tuned to vowel formants (the resonances of the human vocal tract).
- **DELAY** — Echo line with low-pass and saturation in the feedback path so repeats darken and warm rather than build up brittle.
- **PLATE** — A **convolution reverb** using an impulse response (IR) of an **EMT 140** electromechanical plate reverb (Greg Hopkins, CC-BY).
- **HALL** — A **Feedback Delay Network** (FDN) reverb worklet — multiple cross-fed delay lines simulating room reflections.
- **SHIMMER** — A reverb with an octave-up feedback path that pitches each repeat upward, producing endless ascending overtones (popularized by Eno / Lanois).
- **FREEZE** — A **phase-vocoder** magnitude-hold: captures the frequency-domain magnitudes of one moment and sustains them indefinitely.
- **CISTERN** — Cathedral-scale FDN reverb with ~28 s tail, evoking a cistern or tomb.
- **GRANULAR** — Sound made from many tiny grains (windowed snippets, ~50–200 ms). Drone-smoothed and envelope-sum normalised.
- **GRAINCLOUD** — Classic 40 ms grain stutter; output pitches snap to the active scale.
- **HALO** — Multi-band **harmonic-partial bloom**: synthesises upper partials of the drone with adjustable spectral tilt.

### General DSP / FX terms

- **IR (Impulse Response)** — A short recording of how a space (or device) responds to a click. Convolving any signal with an IR places that signal in that space.
- **Convolution reverb** — Reverb generated by IR convolution (vs. algorithmic FDN reverbs).
- **FDN (Feedback Delay Network)** — A reverb algorithm: matrix of cross-fed delay lines.
- **Phase vocoder** — STFT-based time/frequency manipulation; basis for FREEZE and pitch-shift.
- **Insert vs send** — *Insert* (serial) routes the whole signal through the effect; *send* (parallel) mixes a wet copy alongside the dry signal.
- **AMOUNT** — Per-FX wet level (the per-tile mini-slider).

---

## 4. Microtuning

- **Cents (¢)** — 1/100 of a semitone, 1/1200 of an octave. Unit for fine pitch differences.
- **12-TET** — **Twelve-Tone Equal Temperament**: the modern western standard, octave divided into 12 equal steps. Default tuning.
- **Just Intonation (5-limit, 7-limit, 11-limit)** — Tunings built from small-integer frequency ratios. The "limit" is the largest prime in the ratios used (5-limit = uses primes ≤ 5, etc.). Yields the cleanest, beat-free intervals.
- **Pythagorean** — Tuning derived from stacking pure 3:2 fifths. Sweet fifths, sharp thirds.
- **¼-comma meantone** — Renaissance/baroque tuning; tempers fifths flat by ¼ of a syntonic comma to make pure major thirds.
- **Kirnberger III** — A late-baroque well-temperament that keeps several pure intervals while making all keys playable.
- **Werckmeister III** — Another well-temperament (1691, Andreas Werckmeister), one of the first systems where every key works.
- **Young 7-limit** — A Lou Harrison / La Monte Young style 7-limit just tuning.
- **Partch 11-limit** — Harry Partch's 43-tone just system; *11-limit* means it includes ratios using 11.
- **EDO / TET** — *Equal Divisions of the Octave* / *Tone Equal Temperament*. **15-TET, 17-TET, 19-TET, 22-EDO, 31-TET** divide the octave into that many equal steps. 31-TET is famous for near-just thirds and meantone-like fifths.
- **Xenharmonic** — Music in tunings outside 12-TET.
- **Yaman** — A North-Indian raga (Kalyan thaat); used here as a tuning preset.
- **Pelog / Slendro** — Two scales of Indonesian gamelan. Pelog is 7-tone, unevenly spaced; slendro is 5-tone, near-equal.
- **Bayati** — A maqam (Arabic mode) using a **half-flat** second degree (a quarter-tone interval).
- **Maqam Rast** — The "fundamental" Arabic maqam, featuring three-quarter-tone (~150 ¢) steps.
- **22-Sruti** — The 22 microtonal pitch positions per octave used in classical Indian theory; "Cluster" here is mdrone's stylization.
- **Otonal / Utonal** — Harry Partch's terms. *Otonal* = built on the overtone series (1:2:3:4…). *Utonal* = its inversion (subharmonic).
- **Spectral primes** — Tuning derived from prime-numbered partials of the harmonic series.
- **Hollow open-fifth** — Tuning emphasising bare 3:2s with no thirds (medieval / power-chord sound).
- **Harmonic series** — The natural overtone series (1, 2, 3, 4, 5… × fundamental). The acoustic basis of timbre and many tunings.
- **Relation preset** — The set of intervals layered above the tonic (unison / fifth / fourth / minor triad / drone triad / harmonic stack).
- **Detune (±25 ¢)** — Per-interval fine-pitch offset, retuned live.
- **ATTUNE** — Guided-randomize of tuning + relation + ±2–5 ¢ detune.
- **Scale Editor** — Author your own 13-degree cents table.

---

## 5. Motion, evolution & gesture

- **MORPH** — The cross-fade duration when loading another preset. 0 = snap; 1 = ~20 s glacial.
- **EVOLVE** — Continuous URL-seeded drift of macros while a preset is held.
- **MUTATE** — One-shot random perturbation of macros / mix / FX.
- **JOURNEY** — A 4-phase ritual arc: *arrival → bloom → suspension → dissolve* (~20 min).
- **REC MOTION** — Records 60 s / 200 events of live UI gestures; replays deterministically inside the share URL.
- **LFO (Low-Frequency Oscillator)** — A sub-audio oscillator used to modulate other parameters. mdrone has two:
  - **Breather LFO** — Slow gain modulation across all voices.
  - **FLICKER LFO** (0.5–45 Hz) — Integer-phase-locked to the breather; offers **AM** (amplitude modulation), **dichotic L/R detune**, or both.
- **AM (Amplitude Modulation)** — Modulating volume at a periodic rate; produces tremolo at low rates and sidebands at audio rates.
- **Dichotic detune** — Different pitch in left vs. right ear; produces auditory beating *inside the head*.
- **PRNG (Pseudo-Random Number Generator)** — Seeded random source. mdrone uses an **FNV-1a** hash of the preset ID (or share-URL seed) so the same URL always yields the same tail and drift.
- **Pitch-drift LFO** — A sub-Hz random pitch wobble per voice that keeps the stack from feeling sterile.

---

## 6. Climate / WeatherPad

- **WEATHER pad** — XY pad: **X = brightness** (spectral tilt), **Y = motion** (LFO / animation depth).
- **Macros** — High-level performance knobs: **DRIFT, AIR, TIME, BLOOM, GLIDE, SUB**.

---

## 7. Mixer (master bus)

- **HPF (High-Pass Filter)** — Cuts low frequencies; cleans rumble.
- **EQ (3-band equaliser)** — Low / mid / high tone-shaping.
- **MUD trim** — Targeted cut of low-mid muddiness (around 200–400 Hz).
- **GLUE compression** — Gentle bus compression that "glues" voices together.
- **DRIVE** — Pre-limiter saturation.
- **LIMITER** — A brick-wall ceiling. mdrone uses a **look-ahead worklet** on Chrome / Firefox (peeks slightly into the future to avoid distortion) and Safari's native dynamics compressor as a fallback.
- **WIDTH** — **M/S (Mid/Side)** stereo width control. **Bass-mono fold** below 120 Hz collapses lows to mono so the low end stays solid on club systems / vinyl.
- **ROOM** — Parallel cathedral-IR send (Saint-Lawrence Church, Molenbeek-Wersbeek, Public Domain).
- **COLOR** — Combined saturation + air exciter on one knob.
- **SAFE / Headphone-safe** — Caps master output near 50% so a hot scene can't peak straight into headphones. Header VOL gets a `· HP` badge when on.
- **FADE** — Master fade-out (30 s → 20 min).
- **CLIP LED** — Pre-limiter clip indicator.
- **LUFS-S** — **Loudness Units Full Scale, Short-term**: standard EBU R128 loudness measurement (3-second window).
- **PEAK meter** — True peak in dBFS.
- **Loudness-aware RND** — Random preset switching scaled so successive scenes read roughly equal-loudness.

---

## 8. Audio engine internals

- **Web Audio API** — The browser's native audio graph standard.
- **AudioWorklet** — Sample-accurate DSP code that runs on the audio rendering thread (every voice and most FX in mdrone are worklets).
- **Sample rate** — Samples per second (typically 48 kHz here).
- **Aliasing / oversampling** — Mirroring of frequencies above Nyquist; oversampling (running at higher SR internally) reduces it before saturation.
- **Underrun** — The audio thread misses a buffer deadline; usually heard as a click. mdrone tracks underruns in a 512-event ring buffer.
- **Crossfade** — Linear amplitude fade between two sources to avoid clicks; mdrone uses one at the loop seam in **BOUNCE LOOP** and during interval changes.
- **24-bit stereo WAV** — Uncompressed audio file, 24 bits per sample. Bit-identical capture path via a worklet tap; no codec.
- **RIFF `smpl` chunk** — A WAV metadata block that tells samplers where the loop region is.
- **Float32 stereo** — In-memory recording format before WAV finalize (~44 MB / 10 min).

---

## 9. Stage / Reliability

- **LIVE SAFE** — User-initiated stage mode: voice cap = 4, heaviest FX bypassed, low-power visuals.
- **Adaptive stability** — Auto-mitigation when the audio thread is struggling: visuals → heavy FX → voice density.
- **CPU warning indicator** — Header pill that blinks when load is high.
- **Low-Power Mode** — Clamps visualizer to 15 fps, throttles loudness meter to 5 Hz.

---

## 10. Visualizer vocabulary

- **Phase portrait / Vectorscope** — XY plot of L vs R audio; shows stereo image and phase relationships.
- **Tonnetz** — 19th-century lattice diagram of pitch relations (thirds, fifths) — Riemann's harmonic network.
- **Cymatics** — Patterns formed by sound vibrating physical media (sand, water).
- **Moiré** — Interference pattern between two regular grids.
- **Petroglyphs / Illuminated glyphs / Prayer rug / Sediment strata / Iron filings / Crystal lattice / Scrying mirror / Rothko field / Void monolith / Feedback tunnel / Shortwave static / Dream machine** — Authored visualizer presets (mostly self-explanatory).
- **Dream machine** — Reference to **Brion Gysin's Dreamachine** (1959): a stroboscopic device flickering at ~10 Hz to induce alpha-state visuals. mdrone gates this behind a flicker warning and replaces it with a slow breath when `prefers-reduced-motion` is set.

---

## 11. Sharing & connectivity

- **Scene link** — Self-contained URL that re-creates the current drone exactly (scene + tuning cents + optional gesture motion).
- **`s.mdrone.org`** — Auto-shortener relay for scene URLs.
- **Web MIDI** — Browser API for hardware MIDI controllers. **CC (Control Change)** messages bind to mdrone targets via **LEARN MODE**.
- **Ableton Link** — A peer-to-peer tempo-sync protocol for music apps on a LAN. mdrone's breathing LFO can lock to it (FREE / 1/1 / 1/2 / 1/4 / 1/8 / 1/16 of the bar).
- **Link Bridge** — A small companion app that bridges Link's UDP multicast to the browser via localhost WebSocket (mdrone reuses *mpump*'s bridge).
