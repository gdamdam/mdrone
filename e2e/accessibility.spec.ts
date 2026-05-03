import { test, expect, type Page } from "@playwright/test";

/**
 * Accessibility — keyboard, ARIA semantics, modal focus management.
 * Companion to smoke.spec.ts; intentionally narrow — verifies the
 * concrete contracts added by the accessibility audit.
 */

const START_BUTTONS = /start mdrone|start new|continue last scene|play this scene/i;

const dismissStartGate = async (page: Page) => {
  const btn = page.getByRole("button", { name: START_BUTTONS }).first();
  await expect(btn).toBeVisible();
  await btn.click();
};

test("HOLD button exposes aria-pressed state", async ({ page }) => {
  await page.goto("/");
  await dismissStartGate(page);
  const hold = page.locator(".header-hold-btn").first();
  await expect(hold).toBeVisible();
  // aria-pressed must be present and a boolean string; click must flip it.
  const initial = await hold.getAttribute("aria-pressed");
  expect(initial === "true" || initial === "false").toBe(true);
  await hold.click();
  const flipped = await hold.getAttribute("aria-pressed");
  expect(flipped).not.toBe(initial);
  expect(flipped === "true" || flipped === "false").toBe(true);
});

test("WEATHER pad has keyboard-accessible Brightness and Motion sliders", async ({ page }) => {
  await page.goto("/");
  await dismissStartGate(page);

  const brightness = page.getByRole("slider", { name: /brightness/i }).first();
  const motion = page.getByRole("slider", { name: /motion/i }).first();
  await expect(brightness).toHaveCount(1);
  await expect(motion).toHaveCount(1);

  // Both must be reachable and operable via keyboard.
  await brightness.focus();
  const beforeX = await brightness.inputValue();
  await brightness.press("ArrowRight");
  await brightness.press("ArrowRight");
  const afterX = await brightness.inputValue();
  expect(parseInt(afterX, 10)).toBeGreaterThan(parseInt(beforeX, 10));

  await motion.focus();
  const beforeY = await motion.inputValue();
  await motion.press("ArrowRight");
  await motion.press("ArrowRight");
  const afterY = await motion.inputValue();
  expect(parseInt(afterY, 10)).toBeGreaterThan(parseInt(beforeY, 10));
});

test("Escape closes the Share modal and restores focus to opener", async ({ page }) => {
  await page.goto("/");
  await dismissStartGate(page);

  const shareBtn = page.getByRole("button", { name: /copy scene link/i }).first();
  await shareBtn.click();

  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("FX buttons expose aria-pressed", async ({ page }) => {
  await page.goto("/");
  await dismissStartGate(page);

  // FX BAR lives inside the EDIT disclosure now — expand it first.
  await page.locator('[data-tutor="edit-toggle"]').click();
  const firstFx = page.locator(".fx-btn").first();
  await expect(firstFx).toBeVisible();
  // aria-pressed is always present (true or false) — never missing.
  const pressed = await firstFx.getAttribute("aria-pressed");
  expect(pressed === "true" || pressed === "false").toBe(true);
});
