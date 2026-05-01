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

## Failure triage

If long-hold fails:

1. Re-run with `?audio-debug=trace`.
2. Copy `await __mdroneAudioReport()` from the console.
3. Re-run with debug bypass flags to isolate stage:
   `?audio-debug=no-fx`, `no-master`, `no-limiter`, `no-glue`,
   `no-eq`, `no-width`, or `mono-voice`.
4. Compare underrun timing with the active preset, voice layers, FX, and
   adaptive stage in the report.
