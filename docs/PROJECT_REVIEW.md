# mdrone — Project Review & Strategy

_Date: 2026-05-30 · Reviewed at v1.25.0 · Read-only review, no code changed._
_Updated: 2026-05-31 · Re-verified at v1.25.2 · See "Bug status" below for what's been fixed since._

## TL;DR

mdrone is a **genuinely impressive, unusually disciplined solo project** — a browser-native microtonal drone instrument with a sophisticated DSP engine, careful long-form stability work, a hardened recording/sharing path, and a deep, behavioral test suite. As an *engineering artifact* it scores high. As a *product people discover and adopt* it is held back by two things: a wall of invented vocabulary that no new user can decode, and the absence of any distribution or feedback loop.

| Dimension | Score | One-line |
|---|---|---|
| Audio engine / DSP | **8.5 / 10** | Mature, battle-tested, denormal/NaN-disciplined; one real leak bug. |
| UX / onboarding | **7.5 / 10** | Excellent progressive disclosure; crippled by jargon density. |
| Infrastructure / QE | **8.5 / 10** | Stateless-by-design share path, deep tests; worker untested + uncapped. |
| **Overall (as engineering)** | **~8.3 / 10** | Top-decile for a solo web-audio project. |
| **Overall (as adopted instrument)** | **~6 / 10** | Discoverability + distribution are the ceiling, not the code. |

---

## The Good

- **DSP is the real thing.** Dattorro plate, polyphase halfband oversampling, phase-vocoder spectral freeze, look-ahead true-peak limiter. Per-voice NaN/denormal sanitation (`flushDenormal`, `+1e-20` SVF injections, `1e-20` plate/shimmer floors) applied exactly where Safari/iOS would otherwise park subnormals and spike CPU. Most web-audio projects never address this.
- **Built for the stated use case.** Long-hold (1hr+) stability is excellent: scratch buffers pre-allocated outside `process()` (no per-block GC), hoisted shaper closures to dodge Safari per-sample GC, amp<0.0001 idle early-out, bounded jawari cross-coupling to prevent ring-up. The weekly 10-min burn-in CI asserts no underruns/NaN.
- **Clean architecture.** `AudioEngine` is a thin coordinator over `VoiceEngine`/`MotionEngine`/`MasterBus`/`FxChain`. The build-time worklet concatenation is a sane workaround for AudioWorklet's lack of imports.
- **Share path is architected to avoid the classic footguns.** Scene lives entirely in the URL (`?z=` deflate+urlsafe-b64); the worker only shortens `s.mdrone.org` hosts → no open-redirect/SSRF, worker stays stateless about content. `normalizePortableScene` does typed, clamped, versioned reads — real forward/back-compat.
- **Recording hardened.** Worklet-tap bit-exact capture, `segmentMinutes` memory rotation, `DONE_ACK_TIMEOUT_MS` teardown guards, validated bounds, finally-cleanup on OOM. Correct 24-bit RIFF with `smpl` loop chunk.
- **Service worker is correct.** Per-release cache key, activate purges stale caches + `clients.claim()`, network-first navigations, cache-first hashed assets, version.json bypass driving the update banner. No staleness traps.
- **Deep, behavioral test suite.** 24 vitest specs + 7 node `.mjs` (preset fingerprints, scene snapshots, share round-trip) + real e2e + scheduled burn-in. Assertions test behavior, not vanity.
- **Onboarding restraint.** `StartGate` doubles as the audio-unlock gesture; `TutorialOffer` is opt-in, never auto-started; intro tour gets sound out in step 1 ("Tap HOLD"). Three-tier disclosure (Performance always visible, EDIT/ADVANCED collapsed) keeps the huge surface from hitting novices at once.
- **A11y above genre norm.** WeatherPad ships hidden `role="slider"` SR controls with `aria-valuetext`; `prefers-reduced-motion` honored at the engine level; dialogs have proper ARIA; keyboard shortcuts guarded against input fields.

## The Bad

- **Invented vocabulary is the #1 adoption barrier.** HOLD, WEATHER, ATTUNE, ENTRAIN, JOURNEY, PARTNER, HALO, MORPH, MUTATE, RND — nearly every primary control is a coined term. ATTUNE/RND/MUTATE/MORPH are *four overlapping "vary the sound" verbs* a novice cannot tell apart. Tooltips exist but **don't help touch users, who are ~half the audience.**
- **Feature surface is enormous** (8 voices, 15 FX, 26 tunings, 25 visualizers, macros, 2 LFOs, journeys, partner, gesture replay). Disclosure hides it well, but the *always-visible* tier still speaks only jargon.
- **No feedback loop and no distribution.** No in-app feedback path, no community, no analytics beyond share-link counts. You're flying blind on what users actually do.
- **StartGate gates every visit**, not just first run — returning users tap through a splash each time.

