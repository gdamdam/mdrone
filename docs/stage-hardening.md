# Stage hardening runbook

This is the repeatable path for turning "works in Chromium smoke tests"
into "credible live instrument across the browsers musicians actually use."

## Fast local checks

```sh
npm run test:e2e
```

Runs the normal Chromium smoke suite only. Keep this fast enough for PRs.

## Browser matrix

Install the browsers you want to exercise:

```sh
npx playwright install chromium firefox webkit
```

Then run:

```sh
npm run test:e2e:all
```

Projects are defined in `playwright.config.ts`:

- `chromium`
- `firefox`
- `webkit` (Playwright WebKit, not a perfect Safari/iOS substitute)
- `edge` (uses the `msedge` channel when available)

## Long-hold burn-in

Use the opt-in long-hold spec:

```sh
MDRONE_LONG_HOLD=1 LONG_HOLD_MS=900000 npm run test:e2e:long
```

Useful knobs:

- `LONG_HOLD_MS`: hold duration, default 60000 when explicitly enabled.
- `MDRONE_LONG_HOLD_PRESET`: preset name, default `High Shimmer`.
- `MDRONE_LONG_HOLD_MAX_UNDERRUNS`: allowed underrun delta, default `0`.
- `MDRONE_LONG_HOLD_MAX_ADAPTIVE_STAGE`: allowed adaptive stage, default `1`.

The spec starts audio, loads a heavy preset, holds, then calls
`__mdroneAudioReport()` and asserts:

- `AudioContext.state === "running"`
- underrun delta stays within budget
- adaptive stage stays within budget
- load monitor is not struggling at the end
- no page or console errors were observed

## Scheduled CI

`.github/workflows/stage-hardening.yml` runs daily and on manual dispatch.
It exercises:

- Ubuntu Chromium
- Ubuntu Firefox
- macOS WebKit
- Windows Chromium
- Windows Edge

Each job runs fast e2e for that browser project, then the long-hold audio
burn-in. The workflow is intentionally separate from PR CI.

## Real Safari / iOS checklist

Playwright WebKit is useful, but it is not the same as real Safari or iOS
Safari. Before calling a release stage-ready, run this on a physical iPhone
or iPad and on desktop Safari:

1. Default preset, HOLD for 60 minutes.
2. Heavy preset (`High Shimmer` or current worst-case), HOLD for 30 minutes.
3. Hold RND for 2 minutes while listening for clicks, hash, voice stacking,
   or limiter pumping.
4. Toggle LIVE SAFE on/off during playback.
5. Record a 10 minute WAV and verify the download opens.
6. Background and foreground the tab.
7. Sleep/wake the device while holding audio, then resume.
8. Repeat with Bluetooth headphones.
9. Copy Audio Report after each run and archive it with device/browser notes.

## When nightly goes red — flake vs. real

GitHub-hosted runners are noisy: shared hypervisors, no audio-thread
priority guarantees, occasional macOS swap, neighbour jobs spiking the
CPU. The default `MDRONE_LONG_HOLD_MAX_UNDERRUNS=0` is a strict target
appropriate for "the show should sound clean," but on shared CI it
*will* flake some days even when nothing changed. Triage every red
nightly the same way:

1. **Look at how many cells failed.** One cell red on one OS is almost
   always noise — the same commit was green on the other four.
   Three or more cells red, or the same cell red two nights in a row,
   is real. (Browser matrix runs with `fail-fast: false` for exactly
   this reason.)
2. **Re-run the failed cell first** before debugging. Use the GitHub
   Actions "Re-run failed jobs" button. If the second run is green
   *and* the failure was a single cell, treat it as flake — note it,
   move on.
3. **Compare the failed-cell `__mdroneAudioReport` against a green
   cell from the same run.** Same commit, same preset; if `driftMs`
   and `underruns` start similar but the failed cell drifts late,
   that's environment. If it diverges from t=0, that's the build.
4. **Watch for patterns over a week.** A single browser repeatedly
   red on the same weekday is usually a runner-fleet issue (e.g.
   macOS runners get noisy during US business hours). Persistent red
   on every run for a single browser is a regression.
5. **Don't silently raise the budget.** If a real regression is
   masking as flake, bumping `MDRONE_LONG_HOLD_MAX_UNDERRUNS` to make
   green will hide it. If you genuinely need more headroom on shared
   CI, raise it on the **workflow env** only — not in the spec
   default — and leave a comment explaining the per-cell observation
   that justifies the new number. Local burn-ins on a quiet machine
   should still pass at zero.
6. **Open the artifact** before you decide. See the next section.

A reasonable rough budget for shared GitHub runners, calibrated from
observed nightly data, is `MAX_UNDERRUNS ≤ 2 / 15 min`; treat 0 as
the local-and-real-Safari target. We deliberately ship 0 in the
defaults so the alert is loud — it's easier to relax a strict budget
than to tighten a permissive one.

## Reading the failure artifact

When the workflow fails, the **`Upload Playwright report on failure`**
step uploads `playwright-report/` as a workflow artifact named
`playwright-report-<os>-<project>` with 14 day retention. To open it:

1. Open the failed run in GitHub Actions → scroll to **Artifacts** at
   the bottom → download the matching ZIP (one per failed cell).
2. Unzip it locally. The folder contains:
   - `index.html` — open this in any browser. It's the Playwright HTML
     report: a tree of test runs with timing, screenshots, and the
     trace viewer.
   - `data/` — per-test trace bundles backing the HTML report.
3. Inside `index.html`, click into the failing test
   (`audio long-hold stays stable under a heavy preset`). You'll see:
   - **Errors** — the assertion that fired, with the actual value
     (e.g. `expected 4 to be ≤ 0` for an underrun delta of 4).
   - **Steps** — every Playwright action the spec performed, with
     timing. Useful for catching "click happened but the preset never
     loaded" failures.
   - **Console / Page errors** — anything that landed in the
     filtered error bucket; these block the run on their own (the
     final assertion is `expect(errors).toEqual([])`).
   - **Trace viewer** — click the trace icon next to a step. Gives
     you a frame-by-frame DOM snapshot, network log, and page
     console. This is the closest thing to "rewinding the run" you
     get.
4. **The most useful single signal** is the `__mdroneAudioReport`
   payload itself. The spec calls it twice (start + end) but the
   values aren't asserted-on individually, so the exact `driftMs`,
   `adaptive.stage` history, and `fx.suppressed` list aren't visible
   in the report by default. To recover them, re-run the spec
   locally with `DEBUG=pw:api npx playwright test
   e2e/audio-longhold.spec.ts --project=<project>` — the
   `page.evaluate(...)` results will print to the terminal.
5. If the failure looks environmental (single cell, no diff between
   start and end snapshots, generic browser error in the console),
   note the run URL and the artifact name, re-run, and move on.
   If the failure looks real, proceed to **Failure triage** below.

The artifact is large enough (tens of MB with traces) that it's
deliberately on 14-day retention — old failures can be re-pulled
from a fresh nightly if you need to compare across a regression
window, but don't expect anything older than two weeks to still be
downloadable.

## Failure triage

If long-hold fails:

1. Re-run with `?audio-debug=trace`.
2. Copy `await __mdroneAudioReport()` from the console.
3. Re-run with debug bypass flags to isolate stage:
   `?audio-debug=no-fx`, `no-master`, `no-limiter`, `no-glue`,
   `no-eq`, `no-width`, or `mono-voice`.
4. Compare underrun timing with the active preset, voice layers, FX, and
   adaptive stage in the report.
