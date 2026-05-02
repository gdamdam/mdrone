import { test, expect, type Page } from "@playwright/test";

/**
 * Smoke tests — boot the real app, exercise minimum user flows, and
 * assert topology/no-error invariants. These are intentionally thin;
 * deep logic coverage is in tests/unit (vitest).
 */

// Any button that starts audio + reveals the main UI. The normal
// StartGate uses "Start mdrone" / "Start New" / "Continue Last Scene";
// when the page loads from a share URL the gate is replaced with a
// "▶ Play this scene" button instead.
const START_BUTTONS = /start mdrone|start new|continue last scene|play this scene/i;

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

// Stub the share-relay worker (dev: localhost:8787, prod: s.mdrone.org) so
// tests don't depend on a running wrangler dev server or outbound network.
const stubShareRelay = async (page: Page) => {
  const handler = async (route: import("@playwright/test").Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/health") {
      await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
      return;
    }
    if (url.pathname === "/shorten") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "test", short: "https://s.mdrone.org/s/test" }),
      });
      return;
    }
    if (url.pathname === "/track") {
      await route.fulfill({ status: 200, contentType: "text/plain", body: "" });
      return;
    }
    await route.fulfill({ status: 404, body: "" });
  };
  await page.route("http://localhost:8787/**", handler);
  await page.route("https://s.mdrone.org/**", handler);
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

  // Expand the preset strip (collapsed by default) to reveal preset
  // buttons. The outer `.preset-strip` div is a flex container with
  // many interactive children (tonic keys, octave, chevron); clicking
  // it at center lands ambiguously. The chevron is the stable toggle.
  await page.locator(".preset-strip-chevron").first().click();
  // Click whichever preset is first in the active tab.
  const preset = page.locator(".preset-btn").first();
  await expect(preset).toBeVisible({ timeout: 5000 });
  await preset.click();

  // After clicking, the preset button should gain the active class.
  await expect(preset).toHaveClass(/preset-btn-active/);
  expect(errors).toEqual([]);
});

test("4. FX bar DOM order matches engine EFFECT_ORDER", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await dismissStartGate(page);

  // FxBar sits in the always-visible TIMBRE + EFFECTS row — no
  // disclosure to click in the current layout.

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
  const texts = await fxBar.locator(".fx-btn").allInnerTexts();

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

test("5. share URL round-trip reconstructs the mutated tonic", async ({ page, browser }) => {
  const errors = trackErrors(page);
  await stubShareRelay(page);
  await page.goto("/");
  await dismissStartGate(page);

  // Mutate tonic to D so the share URL encodes a non-default state.
  // Piano keyboard keys use aria-label for the pitch class name.
  await page.locator(".tonic-key[aria-label='D']").first().click();

  // Open the share modal from the header action bar.
  await page.getByRole("button", { name: /copy scene link/i }).first().click();

  // The share URL is computed async (CompressionStream), so the
  // readonly textarea starts empty and populates once encoding lands.
  const shareUrlLocator = page.locator(".share-modal-url").first();
  await expect(shareUrlLocator).toBeVisible();
  await expect(shareUrlLocator).toHaveValue(/^https?:\/\//, { timeout: 10_000 });
  const shareUrl = await shareUrlLocator.inputValue();

  // The share URL points at the production share-worker origin
  // (e.g. s.mdrone.org). Rewrite it to the local dev server.
  const parsed = new URL(shareUrl);
  const localShareUrl = `http://localhost:5173/${parsed.search}`;

  // Use a fresh *context* (not just a fresh page) so that localStorage
  // from the first page doesn't short-circuit the share-URL boot flow
  // by auto-continuing the autosaved scene instead.
  const freshContext = await browser.newContext();
  const fresh = await freshContext.newPage();
  const freshErrors = trackErrors(fresh);
  await stubShareRelay(fresh);
  await fresh.goto(localShareUrl);

  // A share URL replaces StartGate with a "▶ Play this scene" button.
  // Either gate flavor is covered by START_BUTTONS.
  const gate = fresh.getByRole("button", { name: START_BUTTONS }).first();
  await expect(gate).toBeVisible({ timeout: 10_000 });
  await gate.click();

  // The HOLD button shows the current tonic+octave in its sub-label.
  // Check that the shared scene's tonic (D) appears there.
  const holdBtn = fresh.locator(".header-hold-btn").first();
  await expect(holdBtn).toContainText("D", { timeout: 10_000 });

  await freshContext.close();
  expect(errors.concat(freshErrors)).toEqual([]);
});
