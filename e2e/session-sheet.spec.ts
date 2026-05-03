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

// Note: Playwright's `name` option does substring matching by default,
// so `name: "Session"` would also match the "Save Session" prompt that
// opens after the SAVE click. `exact: true` keeps the two dialogs
// disambiguated even when both are momentarily in the DOM.
const sheetDialog = (page: Page) => page.getByRole("dialog", { name: "Session", exact: true });
const savePromptDialog = (page: Page) => page.getByRole("dialog", { name: /Save Session/i });

const openSessionSheet = async (page: Page) => {
  await page.getByRole("button", { name: "Open session sheet" }).click();
  await expect(sheetDialog(page)).toBeVisible();
};

const closeSheetIfOpen = async (page: Page) => {
  const sheet = sheetDialog(page);
  if (await sheet.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
};

const saveCurrentSessionAs = async (page: Page, name: string) => {
  await openSessionSheet(page);
  // SAVE button inside the SHEET (not the prompt — the prompt isn't
  // open yet). Scope by dialog name to avoid the prompt's identical
  // SAVE button after the click.
  await sheetDialog(page).getByRole("button", { name: /^SAVE$/ }).click();

  // Sheet closes; Save Session prompt opens.
  await expect(sheetDialog(page)).toBeHidden();
  const prompt = savePromptDialog(page);
  await expect(prompt).toBeVisible();

  await prompt.locator(".dialog-input").fill(name);
  await prompt.getByRole("button", { name: /^SAVE$/ }).click();
  await expect(prompt).toBeHidden();
};

test("◆ session sheet round-trips a session through EXPORT JSON / IMPORT JSON", async ({ page }, testInfo) => {
  await page.goto("/");
  await dismissStartGate(page);

  const sessionName = `e2e-roundtrip-${testInfo.workerIndex}-${Date.now()}`;
  await saveCurrentSessionAs(page, sessionName);

  // Re-open sheet and verify "Current: <name>" reflects the save.
  await openSessionSheet(page);
  // The name also lives inside the LOAD dropdown's selected label; the
  // canonical "Current: " readout is a <strong> in the description
  // paragraph, so target that directly to avoid a strict-mode collision.
  await expect(sheetDialog(page).locator("strong", { hasText: sessionName })).toBeVisible();

  // EXPORT JSON — capture the download.
  const downloadPromise = page.waitForEvent("download");
  await sheetDialog(page).getByRole("button", { name: /EXPORT JSON/ }).click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  expect(filename).toMatch(/^mdrone-.+\.json$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const exportedJson = await readFile(filePath!, "utf8");
  // Sanity: JSON parses and embeds the session name.
  const parsed = JSON.parse(exportedJson);
  expect(typeof parsed).toBe("object");
  expect(parsed?.name).toBe(sessionName);

  // Mutate the loaded session so IMPORT has something to overwrite.
  await closeSheetIfOpen(page);
  await page.locator(".preset-strip-chevron").first().click();
  const presets = page.locator(".preset-btn");
  await expect(presets.first()).toBeVisible({ timeout: 5_000 });
  await presets.first().click();

  // IMPORT JSON — feed the captured payload into the hidden file
  // input. The handler succeeds → sets sessionName and auto-closes.
  await openSessionSheet(page);
  const importInput = sheetDialog(page).locator('input[type="file"][accept*="json"]');
  await importInput.setInputFiles({
    name: filename,
    mimeType: "application/json",
    buffer: Buffer.from(exportedJson, "utf8"),
  });

  // Sheet auto-closes on successful import.
  await expect(sheetDialog(page)).toBeHidden({ timeout: 5_000 });

  // Re-open and confirm the session name was restored from the JSON.
  await openSessionSheet(page);
  // The name also lives inside the LOAD dropdown's selected label; the
  // canonical "Current: " readout is a <strong> in the description
  // paragraph, so target that directly to avoid a strict-mode collision.
  await expect(sheetDialog(page).locator("strong", { hasText: sessionName })).toBeVisible();
});
