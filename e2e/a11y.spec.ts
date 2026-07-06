import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated accessibility scan (axe-core) of the two primary solo surfaces: the
 * setup/landing screen and the in-game board. Gates on WCAG 2.1 A/AA rules,
 * failing only on `serious`/`critical` impact so a genuine regression (a missing
 * label, a contrast failure, an unnamed control) fails CI while cosmetic
 * `minor`/`moderate` findings don't block contributors. Runs against the same
 * local production build as game.spec.ts.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING = new Set(["serious", "critical"]);

/** Scan the current page and return only the serious/critical violations. */
async function scan(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
}

/** A compact, readable summary for the assertion message. */
const summarize = (violations: Awaited<ReturnType<typeof scan>>) =>
  violations.map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);

test("setup screen has no serious/critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /start solo adventure/i })).toBeVisible();
  const violations = await scan(page);
  expect(summarize(violations), "axe violations on the setup screen").toEqual([]);
});

test("in-game board has no serious/critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /start solo adventure/i }).click();
  // Wait for the deal to settle so we scan the real board, not the deal animation.
  await expect(page.locator(".board__hand .card")).toHaveCount(3, { timeout: 15_000 });
  const violations = await scan(page);
  expect(summarize(violations), "axe violations on the game board").toEqual([]);
});

// The online screens are reachable at PR time because the e2e build points at
// the local in-memory backend (e2e/localServer.ts) — so the join form and the
// lobby get the same accessibility gate as the solo surfaces.

test("join-by-code screen has no serious/critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /join with code/i }).click();
  await expect(page.locator(".join__input--code")).toBeVisible();
  const violations = await scan(page);
  expect(summarize(violations), "axe violations on the join screen").toEqual([]);
});

test("online lobby has no serious/critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /create online game/i }).click();
  // The shareable code renders once the backend has created the room.
  await expect(page.locator(".lobby__code")).toBeVisible({ timeout: 15_000 });
  const violations = await scan(page);
  expect(summarize(violations), "axe violations on the lobby").toEqual([]);
});
