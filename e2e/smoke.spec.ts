import { test, expect, type Page } from "@playwright/test";

/**
 * Smoke tests — boot the real app, exercise minimum user flows, and
 * assert topology/no-error invariants. These are intentionally thin;
 * deep logic coverage is in tests/unit (vitest).
 */

const START_BUTTONS = /start mdrone|start new|continue last scene/i;

type ErrorBucket = string[];

const trackErrors = (page: Page): ErrorBucket => {
  const errors: ErrorBucket = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Filter dev-server noise that has nothing to do with app behavior.
    if (/\[vite\]/i.test(text)) return;
    if (/favicon\.ico/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
};

const dismissStartGate = async (page: Page) => {
  const btn = page.getByRole("button", { name: START_BUTTONS }).first();
  await expect(btn).toBeVisible();
  await btn.click();
};

test.beforeEach(async ({ context }) => {
  // Fresh state per test so "continue last scene" flows don't leak.
  await context.clearCookies();
  await context.clearPermissions();
});

test("1. app boots and renders StartGate without console errors", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: START_BUTTONS }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("2. clicking start audio dismisses the gate and reveals the drone UI", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await dismissStartGate(page);

  // StartGate should be gone; tonic grid (A..G buttons) should be present.
  await expect(page.getByRole("button", { name: /^Start mdrone$/i })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^C$/ }).first(),
  ).toBeVisible();

  // Best-effort AudioContext state check — only if the app happens to
  // expose it on window. Don't fail when it's not exposed; the real
  // assertion here is "UI transitioned and nothing crashed".
  const ctxState = await page.evaluate(() => {
    const w = window as unknown as { audioContext?: { state?: string }; __mdrone?: { ctx?: { state?: string } } };
    return w.audioContext?.state ?? w.__mdrone?.ctx?.state ?? null;
  });
  if (ctxState !== null) {
    expect(["running", "suspended"]).toContain(ctxState);
  }

  expect(errors).toEqual([]);
});

test("3. selecting a preset updates the UI without errors", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await dismissStartGate(page);

  // "Tanpura Drone" is the first preset in the Sacred / Ritual group.
  const preset = page.getByRole("button", { name: /Tanpura Drone/i }).first();
  await expect(preset).toBeVisible();
  await preset.click();

  // Clicking shouldn't throw and the button should remain in the DOM.
  await expect(preset).toBeVisible();
  expect(errors).toEqual([]);
});

test("4. FX bar DOM order matches engine EFFECT_ORDER", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await dismissStartGate(page);

  // Engine EFFECT_ORDER — kept in sync with src/engine/FxChain.ts. If
  // FxBar.tsx ever hand-rolls its own order, this assertion catches it.
  const expected = [
    /TAPE/i,
    /WOW/i,
    /SUB/i,
    /COMB/i,
    /RING/i,
    /FORMANT/i,
    /DELAY/i,
    /PLATE/i,
    /HALL/i,
    /SHIMMER/i,
    /FREEZE/i,
    /CISTERN/i,
    /GRAIN/i,
  ];

  const fxBar = page.locator(".fx-bar").first();
  await expect(fxBar).toBeVisible();
  const texts = await fxBar.locator("button").allInnerTexts();

  // Each label must appear, and in the expected order relative to the
  // previous one. Extra buttons (e.g. morph slider trigger) are allowed.
  let cursor = -1;
  for (const re of expected) {
    const idx = texts.findIndex((t, i) => i > cursor && re.test(t));
    expect(idx, `missing or out-of-order FX button for ${re}`).toBeGreaterThan(cursor);
    cursor = idx;
  }

  expect(errors).toEqual([]);
});

test("5. share URL round-trip reconstructs the mutated tonic", async ({ page, context }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await dismissStartGate(page);

  // Mutate to a non-default root so the share payload carries signal.
  await page.getByRole("button", { name: /^D$/ }).first().click();

  // Open the share modal — header trigger is either a "share" button
  // or an icon button with aria-label="share" / "Share".
  await page.getByRole("button", { name: /share/i }).first().click();

  // Share URL is rendered into a readonly textarea.
  const shareUrlLocator = page.locator(".share-modal-url").first();
  await expect(shareUrlLocator).toBeVisible();
  const shareUrl = await shareUrlLocator.inputValue();
  expect(shareUrl).toMatch(/^https?:\/\//);

  // Load the share URL in a fresh page and confirm D is active there.
  const fresh = await context.newPage();
  const freshErrors = trackErrors(fresh);
  await fresh.goto(shareUrl);

  // Dismiss StartGate if it reappears on the fresh page.
  const gate = fresh.getByRole("button", { name: START_BUTTONS }).first();
  if (await gate.isVisible().catch(() => false)) {
    await gate.click();
  }

  // `tonic-cell-active` is the class FxBar-adjacent tonic grid applies
  // to the currently-selected root (see DroneView.tsx tonic grid).
  const dBtn = fresh.getByRole("button", { name: /^D$/ }).first();
  await expect(dBtn).toHaveClass(/tonic-cell-active/, { timeout: 10_000 });

  expect(errors.concat(freshErrors)).toEqual([]);
});
