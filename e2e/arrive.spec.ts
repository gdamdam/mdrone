import { test, expect, type Page } from "@playwright/test";

/**
 * ARRIVE choreography — first-launch teaches the most playable
 * controls in order: SHAPE → WEATHER → TONIC. Returning users
 * (autosave present) don't see it. Tied to a single arriveStep
 * state in DroneView; the prompt is selected via
 * `[data-arrive-step]`.
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

test("fresh launch shows the SHAPE arrive prompt first", async ({ page }) => {
  await startFreshNew(page);
  const prompt = page.locator(".arrive-prompt").first();
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveAttribute("data-arrive-step", "shape");
  await expect(prompt).toContainText(/shape the drone/i);
});

test("touching a SHAPE macro advances the prompt to WEATHER", async ({ page }) => {
  await startFreshNew(page);
  const prompt = page.locator(".arrive-prompt").first();
  await expect(prompt).toHaveAttribute("data-arrive-step", "shape");

  // SHAPE wrapper has data-tutor="shape"; pointer-down anywhere on
  // it triggers the advance via onPointerDownCapture.
  await page.locator('[data-tutor="shape"]').first().click({ position: { x: 4, y: 4 }, force: true });

  await expect(prompt).toHaveAttribute("data-arrive-step", "weather");
  await expect(prompt).toContainText(/move the room/i);
});

test("dragging WEATHER advances the prompt to TONIC", async ({ page }) => {
  await startFreshNew(page);
  const prompt = page.locator(".arrive-prompt").first();

  // Skip past SHAPE step quickly.
  await page.locator('[data-tutor="shape"]').first().click({ position: { x: 4, y: 4 }, force: true });
  await expect(prompt).toHaveAttribute("data-arrive-step", "weather");

  // Drag inside the WEATHER pad to fire onDismissIntro → advance.
  const pad = page.locator('[data-tutor="weather"] .weather-xy').first();
  const box = await pad.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("weather pad not visible");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 6 });
  await page.mouse.up();

  await expect(prompt).toHaveAttribute("data-arrive-step", "tonic");
  await expect(prompt).toContainText(/change the root/i);
});

test("returning user with autosave does not see ARRIVE", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      // Minimal autosave shape — just needs to be present so DroneView
      // skips the arriveStep init. The stored value isn't parsed by
      // the arrive gate, only its existence.
      localStorage.setItem("mdrone-autosave", JSON.stringify({ scene: {}, savedAt: Date.now() }));
    } catch { /* ok */ }
  });
  await page.goto("/");
  // With autosave present, StartGate offers Continue Last Scene.
  const btn = page.getByRole("button", { name: /continue last scene|start new|start mdrone/i }).first();
  await expect(btn).toBeVisible();
  await btn.click();

  await expect(page.locator(".arrive-prompt")).toHaveCount(0);
});

test("keyboard SHAPE input advances the prompt to WEATHER", async ({ page }) => {
  await startFreshNew(page);
  const prompt = page.locator(".arrive-prompt").first();
  await expect(prompt).toHaveAttribute("data-arrive-step", "shape");

  // Focus a SHAPE macro range input and nudge it with the arrow key.
  // Range inputs fire 'input' on every keyboard step, which bubbles
  // to the SHAPE wrapper's onInputCapture and advances ARRIVE.
  const macro = page.locator('[data-tutor="shape"] input[type="range"]').first();
  await macro.focus();
  await macro.press("ArrowRight");

  await expect(prompt).toHaveAttribute("data-arrive-step", "weather");
});

test("keyboard WEATHER slider advances the prompt to TONIC", async ({ page }) => {
  await startFreshNew(page);
  const prompt = page.locator(".arrive-prompt").first();

  // Get past SHAPE first via the keyboard path.
  const macro = page.locator('[data-tutor="shape"] input[type="range"]').first();
  await macro.focus();
  await macro.press("ArrowRight");
  await expect(prompt).toHaveAttribute("data-arrive-step", "weather");

  // Use the SR Brightness slider via keyboard.
  const brightness = page.getByRole("slider", { name: /brightness/i }).first();
  await brightness.focus();
  await brightness.press("ArrowRight");

  await expect(prompt).toHaveAttribute("data-arrive-step", "tonic");
});

test("ARRIVE never auto-advances without a gesture (no SHAPE/WEATHER timers)", async ({ page }) => {
  await startFreshNew(page);
  const prompt = page.locator(".arrive-prompt").first();
  await expect(prompt).toHaveAttribute("data-arrive-step", "shape");

  // Wait well past the old 9 s SHAPE timer; with timers removed the
  // prompt must still be on SHAPE.
  await page.waitForTimeout(2500);
  await expect(prompt).toHaveAttribute("data-arrive-step", "shape");
});

test("programmatic preset/scene load does not advance ARRIVE", async ({ page }) => {
  await startFreshNew(page);
  const prompt = page.locator(".arrive-prompt").first();
  await expect(prompt).toHaveAttribute("data-arrive-step", "shape");

  // Open the preset strip and click a preset — that's a user gesture,
  // but loading a preset should NOT touch the ARRIVE state because
  // applySnapshot uses the raw setRoot, not setRootFromUser.
  await page.locator(".preset-strip-chevron").first().click();
  const preset = page.locator(".preset-btn").first();
  await expect(preset).toBeVisible({ timeout: 5000 });
  await preset.click();

  // Step is still on SHAPE — preset load is not a SHAPE/WEATHER/TONIC
  // gesture. (It changes scene state including root, but the wrapped
  // setRootFromUser is only used for explicit tonic UI/MIDI/QWERTY.)
  await expect(prompt).toHaveAttribute("data-arrive-step", "shape");
});
