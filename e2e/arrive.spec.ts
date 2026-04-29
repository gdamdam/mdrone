import { test, expect, type Page } from "@playwright/test";

/**
 * ARRIVE choreography — first-launch teaches the most playable
 * controls in order: SHAPE → WEATHER → TONIC. Returning users
 * (autosave present) don't see it. Each step renders an
 * <ArriveCallout> inline inside the surface it teaches and adds an
 * `.arrive-target-active` glow class on that surface so the prompt
 * is spatially connected to the control.
 */

const START_NEW = /start mdrone|start new/i;

const startFreshNew = async (page: Page) => {
  // Clean slate: no autosave, fresh DOM.
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch { /* ok */ }
  });
  await page.goto("/");
  const btn = page.getByRole("button", { name: START_NEW }).first();
  await expect(btn).toBeVisible();
  await btn.click();
};

const callout = (page: Page) => page.locator(".arrive-callout").first();

test("fresh launch shows visible SHAPE callout inside the SHAPE panel", async ({ page }) => {
  await startFreshNew(page);
  const c = callout(page);
  await expect(c).toBeVisible();
  await expect(c).toHaveAttribute("data-arrive-step", "shape");
  await expect(c).toContainText(/shape the drone/i);
  await expect(c).toContainText(/move air, bloom, or sub/i);

  // Active-target glow is on the SHAPE panel.
  await expect(page.locator('[data-tutor="shape"]')).toHaveClass(/arrive-target-active/);
  // Callout is rendered inside the SHAPE panel, not the WEATHER pad.
  await expect(page.locator('[data-tutor="shape"] .arrive-callout')).toHaveCount(1);
});

test("touching a SHAPE macro advances to a visible WEATHER callout", async ({ page }) => {
  await startFreshNew(page);
  await expect(callout(page)).toHaveAttribute("data-arrive-step", "shape");

  await page.locator('[data-tutor="shape"]').first().click({ position: { x: 4, y: 4 }, force: true });

  const c = callout(page);
  await expect(c).toHaveAttribute("data-arrive-step", "weather");
  await expect(c).toContainText(/move the room/i);
  await expect(c).toContainText(/drag weather/i);

  // Glow moves to the WEATHER pad.
  await expect(page.locator('[data-tutor="weather"]')).toHaveClass(/arrive-target-active/);
  await expect(page.locator('[data-tutor="weather"] .arrive-callout')).toHaveCount(1);
});

test("dragging WEATHER advances to a visible TONIC callout", async ({ page }) => {
  await startFreshNew(page);
  await page.locator('[data-tutor="shape"]').first().click({ position: { x: 4, y: 4 }, force: true });
  await expect(callout(page)).toHaveAttribute("data-arrive-step", "weather");

  const pad = page.locator('[data-tutor="weather"] .weather-xy').first();
  const box = await pad.boundingBox();
  if (!box) throw new Error("weather pad not visible");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 6 });
  await page.mouse.up();

  const c = callout(page);
  await expect(c).toHaveAttribute("data-arrive-step", "tonic");
  await expect(c).toContainText(/try a new tonic/i);
  await expect(c).toContainText(/tap a key to retune/i);

  // Glow moves to the TONIC area.
  await expect(page.locator('[data-arrive-target="tonic"]')).toHaveClass(/arrive-target-active/);
});

test("returning user with autosave does not see ARRIVE", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mdrone-autosave", JSON.stringify({ scene: {}, savedAt: Date.now() }));
    } catch { /* ok */ }
  });
  await page.goto("/");
  const btn = page.getByRole("button", { name: /continue last scene|start new|start mdrone/i }).first();
  await expect(btn).toBeVisible();
  await btn.click();

  await expect(page.locator(".arrive-callout")).toHaveCount(0);
});

test("keyboard SHAPE input advances to WEATHER callout", async ({ page }) => {
  await startFreshNew(page);
  await expect(callout(page)).toHaveAttribute("data-arrive-step", "shape");

  const macro = page.locator('[data-tutor="shape"] input[type="range"]').first();
  await macro.focus();
  await macro.press("ArrowRight");

  await expect(callout(page)).toHaveAttribute("data-arrive-step", "weather");
});

test("keyboard WEATHER slider advances to TONIC callout", async ({ page }) => {
  await startFreshNew(page);

  const macro = page.locator('[data-tutor="shape"] input[type="range"]').first();
  await macro.focus();
  await macro.press("ArrowRight");
  await expect(callout(page)).toHaveAttribute("data-arrive-step", "weather");

  const brightness = page.getByRole("slider", { name: /brightness/i }).first();
  await brightness.focus();
  await brightness.press("ArrowRight");

  await expect(callout(page)).toHaveAttribute("data-arrive-step", "tonic");
});

test("ARRIVE never auto-advances without a gesture (no timers)", async ({ page }) => {
  await startFreshNew(page);
  await expect(callout(page)).toHaveAttribute("data-arrive-step", "shape");
  await page.waitForTimeout(2500);
  await expect(callout(page)).toHaveAttribute("data-arrive-step", "shape");
});

test("programmatic preset/scene load does not advance ARRIVE", async ({ page }) => {
  await startFreshNew(page);
  await expect(callout(page)).toHaveAttribute("data-arrive-step", "shape");

  await page.locator(".preset-strip-chevron").first().click();
  const preset = page.locator(".preset-btn").first();
  await expect(preset).toBeVisible({ timeout: 5000 });
  await preset.click();

  // Loading a preset uses raw setRoot (not setRootFromUser) so ARRIVE
  // stays on SHAPE.
  await expect(callout(page)).toHaveAttribute("data-arrive-step", "shape");
});
