/**
 * In-process integration test for the ONLINE multiplayer path — the project's
 * defining feature, previously covered by no automated test at any level.
 *
 * It drives real NetworkTransports against an in-process GameApi backed by the
 * SHARED handlers (the same op layer both backends now run, post-unification)
 * over a MemoryGameStore. No network, no emulator, no secrets: this exercises the
 * networked client (connect, per-seat redaction, act→refetch convergence,
 * out-of-turn no-ops) end to end against the real authority.
 */
import { describe, it, expect } from "vitest";
import { makeMemoryStore } from "./memoryStore";
import { handleCreate, handleJoin, handleStart, handleAct, handleState } from "./handlers";
import type { GameStore } from "./store";
import { BackendError, type CreateConfig, type GameApi } from "./gameApi";
import type { GameBackend } from "./backend";
import { NetworkTransport, type NetworkSnapshot } from "./networkTransport";
import { HIDDEN_CARD } from "./authority";
import { DEFAULT_OPTIONS } from "./engine";
import type { GameAction } from "./actions";

/**
 * A GameApi that runs the shared handlers in-process, mapping each OpResult to
 * the typed API exactly like the real HTTP clients do: a non-2xx throws a
 * BackendError, and 409 is flagged `conflict` so the transport resyncs.
 */
function makeInProcessApi(store: GameStore): GameApi {
  const unwrap = <T>(r: { status: number; body: unknown }): T => {
    if (r.status >= 400) {
      const msg = (r.body as { error?: string })?.error ?? `HTTP ${r.status}`;
      throw new BackendError(msg, r.status, r.status === 409);
    }
    return r.body as T;
  };
  return {
    async create(config) {
      return unwrap(await handleCreate(store, { config }));
    },
    async join(code, name) {
      return unwrap(await handleJoin(store, { code, name }));
    },
    async start(gameId, seatToken) {
      unwrap(await handleStart(store, { gameId, seatToken }));
    },
    async act(gameId, seatToken, action) {
      unwrap(await handleAct(store, { gameId, seatToken, action }));
    },
    async state(gameId, seatToken) {
      return unwrap(await handleState(store, { gameId, seatToken }));
    },
  };
}

const CONFIG: CreateConfig = {
  creatorName: "Host",
  humans: 2,
  ai: [],
  options: { ...DEFAULT_OPTIONS },
};

/**
 * Seat two humans and start, retrying until the deal lands in an active phase.
 * (A dealt natural 31 resolves the deal instantly — rare, but retry so the
 * assertions never flake on a random shuffle.)
 */
async function activeGame() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const store = makeMemoryStore();
    const api = makeInProcessApi(store);
    const host = await api.create(CONFIG);
    const guest = await api.join(host.code, "Guest");
    await api.start(host.gameId, host.seatToken);
    const s = await api.state(host.gameId, host.seatToken);
    if (s.state.phase === "drawing" || s.state.phase === "discarding") {
      const backend: GameBackend = { name: "InProcess", api, subscribe: () => () => {} };
      return { backend, host, guest, gameId: host.gameId };
    }
  }
  throw new Error("could not reach an active deal in 30 attempts");
}

/** Track a transport's latest emitted snapshot. */
function latest(t: NetworkTransport): () => NetworkSnapshot {
  let snap: NetworkSnapshot | null = null;
  t.subscribe((s) => (snap = s));
  return () => {
    if (!snap) throw new Error("no snapshot yet");
    return snap;
  };
}

describe("online multiplayer (NetworkTransport over the shared handlers)", () => {
  it("connects two seats, each seeing only its own hand (redaction end to end)", async () => {
    const { backend, host, guest, gameId } = await activeGame();
    const hostT = new NetworkTransport(backend, gameId, host.seatToken);
    const guestT = new NetworkTransport(backend, gameId, guest.seatToken);
    try {
      await hostT.connect();
      await guestT.connect();
      const h = hostT.getState()!;
      const g = guestT.getState()!;

      // Host sees its own hand; the opponent's is fully hidden (count preserved).
      expect(h.players[0].hand.some((c) => c.id !== HIDDEN_CARD.id)).toBe(true);
      expect(h.players[1].hand.length).toBeGreaterThan(0);
      expect(h.players[1].hand.every((c) => c.id === HIDDEN_CARD.id)).toBe(true);
      // From the guest's seat, the relationship flips.
      expect(g.players[1].hand.some((c) => c.id !== HIDDEN_CARD.id)).toBe(true);
      expect(g.players[0].hand.every((c) => c.id === HIDDEN_CARD.id)).toBe(true);
    } finally {
      hostT.destroy();
      guestT.destroy();
    }
  });

  it("applies the current player's move, converges both clients, and ignores out-of-turn moves", async () => {
    const { backend, host, guest, gameId } = await activeGame();
    const hostT = new NetworkTransport(backend, gameId, host.seatToken);
    const guestT = new NetworkTransport(backend, gameId, guest.seatToken);
    const hostSnap = latest(hostT);
    const guestSnap = latest(guestT);
    try {
      await hostT.connect();
      await guestT.connect();

      // Both clients agree on the version at the start of the turn.
      expect(guestSnap().version).toBe(hostSnap().version);
      const v0 = hostSnap().version;
      const cur = hostSnap().state.cur; // whose turn (0 or 1)
      const curT = cur === 0 ? hostT : guestT;
      const otherT = cur === 0 ? guestT : hostT;

      if (hostSnap().state.phase === "drawing") {
        // Current player draws → version bumps, phase → discarding.
        await curT.act({ type: "drawDeck" } as GameAction);
        await otherT.refresh(); // no push in this backend; pull to converge
        expect(hostSnap().version).toBeGreaterThan(v0);
        expect(guestSnap().version).toBe(hostSnap().version); // both converged
        expect(hostSnap().state.phase).toBe("discarding");

        // The other seat acting out of turn is a no-op: it resolves (no throw)
        // and does not bump the version.
        const vAfterDraw = hostSnap().version;
        await expect(otherT.act({ type: "drawDeck" } as GameAction)).resolves.toBeUndefined();
        await hostT.refresh();
        expect(hostSnap().version).toBe(vAfterDraw);
      }
    } finally {
      hostT.destroy();
      guestT.destroy();
    }
  });
});