## Bug status (re-verified 2026-05-31, v1.25.2)

Toolchain at v1.25.2: `tsc -b` clean, `eslint .` clean, 59 node tests + 348 vitest pass. Status of the issues originally filed below:

| # | Sev | Status | Note |
|---|---|---|---|
| 1 | HIGH | ✅ **fixed** | `VoiceEngine.dispose()` added (clears `materialInterval`, idempotent), called from `AudioEngine.dispose()` (commit `ccd9634`). |
| 4 | MED | ✅ **fixed (this session)** | Granular `i1` now derived from the wrapped index, not the unwrapped `i0` — no stale read at the ring-buffer seam. |
| 7 | LOW | ✅ **fixed (this session)** | Left plate tank no longer applies `decay` twice to `crossR`; both tank sides now symmetric (`crossL`/`crossR` are pre-multiplied at storage). |
| 2 | MED | ✅ **fixed (this session)** | `/shorten` payload size cap added. |
| 3 | MED | ✅ **fixed (this session)** | Best-effort per-IP rate limit added to `/shorten` + `/track`. |
| 5 | MED (gap) | ✅ **closed (this session)** | First worker tests added (vitest). |
| — | LOW (new) | open | `AudioEngine.dispose()` calls `ctx.close()` but no FxChain teardown; FxChain's pending `performSwap` `setTimeout`s can fire post-close/HMR. Short-lived; benign in practice. Candidate for a small guard. |
| 6,8,9,10,11 | LOW | open | Worker timing-safe auth, single-take unbounded memory, INFINITE freeze clamp, per-effect `setInterval` polling, no e2e on fast PR CI — unchanged; see original table. |

---

## Bugs & Issues (prioritized — original filing at v1.25.0)

| # | Sev | Location | Issue |
|---|---|---|---|
| 1 | **HIGH** | `VoiceEngine.ts:851` + `AudioEngine.ts:907-917` | `VoiceEngine` has **no `dispose()`**; its `materialInterval` `setInterval` keeps firing `setTargetAtTime` against a **closed** AudioContext after `dispose()`/HMR (throws), and the old VoiceEngine + GainNodes/analysers are retained (leak). The recent dispose() pass covered AudioEngine/Motion but missed this path. **Fix: add `VoiceEngine.dispose()` (clear interval, disconnect nodes) and call it + `fxChain` teardown from `AudioEngine.dispose()`.** |
| 2 | **MED** | `worker/worker.ts:295` | `/shorten` has **no payload size cap**. Scene URLs can be large (motion recordings + custom tuning in payload); abuser can spam large KV keys. **Fix: reject `target.length` > ~8–16 KB.** |
| 3 | **MED** | `worker/worker.ts:91` (`handleTrack`) | **No rate limiting** on `/shorten` or `/track`; counters are read-modify-write (racy, inflatable). **Fix: per-IP throttle; counters cosmetic so racing is tolerable.** |
| 4 | **MED** | `fxChainProcessor.js:1094` | Granular interpolation derives `i1 = (i0+1)%bufLen` from the **unwrapped** `i0`; +1 neighbor can read a stale slot at the wrap seam → click on grain reads. |
| 5 | **MED (gap)** | `worker/` | The **one network-exposed, stateful component has zero tests** while everything else is well-covered. Highest-value testing gap. |
| 6 | **LOW** | `worker/worker.ts:~143` | `requireBasicAuth` uses non-constant-time `u===user && p===pass` (timing side-channel; low risk). |
| 7 | **LOW** | `fxChainProcessor.js:231/271` | Plate tank L applies `decay` twice vs R once → slight stereo imbalance, not the intended symmetric figure-8. |
| 8 | **LOW** | `MasterRecorder.ts` | Single-take (non-segmented) path is unbounded memory (~44 MB/10 min); can OOM silently — no hard ceiling/warning. |
| 9 | **LOW** | freeze `analyzeChannelAccumulate:714` | INFINITE freeze accumulator only leaks at `0.9998`, no hard clamp — can sit near peak indefinitely. |
| 10 | **LOW** | `FxBar.tsx` (`EffectHalo`) | Per-effect 200ms `setInterval` polling `getEffectLevel`; several timers on a CPU-sensitive page (prefer a single rAF loop). |
| 11 | **LOW** | CI | `ci.yml` runs **no e2e** on the fast PR path; deploy.yml trusts tag already passed PR CI — a tag on a CI-skipped branch could ship unverified. |

---

## Where to go — three strategic tracks

These are **independent**; you can run them in parallel or pick one.

