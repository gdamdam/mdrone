import { test, expect, type Page } from "@playwright/test";

/**
 * Long-hold audio burn-in.
 *
 * This spec is opt-in: set MDRONE_LONG_HOLD=1 or use
 * `npm run test:e2e:long`. Keep it out of the default e2e path so PR
 * smoke stays fast while scheduled/manual runs can exercise browser
 * audio stability over real time.
 */

const START_BUTTONS = /start mdrone|start new|continue last scene|play this scene/i;
const LONG_HOLD_MS = Number(process.env.LONG_HOLD_MS ?? 60_000);
const MAX_UNDERRUNS = Number(process.env.MDRONE_LONG_HOLD_MAX_UNDERRUNS ?? 0);
const MAX_ADAPTIVE_STAGE = Number(process.env.MDRONE_LONG_HOLD_MAX_ADAPTIVE_STAGE ?? 1);
const PRESET_NAME = process.env.MDRONE_LONG_HOLD_PRESET ?? "High Shimmer";

interface AudioReport {
  audioContext: { state: string; sampleRate: number; baseLatencyMs: number; outputLatencyMs: number };
  loadMonitor: { underruns: number; struggling: boolean; driftMs: number };
  adaptive: { stage: number };
  liveSafe: { active: boolean };
  voices: { maxVoiceLayers: number; intervalsCount: number };
  fx: { userIntent: Record<string, boolean>; effective: Record<string, boolean>; suppressed: string[] };
  mixer: { masterVolume: number | null; limiterEnabled: boolean | null };
}

type ErrorBucket = string[];

const trackErrors = (page: Page): ErrorBucket => {
  const errors: ErrorBucket = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/\[vite\]/i.test(text)) return;
    if (/favicon\.ico/i.test(text)) return;
    // Ableton Link bridge auto-discovery — Firefox surfaces the
    // refused ws://127.0.0.1:19876 connection as an unsuppressable
    // JavaScript Error; Chromium/WebKit silence it. The bridge is
    // never running in CI and the app's auto-mode promises silent
    // failure. Same filter as e2e/smoke.spec.ts.
    if (/ws:\/\/(127\.0\.0\.1|\[::1\]|localhost):19876/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
};

const dismissStartGate = async (page: Page) => {
  const btn = page.getByRole("button", { name: START_BUTTONS }).first();
  await expect(btn).toBeVisible();
  await btn.click();
};

const readAudioReport = async (page: Page): Promise<AudioReport> => page.evaluate(async () => {
  const w = window as unknown as {
    __mdroneAudioReport?: () => Promise<AudioReport>;
  };
  if (!w.__mdroneAudioReport) throw new Error("__mdroneAudioReport unavailable");
  return w.__mdroneAudioReport();
});

test.skip(process.env.MDRONE_LONG_HOLD !== "1", "Long-hold burn-in is opt-in.");

test("audio long-hold stays stable under a heavy preset", async ({ page }) => {
  test.setTimeout(Math.max(120_000, LONG_HOLD_MS + 60_000));
  const errors = trackErrors(page);

  await page.goto("/");
  await dismissStartGate(page);

  await page.locator(".preset-strip-chevron").first().click();
  let preset = page.locator(".preset-btn").filter({ hasText: PRESET_NAME }).first();
  if ((await preset.count()) === 0) {
    preset = page.locator(".preset-btn").first();
  }
  await expect(preset).toBeVisible({ timeout: 10_000 });
  await preset.click();

  const hold = page.locator(".header-hold-btn").first();
  await expect(hold).toBeVisible();
  if ((await hold.getAttribute("aria-pressed")) !== "true") {
    await hold.click();
  }

  await page.waitForFunction(() => {
    const w = window as unknown as { __mdroneAudioReport?: unknown };
    return typeof w.__mdroneAudioReport === "function";
  });

  const start = await readAudioReport(page);
  await page.waitForTimeout(LONG_HOLD_MS);
  const end = await readAudioReport(page);

  const underrunDelta = end.loadMonitor.underruns - start.loadMonitor.underruns;
  expect(end.audioContext.state).toBe("running");
  expect(underrunDelta).toBeLessThanOrEqual(MAX_UNDERRUNS);
  expect(end.adaptive.stage).toBeLessThanOrEqual(MAX_ADAPTIVE_STAGE);
  expect(end.loadMonitor.struggling).toBe(false);
  expect(Number.isFinite(end.loadMonitor.driftMs)).toBe(true);
  expect(end.audioContext.sampleRate).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
