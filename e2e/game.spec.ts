import { test, expect } from "@playwright/test";

/**
 * Real-browser smoke of the things unit/integration tests can't cover: the app
 * actually boots, a solo game plays, and the dialogs are keyboard-accessible.
 * Solo-only, so it needs no backend secrets (runs on fork PRs too).
 */

test("boots to the setup screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /start solo adventure/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("plays a solo turn: deal, draw, discard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /start solo adventure/i }).click();

  // The board deals in; your hand shows three cards.
  const hand = page.locator(".board__hand .card");
  await expect(hand).toHaveCount(3, { timeout: 15_000 });

  // Draw from the deck → four cards, then discard one. The turn then passes to
  // an AI (its "thinking" view appears), which confirms the discard registered.
  await page.getByRole("button", { name: /^draw from deck$/i }).click();
  await expect(hand).toHaveCount(4);
  await hand.first().click();
  await page.getByRole("button", { name: /discard selected/i }).click();
  await expect(page.locator(".board__ai")).toBeVisible({ timeout: 8000 });
});

test("About dialog opens, shows the version, and Escape closes it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^about$/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/frontend/i);
  await expect(dialog).toContainText(/v\d+\.\d+\.\d+/); // version string
  await expect(dialog).toContainText(/hosting/i);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Learn-to-play help is reachable and dismissable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /learn to play/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: /close/i }).click();
  await expect(dialog).toBeHidden();
});
