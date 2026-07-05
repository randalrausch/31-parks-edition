import { test, expect } from "@playwright/test";

/**
 * PR-time online round: two independent browser contexts play a real online
 * game against the LOCAL in-memory backend (e2e/localServer.ts) — the same
 * shared op layer both production backends run. Host creates a room, guest
 * joins by code, host starts, and a turn is taken — exercising
 * create/join/start/act, the lobby's join propagation (via the client's
 * safety-net poll), and the per-seat redaction path, all before merge.
 *
 * This is the local sibling of the two-browser test in deployment.spec.ts: that
 * one proves the DEPLOYED stack after a ship; this one catches online/board
 * regressions at PR time. Keep their flows aligned.
 *
 * The e2e build must have the local backend baked in (`vite build --mode e2e`,
 * which reads .env.e2e — the test:e2e script does this). If the create button
 * is missing, that wiring broke — fail loudly rather than skip, so an online
 * regression can't slip through as a silently-skipped test.
 */

// Convergence between the two browsers rides the client's 4s safety-net poll
// (no push channel locally, same as production Azure) — allow a few cycles.
const NET = 20_000;

test("online: two browsers create, join, start, and take a turn (local backend)", async ({
  browser,
}) => {
  // The flow chains many poll-driven waits (create → join → start → act, each
  // converging on the 4s safety-net poll); give the whole test room past the
  // 30s default — same as playwright.deploy.config.ts does for its sibling.
  test.setTimeout(120_000);
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const pageErrors: string[] = [];
  host.on("pageerror", (e) => pageErrors.push(`host: ${e.message}`));
  guest.on("pageerror", (e) => pageErrors.push(`guest: ${e.message}`));

  try {
    // Host creates the room and lands in the lobby showing a shareable code.
    await host.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      host.getByRole("button", { name: /create online game/i }),
      "online must be enabled in the e2e build — did `vite build --mode e2e` run (see .env.e2e)?",
    ).toBeVisible();
    await host.getByRole("button", { name: /create online game/i }).click();
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

    // The host sees the guest arrive (seat fills → start enables) and the guest
    // waits in the lobby — both confirm the join propagated through the backend.
    const startBtn = host.getByRole("button", { name: /start game/i });
    await expect(startBtn).toBeEnabled({ timeout: NET });
    await expect(guest.locator(".lobby__waiting")).toBeVisible({ timeout: NET });
    await startBtn.click();

    // Both reach the playing board (the in-game "Leave game" control is only
    // present once playing).
    await expect(host.getByRole("button", { name: /leave game/i })).toBeVisible({ timeout: NET });
    await expect(guest.getByRole("button", { name: /leave game/i })).toBeVisible({ timeout: NET });

    // The host (seat 0) leads the first turn: draw, then discard; the move must
    // register (draw disables) without a client error on either side.
    const hand = host.locator(".board__hand .card");
    await expect(hand).toHaveCount(3, { timeout: NET });
    const draw = host.locator("button.btn--draw", { hasText: /draw/i });
    await expect(draw).toBeEnabled({ timeout: NET });
    await draw.click();
    await expect(hand).toHaveCount(4, { timeout: NET });
    await hand.first().click();
    await host.getByRole("button", { name: /discard selected/i }).click();
    await expect(draw).toBeDisabled({ timeout: NET });

    expect(pageErrors, "no client errors during the online round").toEqual([]);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