### Track A — Stabilize (engineering)
Small, high-confidence fixes that make it more reliable as an instrument.
- **Must:** Bug #1 (`VoiceEngine.dispose()`) — real leak/throw.
- **Should:** Bugs #2 + #3 + #5 (worker size cap, rate limit, first worker tests) — closes the only real abuse surface.
- **Nice:** #4, #7, #10 polish; add e2e smoke to PR CI (#11).
- _Effort: ~1–2 focused days for must+should._

### Track B — Make it understandable (UX)
The single highest-leverage product move. **The code is ready; the language isn't.**
1. **Add plain-language subtitles** under every coined label in the always-visible tier ("WEATHER — brightness & motion", "HOLD — start/stop the drone"). One line each.
2. **Collapse the 4 randomize verbs** (ATTUNE/RND/MUTATE/MORPH) into one prominent **"Surprise me"** + an "advanced variation" submenu.
3. **Tap-to-reveal tooltips on touch** (touch users never see hover titles).
4. **Skip StartGate for returning users** (remember consent; keep the unlock gesture only when audio is actually suspended).
5. Optional: a 20-second silent looping **"what is this"** preview behind the gate.
_Effort: ~1–2 days; biggest adoption ROI._

### Track C — Distribute & collect feedback (growth)
See full campaign below.

---

## Ad / launch campaign

**Positioning (lead with the friction you remove, not the feature count):**
> **Hold a drone in your browser. No install. No account. Free.**
> An hour of evolving microtonal sound in one tab — on stage or in headphones.

Avoid leading with "8 voices / 15 effects / 26 tunings" — that's the *jargon wall* in ad form. Lead with the *feeling and the zero-friction*. Depth is the second beat, for the people who lean in.

### Audiences (in priority order)
1. **Ambient / drone musicians & listeners** — the core. They get it instantly.
2. **Modular/generative crowd** (eurorack, generative.fm fans) — "evolves on its own" + microtuning is catnip.
3. **Meditation / focus / sound-bath** listeners — "leave it on for an hour."
4. **Web-audio / creative-coding devs** — the AGPL, AudioWorklet DSP, no-install story is a Show-HN natural.

### Channels & specific moves
- **Show HN: "mdrone – a microtonal drone instrument in the browser (no install, AGPL)"** — strongest single fit (web audio + open source + no account). Post Tue–Thu morning ET, be in the thread to answer DSP questions.
- **lines.community (monome forum)** — *the* home for this aesthetic; a thoughtful "I made this" post will land better than anywhere else. Low volume, high signal.
- **Reddit:** r/ambientmusic, r/drone, r/generative, r/synthesizers, r/WeAreTheMusicMakers (Feedback thread). Lead with a 30–60s screen-capture clip, link in comment.
- **Mastodon / Bluesky:** #ambient #webaudio #generativemusic; short visualizer clips loop well.
- **Short video (the secret weapon):** the 25 visualizers + a slow drone are *made* for 15–30s vertical clips on TikTok/Instagram Reels/YouTube Shorts. One clip per visualizer, captioned with the tonic/mode. This is your cheapest reach.
- **YouTube long-form:** publish 1–3 actual hour-long drone holds ("1 hour microtonal drone for focus / sleep") — these accrue passive search traffic forever and double as proof the instrument holds.
- **Bandcamp/Discord ambient communities** + **Product Hunt** (secondary).

### Content kit to prepare (one afternoon)
- A 45s hero clip (visualizer + drone + the 3 gestures: HOLD → WEATHER drag → ATTUNE).
- 6–8 short visualizer loops.
- One "share scene" link in every post so people can *open your exact sound in one tap* — that's the killer demo this app uniquely enables.

### Feedback collection (privacy-first, matches the no-account ethos)
1. **In-app "Send feedback" button** → opens a prefilled mailto or a tiny anonymous form; one tap, no login. This is the missing loop.
2. **Scene-share gallery / "drone of the week"** — you already mint short links and count opens; surface a curated wall + ask "share yours." Turns users into content.
3. **Lightweight Discord** for the core community (drone musicians love a hangout).
4. **One-question micro-survey** after a long hold: "did it hold up?" 👍/👎 — directly measures the core promise.
5. Watch the **share-link counters** you already have as a real usage signal.

---

## Recommended sequence

1. **Week 1:** Track A "must+should" (ship bug #1, worker hardening) + Track B items 1–4 (subtitles, consolidate randomize, touch tooltips, skip gate). This makes it both *stable* and *understandable* before anyone arrives.
2. **Week 2:** Build the content kit + add the in-app feedback button.
3. **Week 3:** Launch — Show HN + lines.community + Reddit + first short-video batch on the same day; be present to answer.
4. **Ongoing:** Drip visualizer clips; publish the long-form YouTube holds; iterate on whatever the feedback button surfaces.

Fix understandability **before** you drive traffic — otherwise the campaign sends people into the jargon wall and you burn your one first impression.
