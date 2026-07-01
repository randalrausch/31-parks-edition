/**
 * Contract tests for the five ops against MemoryGameStore + the REAL engine.
 * These lock the wire shapes the client depends on and the authority rules
 * (host-only start, no-op detection, hidden-info redaction).
 */
import { describe, it, expect } from "vitest";
import { makeMemoryStore } from "./memoryStore";
import {
  handleCreate,
  handleJoin,
  handleStart,
  handleAct,
  handleState,
  handleVersion,
  handleHealth,
} from "./handlers";
import { HIDDEN_CARD } from "./authority";
import type { GameStore } from "./store";

const CONFIG = {
  config: {
    creatorName: "Randy",
    humans: 2,
    ai: [],
    options: {
      threeOfAKind: false,
      grace: true,
      knockPenalty: true,
      sound: false,
    },
  },
};

async function newGame(store: GameStore) {
  const created = (await handleCreate(store, CONFIG)).body as {
    gameId: string;
    code: string;
    seatToken: string;
  };
  const joined = (await handleJoin(store, { code: created.code, name: "Pat" })).body as {
    seatIndex: number;
    seatToken: string;
  };
  return {
    gameId: created.gameId,
    code: created.code,
    host: created,
    guest: joined,
  };
}

describe("handlers", () => {
  it("create returns the expected shape and seats the host at idx 0", async () => {
    const store = makeMemoryStore();
    const res = await handleCreate(store, CONFIG);
    expect(res.status).toBe(200);
    const b = res.body as {
      gameId: string;
      code: string;
      seatIndex: number;
      seatToken: string;
    };
    expect(b.seatIndex).toBe(0);
    expect(b.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(typeof b.seatToken).toBe("string");

    const st = (await handleState(store, { gameId: b.gameId, seatToken: b.seatToken })).body as {
      status: string;
      seatIndex: number;
      seats: { idx: number; filled: boolean }[];
    };
    expect(st.status).toBe("lobby");
    expect(st.seatIndex).toBe(0);
    expect(st.seats[0].filled).toBe(true);
  });

  it("join seats a second human with a distinct token/index", async () => {
    const store = makeMemoryStore();
    const { host, guest } = await newGame(store);
    expect(guest.seatIndex).toBe(1);
    expect(guest.seatToken).not.toBe(host.seatToken);
  });

  it("join with an unknown code 404s", async () => {
    const store = makeMemoryStore();
    const res = await handleJoin(store, { code: "ZZZZZ", name: "x" });
    expect(res.status).toBe(404);
  });

  it("only the host can start; start deals and goes to playing", async () => {
    const store = makeMemoryStore();
    const { gameId, host, guest } = await newGame(store);

    const notHost = await handleStart(store, {
      gameId,
      seatToken: guest.seatToken,
    });
    expect(notHost.status).toBe(403);

    const started = await handleStart(store, {
      gameId,
      seatToken: host.seatToken,
    });
    expect(started.status).toBe(200);

    const st = (await handleState(store, { gameId, seatToken: host.seatToken })).body as {
      status: string;
      state: { phase: string; players: { hand: unknown[] }[] };
    };
    expect(st.status).toBe("playing");
    // Normally an active turn (drawing/discarding); a dealt natural 31 resolves
    // the deal instantly to 'dealEnd' — a rare but valid start outcome. Either
    // way the game is playing and cards were dealt.
    expect(["drawing", "discarding", "dealEnd"]).toContain(st.state.phase);
    expect(st.state.players[0].hand.length).toBeGreaterThan(0);
  });

  it("act: valid move bumps version; out-of-turn move is a no-op", async () => {
    const store = makeMemoryStore();
    const { gameId, host, guest } = await newGame(store);
    await handleStart(store, { gameId, seatToken: host.seatToken });

    const before = (await handleState(store, { gameId, seatToken: host.seatToken })).body as {
      version: number;
      seatIndex: number;
      state: { cur: number };
    };
    const tokenFor = [host.seatToken, guest.seatToken];
    const cur = before.state.cur;
    const other = (cur + 1) % 2;

    // Wrong seat → no-op.
    const noop = await handleAct(store, {
      gameId,
      seatToken: tokenFor[other],
      action: { type: "drawDeck" },
    });
    expect(noop.body).toEqual({ ok: false, reason: "not-applied" });

    // Current seat draws → applied, version bumps.
    const applied = await handleAct(store, {
      gameId,
      seatToken: tokenFor[cur],
      action: { type: "drawDeck" },
    });
    expect(applied.body).toEqual({ ok: true });
    const after = (await handleState(store, { gameId, seatToken: host.seatToken })).body as {
      version: number;
    };
    expect(after.version).toBeGreaterThan(before.version);
  });

  it("state redacts: a viewer sees only their own hand", async () => {
    const store = makeMemoryStore();
    const { gameId, host, guest } = await newGame(store);
    await handleStart(store, { gameId, seatToken: host.seatToken });

    const asHost = (await handleState(store, { gameId, seatToken: host.seatToken })).body as {
      state: { players: { hand: { id: string }[] }[] };
    };
    // Opponent (seat 1) hand is fully hidden in the host's view, count preserved.
    const oppHand = asHost.state.players[1].hand;
    expect(oppHand.length).toBeGreaterThan(0);
    expect(oppHand.every((c) => c.id === HIDDEN_CARD.id)).toBe(true);
    // The host's own hand is real (not all hidden).
    expect(asHost.state.players[0].hand.some((c) => c.id !== HIDDEN_CARD.id)).toBe(true);

    // From the guest's view, the relationship flips.
    const asGuest = (await handleState(store, { gameId, seatToken: guest.seatToken })).body as {
      state: { players: { hand: { id: string }[] }[] };
    };
    expect(asGuest.state.players[0].hand.every((c) => c.id === HIDDEN_CARD.id)).toBe(true);
    expect(asGuest.state.players[1].hand.some((c) => c.id !== HIDDEN_CARD.id)).toBe(true);
  });

  it("version reports the given provider", () => {
    const b = handleVersion("Azure").body as {
      ok: boolean;
      provider: string;
      version: string;
    };
    expect(b.ok).toBe(true);
    expect(b.provider).toBe("Azure");
    expect(typeof b.version).toBe("string");
  });

  it("health does a datastore round-trip and reports healthy (200)", async () => {
    const store = makeMemoryStore();
    const res = await handleHealth(store, "Azure");
    expect(res.status).toBe(200);
    const b = res.body as { healthy: boolean; provider: string };
    expect(b.healthy).toBe(true);
    expect(b.provider).toBe("Azure");
  });

  it("health reports 503 when the datastore is unreachable", async () => {
    const broken = {
      getByCode: async () => {
        throw new Error("db down");
      },
    } as unknown as GameStore;
    const res = await handleHealth(broken, "Supabase");
    expect(res.status).toBe(503);
    expect((res.body as { healthy: boolean }).healthy).toBe(false);
  });
});
