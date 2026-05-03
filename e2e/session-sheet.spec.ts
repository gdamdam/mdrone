import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/**
 * Session ◆ sheet — round-trip a session through EXPORT JSON and
 * IMPORT JSON, asserting the session name survives intact.
 *
 * The save handler relies on the prompt's default name when the user
 * hits SAVE without typing — so this test sets an explicit name to
 * make the assertion deterministic regardless of the picker rotation
 * at boot.
 */

const START_BUTTONS = /start mdrone|start new|continue last scene|play this scene/i;

const dismissStartGate = async (page: Page) => {
  const btn = page.getByRole("button", { name: START_BUTTONS }).first();
  await expect(btn).toBeVisible();
  await btn.click();
};

const openSessionSheet = async (page: Page) => {
  await page.getByRole("button", { name: "Open session sheet" }).click();
  await expect(page.getByRole("dialog", { name: "Session" })).toBeVisible();
};

const saveCurrentSessionAs = async (page: Page, name: string) => {
  await openSessionSheet(page);
  await page.getByRole("button", { name: /^SAVE$/ }).click();
  // DialogModal opens with prefilled default — replace it.
  const input = page.locator(".dialog-input");
  await expect(input).toBeVisible();
  await input.fill(name);
  await page.getByRole("button", { name: /^SAVE$/ }).click();
  // Sheet may auto-close; if not, close it explicitly so the next
  // openSessionSheet() doesn't double-open.
  const dialog = page.getByRole("dialog", { name: "Session" });
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
  }
  await expect(dialog).toBeHidden();
};

test("◆ session sheet round-trips a session through EXPORT JSON / IMPORT JSON", async ({ page }, testInfo) => {
  await page.goto("/");
  await dismissStartGate(page);

  const sessionName = `e2e-roundtrip-${testInfo.workerIndex}-${Date.now()}`;
  await saveCurrentSessionAs(page, sessionName);

  // Re-open the sheet and verify "Current: <name>" reflects the save.
  await openSessionSheet(page);
  await expect(page.getByRole("dialog", { name: "Session" }).getByText(sessionName)).toBeVisible();

  // EXPORT JSON — capture the download.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /EXPORT JSON/ }).click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  expect(filename).toMatch(/^mdrone-.+\.json$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const exportedJson = await readFile(filePath!, "utf8");
  // Sanity: the payload is JSON and embeds the session name.
  const parsed = JSON.parse(exportedJson);
  expect(typeof parsed).toBe("object");
  expect(parsed?.name).toBe(sessionName);

  // Mutate the loaded session so the IMPORT step has something to
  // overwrite — pick a different preset, then import and assert the
  // session name is restored.
  // (Closing + re-opening the sheet keeps the sheet's own state clean.)
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Session" })).toBeHidden();
  await page.locator(".preset-strip-chevron").first().click();
  const presets = page.locator(".preset-btn");
  await expect(presets.first()).toBeVisible({ timeout: 5000 });
  await presets.first().click();

  // IMPORT JSON — feed the exported file back through the hidden file
  // input. Set the file BEFORE clicking the trigger button so the
  // change handler fires deterministically.
  await openSessionSheet(page);
  const importInput = page.locator('input[type="file"][accept*="json"]');
  await importInput.setInputFiles({
    name: filename,
    mimeType: "application/json",
    buffer: Buffer.from(exportedJson, "utf8"),
  });

  // Sheet auto-closes on successful import. Re-open and confirm the
  // session name was restored from the JSON.
  await expect(page.getByRole("dialog", { name: "Session" })).toBeHidden({ timeout: 5_000 });
  await openSessionSheet(page);
  await expect(page.getByRole("dialog", { name: "Session" }).getByText(sessionName)).toBeVisible();
});
