import { test, expect, type Page } from "@playwright/test";

/**
 * Recording polish — verify the REC WAV control inside the header
 * ⤓ EXPORT AUDIO dropdown is clearly labelled. The button used to
 * live in the perform row; it's now consolidated under the header
 * dropdown alongside BOUNCE LOOP and TIMED REC.
 *
 * Does not download a real WAV (we never click "● REC WAV").
 */

const START_BUTTONS = /start mdrone|start new|continue last scene|play this scene/i;

const dismissStartGate = async (page: Page) => {
  const btn = page.getByRole("button", { name: START_BUTTONS }).first();
  await expect(btn).toBeVisible();
  await btn.click();
};

test("⤓ EXPORT dropdown REC LIVE button is clearly labelled WAV", async ({ page }) => {
  await page.goto("/");
  await dismissStartGate(page);

  // Open the ⤓ dropdown.
  const exportBtn = page.getByRole("button", { name: "Export audio" });
  await expect(exportBtn).toBeVisible();
  await exportBtn.click();

  const menu = page.getByRole("menu", { name: "Export audio" });
  await expect(menu).toBeVisible();

  // Idle copy must read "REC WAV" (or "WAV N/A" on unsupported
  // browsers) — never the ambiguous bare "REC".
  const rec = menu.getByRole("button", { name: /REC WAV|WAV N\/A/ });
  await expect(rec).toBeVisible();
  const idleText = (await rec.textContent())?.trim() ?? "";
  expect(idleText).toMatch(/REC WAV|WAV N\/A/);
  expect(idleText).not.toMatch(/^\s*●\s*REC\s*$/);

  // Tooltip must mention WAV explicitly so users tell this apart from
  // BOUNCE LOOP / TIMED REC without clicking.
  const title = (await rec.getAttribute("title")) ?? "";
  expect(title.toLowerCase()).toContain("wav");
});
