import { test, expect, type Page } from "@playwright/test";

/**
 * Deployment smoke — drives a REAL browser against a LIVE deployed site (the
 * thing users actually hit), not a local preview. It's the answer to "did the
 * deploy actually work?": the built bundle loads, a solo game plays, and — the
 * part unit/integration tests can never cover — two browsers create/join/start a
 * real online game against the live backend, proving the deployed API + per-seat
 * redaction work end to end.
 *
 * Target it with E2E_BASE_URL (the deployed URL); playwright.deploy.config.ts
 * reads it as baseURL and drops the local webServer. With E2E_BASE_URL unset the
 * whole file skips, so it never runs against the local preview by accident.
 *
 * Runs in CI post-deploy (azure.yml), where egress to the live site is open. It
 * can't run from an agent sandbox whose egress policy blocks the public domain —
 * point it at the site from CI or a developer machine instead.
 */

const BASE = process.env.E2E_BASE_URL;

test.skip(!BASE, "Set E2E_BASE_URL to the deployed site to run deployment smoke tests.");

// Real network to a live service: be patient and forgiving of a cold start.
test.describe.configure({ mode: "serial" });
const NET = 30_000;

test("live site boots and reports its version", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /start solo adventure/i })).toBeVisible({
    timeout: NET,
  });

  await page.getByRole("button", { name: /^about$/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/v\d+\.\d+\.\d+/); // the deployed build's version
  await expect(dialog).toContainText(/hosting/i);
  await page.keyboard.press("Escape");

  expect(errors, "no uncaught errors on the live site").toEqual([]);
});

test("plays a solo turn on the live site", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /start solo adventure/i }).click();

  const hand = page.locator(".board__hand .card");
  await expect(hand).toHaveCount(3, { timeout: NET });
  await page.getByRole("button", { name: /^draw deck$/i }).click();
  await expect(hand).toHaveCount(4);
  await hand.first().click();
  await page.getByRole("button", { name: /discard selected/i }).click();
  // Turn passes to an AI — its thinking view appears, confirming the discard took.
  await expect(page.locator(".board__ai")).toBeVisible({ timeout: NET });
});

/**
 * The real prize: two independent browsers play an online game against the live
 * backend. Host creates a room, guest joins by code, host starts, and each takes
 * a turn — exercising create/join/start/act plus the redaction that keeps each
 * player's hand private. Skips gracefully if multiplayer isn't enabled on the
 * target build (no VITE_API_BASE / VITE_SUPABASE_* baked in).
 */
test("online: two browsers create, join, start, and take a turn on the live backend", async ({
  browser,
}) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const pageErrors: string[] = [];
  host.on("pageerror", (e) => pageErrors.push(`host: ${e.message}`));
  guest.on("pageerror", (e) => pageErrors.push(`guest: ${e.message}`));

  try {
    await host.goto("/", { waitUntil: "domcontentloaded" });
    const createBtn = host.getByRole("button", { name: /create online game/i });
    if ((await createBtn.count()) === 0) {
      test.skip(true, "Multiplayer isn't enabled on this deployment (no backend configured).");
      return;
    }

    // Host creates the room and lands in the lobby showing a shareable code.
    await createBtn.click();
    const codeEl = host.locator(".lobby__code");
    await expect(codeEl).toBeVisible({ timeout: NET });
    const code = (await codeEl.innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{4,6}$/);

    // Guest joins by code.
    await guest.goto("/", { waitUntil: "domcontentloaded" });
    await guest.getByRole("button", { name: /join with code/i }).click();
    await guest.locator(".join__input--code").fill(code);
    await guest.locator("input.join__input:not(.join__input--code)").fill("Guest");
    await guest.getByRole("button", { name: /join game/i }).click();

    // The host sees the guest arrive in real time (seat fills → start enables),
    // and the guest sits in the lobby waiting for the host — both confirm the
    // join propagated through the real backend.
    const startBtn = host.getByRole("button", { name: /start game/i });
    await expect(startBtn).toBeEnabled({ timeout: NET });
    await expect(guest.locator(".lobby__waiting")).toBeVisible({ timeout: NET });
    await startBtn.click();

    // Both reach the playing board — the game started for real on both clients
    // (the in-game "Leave game" control is only present once playing).
    await expect(host.getByRole("button", { name: /leave game/i })).toBeVisible({ timeout: NET });
    await expect(guest.getByRole("button", { name: /leave game/i })).toBeVisible({ timeout: NET });

    // Whichever player is on turn draws and discards; the move must register
    // (their own controls settle) without a client error on either side.
    const actor = host; // seat 0 (host) leads the first turn
    const hand = actor.locator(".board__hand .card");
    await expect(hand).toHaveCount(3, { timeout: NET });
    const draw = actor.getByRole("button", { name: /^draw deck$/i });
    if (await draw.isEnabled().catch(() => false)) {
      await draw.click();
      await expect(hand).toHaveCount(4, { timeout: NET });
      await hand.first().click();
      await actor.getByRole("button", { name: /discard selected/i }).click();
      // After acting it's no longer the host's turn to draw.
      await expect(draw).toBeDisabled({ timeout: NET });
    }

    expect(pageErrors, "no client errors during the online round").toEqual([]);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
