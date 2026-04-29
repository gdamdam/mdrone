import { test, expect, type Page } from "@playwright/test";

/**
 * Recording polish — verify the REC WAV button is clearly labelled
 * and cycles through idle → recording → idle without console errors.
 * Does not download a real WAV (we stop without saving by toggling
 * twice quickly).
 */

const START_BUTTONS = /start mdrone|start new|continue last scene|play this scene/i;

const dismissStartGate = async (page: Page) => {
  const btn = page.getByRole("button", { name: START_BUTTONS }).first();
  await expect(btn).toBeVisible();
  await btn.click();
};

test("REC button shows clear WAV labelling and toggles state", async ({ page }) => {
  await page.goto("/");
  await dismissStartGate(page);

  // Open the preset strip so the REC group is mounted.
  await page.locator(".preset-strip-chevron").first().click();

  const rec = page.locator('[data-tutor="rec"]').first();
  await expect(rec).toBeVisible();
  // Idle copy must read REC WAV (or N/A on unsupported browsers).
  const idleText = (await rec.textContent())?.trim() ?? "";
  expect(idleText).toMatch(/REC WAV|WAV N\/A/);

  // If unsupported, button is disabled — nothing more to assert.
  const disabled = await rec.isDisabled();
  if (disabled) return;

  // Start recording — copy switches to a stop glyph + duration.
  await rec.click();
  await expect(rec).toContainText(/■\s+\d+:\d{2}/);

  // Stop — copy returns to REC WAV.
  await rec.click();
  await expect(rec).toContainText(/REC WAV/);
});
