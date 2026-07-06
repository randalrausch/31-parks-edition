/**
 * Wire-contract shape snapshots.
 *
 * PROTOCOL_VERSION is bumped by HUMAN JUDGMENT (version.ts), and the failure
 * mode is silent: an op response or the redacted-state shape changes without
 * anyone noticing it's a wire break until a stale client misparses it. These
 * snapshots pin the TYPE-SHAPE (field names + primitive types, not values) of
 * every op's success body — including the per-seat and spectator redacted
 * views — so any change to what goes over the wire produces a visible snapshot
 * diff in the PR.
 *
 * If this snapshot changes: that IS a wire-contract change. Decide deliberately
 * whether it's backward-compatible (purely additive fields usually are) or
 * needs a PROTOCOL_VERSION bump (removed/renamed/retyped fields do — see
 * docs/adr/0003-protocol-version.md), then update the snapshot with
 * `npx vitest run wireShape -u` and say so in the PR.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  handleAct,
  handleCreate,
  handleHealth,
  handleJoin,
  handleStart,
  handleState,
  handleVersion,
} from "./handlers";
import { makeMemoryStore } from "./memoryStore";
import { mulberry32 } from "./fuzzRig";

/**
 * Recursively map a JSON value to its type-shape: primitives to their typeof,
 * objects to sorted-key maps of shapes, arrays to their distinct element
 * shapes. Values never appear, so random ids/cards/names can't churn the
 * snapshot — only structural change can.
 */
function shapeOf(v: unknown): unknown {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    const seen = new Map<string, unknown>();
    for (const el of v) {
      const s = shapeOf(el);
      seen.set(JSON.stringify(s), s);
    }
    return seen.size === 0 ? ["<empty>"] : [...seen.values()];
  }
  if (typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, shapeOf(val)]),
    );
  }
  return typeof v;
}

// The engine shuffles with Math.random; seed it so the game reaches the same
// deterministic mid-game state (and thus the same shape) on every run.
beforeAll(() => vi.spyOn(Math, "random").mockImplementation(mulberry32(0x5eed)));
afterAll(() => vi.restoreAllMocks());

describe("wire-contract shapes (bump PROTOCOL_VERSION on a breaking change)", () => {
  it("op responses and redacted views keep their shape", async () => {
    const store = makeMemoryStore();

    // create → join → start → state → act: the full op surface, one lobby.
    const create = await handleCreate(store, {
      config: { humans: 2, ai: [{ name: "Bot", traits: { bluff: 3 } }] },
    });
    expect(create.status).toBe(200);
    const { gameId, code, seatToken: hostToken } = create.body as Record<string, string>;

    const stateLobby = await handleState(store, { gameId, seatToken: hostToken });

    const join = await handleJoin(store, { code, name: "Guest" });
    expect(join.status).toBe(200);
    const guestToken = (join.body as Record<string, string>).seatToken;

    const start = await handleStart(store, { gameId, seatToken: hostToken });
    expect(start.status).toBe(200);

    const statePlaying = await handleState(store, { gameId, seatToken: hostToken });
    const stateSpectator = await handleState(store, { gameId }); // no token → spectator view

    // Act as whoever's turn it is (deterministic under the seeded shuffle), and
    // once as the other seat so the not-applied shape is pinned too.
    const cur = (
      (statePlaying.body as { state: { cur: number } }).state as {
        cur: number;
      }
    ).cur;
    const [onTurn, offTurn] = cur === 0 ? [hostToken, guestToken] : [guestToken, hostToken];
    const actApplied = await handleAct(store, {
      gameId,
      seatToken: onTurn,
      action: { type: "drawDeck" },
    });
    expect(actApplied.status).toBe(200);
    const actNotApplied = await handleAct(store, {
      gameId,
      seatToken: offTurn,
      action: { type: "drawDeck" },
    });
    expect(actNotApplied.status).toBe(200);

    const notFound = await handleState(store, { gameId: "nope" });

    expect({
      create: shapeOf(create.body),
      join: shapeOf(join.body),
      start: shapeOf(start.body),
      state_lobby_seated: shapeOf(stateLobby.body),
      state_playing_seated: shapeOf(statePlaying.body),
      state_playing_spectator: shapeOf(stateSpectator.body),
      act_applied: shapeOf(actApplied.body),
      act_not_applied: shapeOf(actNotApplied.body),
      error: shapeOf(notFound.body),
      version: shapeOf(handleVersion("Test").body),
      health: shapeOf((await handleHealth(store, "Test")).body),
    }).toMatchSnapshot();
  });
});
