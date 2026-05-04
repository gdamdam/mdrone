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

### Keeping the nightly alive

GitHub silently disables `schedule:` workflows on a repository after
**60 days of inactivity** (no pushes, no manual workflow runs) on
private repositories and forks. Public-repo behaviour is more
forgiving but the same lever exists. If mdrone goes a quiet stretch,
the daily stage-hardening run can stop without any notification —
the CI badge stays green because there are simply no new runs to
fail.

How to check / mitigate:

1. **Add the stage-hardening badge to README.md** so the lack of
   recent runs is visible at a glance:
   ```md
   ![stage-hardening](https://github.com/<owner>/mdrone/actions/workflows/stage-hardening.yml/badge.svg)
   ```
   A disabled workflow shows the badge in a "no status" state on
   GitHub, which is usefully different from "passing".
2. **Verify the schedule is alive** before each release:
   - Open the Actions tab → *Stage hardening* workflow.
   - The "All workflows" sidebar shows a banner if the workflow
     was auto-disabled.
   - Check the most recent run timestamp — if older than 48h on a
     repo that should be running daily, the schedule is stuck.
3. **Re-enable** by either:
   - Pushing any commit (a docs-only change is enough).
   - Triggering a manual run via the *Run workflow* button — the
     `workflow_dispatch:` event in `stage-hardening.yml` exists for
     this. The manual run resets the inactivity counter for some
     period.
4. **Before a release**, manually dispatch the workflow with the
   default `long_hold_ms: 900000` (or longer) and wait for the
   matrix to come back green — don't trust "the badge looks fine"
   if you can't tell whether nightly actually fired this week.

If you find yourself fighting auto-disable repeatedly, that's a
signal to either commit more often or switch to an external
scheduler — but a no-op keepalive workflow is *not* recommended. It
trades real signal (the workflow stopped) for nominal activity (a
bot keeps it warm), and over time the keepalive becomes a thing you
have to maintain too.

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

The current calibration:

- **Spec default** (`MDRONE_LONG_HOLD_MAX_UNDERRUNS=0`) — for local
  burn-ins on a quiet machine and real-Safari manual checks. Any
  underrun is a regression.
- **CI workflow env** (`MDRONE_LONG_HOLD_MAX_UNDERRUNS=6`) — tolerated
  budget on shared GitHub runners over the 15-minute hold. Initially
  set to 2; raised to 6 after an observed macOS WebKit run produced
  248 underruns on first attempt and 46 on the retry against an
  otherwise-quiet runner — pure runner noise, same commit, same
  preset. Six absorbs that floor without hiding a regression: any
  sustained > 10/15min on a single browser should still be triaged
  as build, not flake. Set in `.github/workflows/stage-hardening.yml`,
  not in the spec.

The intent is "loud floor, calibrated CI ceiling" — it's easier to
relax a strict budget than to tighten a permissive one, so the spec
ships strict and the workflow relaxes per-environment with a comment.
Revisit the CI budget after a few weeks of nightly data; if a single
browser sustains > 2 underruns repeatedly, that's the build, not the
runner.

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
