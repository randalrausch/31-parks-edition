/**
 * The authority's five operations, ported from the Supabase Edge Function onto
 * the GameStore abstraction. Pure-ish: each takes a GameStore + the request body
 * and returns { status, body } — no HTTP, no Azure types — so they're unit-test
 * -able against MemoryGameStore with the real engine.
 *
 * Concurrency: every mutating op reads the game's ETag, computes the next state,
 * and commits via store.update(...) which atomically replaces the public + secret
 * rows iff the ETag still matches. A lost race returns false -> 409 "retry".
 *
 * Hidden info: `state` responses always run redactState(state, seatId) so the
 * wire never carries another seat's cards.
 */
import {
  createGameState,
  applyAction,
  applyPlayerAction,
  advanceAuthority,
  redactState,
  buildCreateSetup,
  APP_VERSION,
  PROTOCOL_VERSION,
  type GameState,
  type GameAction,
  type CreateConfigInput,
} from "./engine.js";
import { makeCode, newToken } from "./ids.js";
import type { GameRecord, GameStore, SecretRecord } from "./store.js";

// Version (shown in About via the `version` op) comes from the shared version
// module, so both backends and the frontend always report the same release.
const PROVIDER = "Azure";
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // games expire 14 days after last activity

export type OpResult = { status: number; body: unknown };
const ok = (body: unknown): OpResult => ({ status: 200, body });
const fail = (status: number, error: string): OpResult => ({
  status,
  body: { error },
});

const nowIso = () => new Date().toISOString();
const expiry = () => new Date(Date.now() + TTL_MS).toISOString();

/** Produce the next public record: version+1, refreshed timestamps + expiry. */
function bumped(rec: GameRecord, patch: Partial<GameRecord>): GameRecord {
  const now = nowIso();
  return {
    ...rec,
    ...patch,
    version: rec.version + 1,
    updatedAt: now,
    expiresAt: expiry(),
  };
}

/* ─────────────────────────── create ─────────────────────────── */

export async function handleCreate(
  store: GameStore,
  body: { config?: CreateConfigInput },
): Promise<OpResult> {
  // Shared, pure sanitization — the SAME builder the Supabase Edge Function
  // uses, so seat/option handling can never drift between the two authorities.
  const { players, seats, options } = buildCreateSetup(body.config ?? {});

  const state = createGameState(players, options);
  const code = makeCode();
  const creatorToken = newToken();
  const gameId = crypto.randomUUID();
  const now = nowIso();
  const rec: GameRecord = {
    gameId,
    code,
    status: "lobby",
    version: 0,
    seats,
    createdAt: now,
    updatedAt: now,
    expiresAt: expiry(),
  };
  const secret: SecretRecord = { state, seatTokens: { [creatorToken]: 0 } };
  await store.createGame(rec, secret);
  return ok({ gameId, code, seatIndex: 0, seatToken: creatorToken });
}

/* ──────────────────────────── join ──────────────────────────── */

export async function handleJoin(
  store: GameStore,
  body: { code?: unknown; name?: unknown },
): Promise<OpResult> {
  const code = typeof body.code === "string" ? body.code : "";
  const gameId = await store.getByCode(code);
  if (!gameId) return fail(404, "No game with that code.");
  const game = await store.getGame(gameId);
  const secret = await store.getSecret(gameId);
  if (!game || !secret) return fail(404, "No game with that code.");
  if (game.rec.status !== "lobby") return fail(409, "That game has already started.");

  const seats = game.rec.seats;
  const seat = seats.find((s) => !s.isAI && !s.filled) ?? seats.find((s) => s.isAI);
  if (!seat) return fail(409, "That game is full.");

  const idx = seat.idx;
  const name =
    (typeof body.name === "string" ? body.name.trim().slice(0, 40) : "") || `Player ${idx + 1}`;
  const tookAI = seat.isAI === true;
  seat.isAI = false;
  seat.filled = true;
  seat.name = name;
  seat.avatar = "ranger";
  seat.emoji = null;

  const players = (secret.state as unknown as { players: Record<string, unknown>[] }).players;
  const player = players[idx];
  player.isAI = false;
  player.name = name;
  player.avatarKey = "ranger";
  if (tookAI) {
    delete player.traits;
    player.emoji = null;
    player.image = null;
  }
  const t = newToken();
  const seatTokens = { ...secret.seatTokens, [t]: idx };

  const next = bumped(game.rec, { seats });
  if (
    !(await store.update(gameId, game.etag, next, {
      state: secret.state,
      seatTokens,
    }))
  )
    return fail(409, "The game just changed — please try again.");
  return ok({ gameId, seatIndex: idx, seatToken: t });
}

/* ──────────────────────────── start ─────────────────────────── */

export async function handleStart(
  store: GameStore,
  body: { gameId?: unknown; seatToken?: unknown },
): Promise<OpResult> {
  const gameId = String(body.gameId ?? "");
  const game = await store.getGame(gameId);
  const secret = await store.getSecret(gameId);
  if (!game || !secret) return fail(404, "That game no longer exists.");
  if (secret.seatTokens[String(body.seatToken)] !== 0)
    return fail(403, "Only the host can start the game.");
  if (game.rec.status !== "lobby") return fail(409, "The game has already started.");

  const seats = game.rec.seats;
  const state = secret.state as GameState & { players: { isAI: boolean }[] };
  for (const s of seats) {
    if (!s.isAI && !s.filled) {
      s.isAI = true;
      s.filled = true;
      state.players[s.idx].isAI = true;
    }
  }
  const dealt = advanceAuthority(applyAction(secret.state, { type: "deal" } as GameAction));
  const next = bumped(game.rec, { seats, status: "playing" });
  if (
    !(await store.update(gameId, game.etag, next, {
      state: dealt,
      seatTokens: secret.seatTokens,
    }))
  )
    return fail(409, "The game just changed — please try again.");
  return ok({ ok: true });
}

/* ───────────────────────────── act ──────────────────────────── */

export async function handleAct(
  store: GameStore,
  body: { gameId?: unknown; seatToken?: unknown; action?: unknown },
): Promise<OpResult> {
  const gameId = String(body.gameId ?? "");
  const game = await store.getGame(gameId);
  const secret = await store.getSecret(gameId);
  if (!game || !secret) return fail(404, "That game no longer exists.");
  const idx = secret.seatTokens[String(body.seatToken)];
  if (idx === undefined) return fail(403, "Your seat is no longer valid for this game.");
  if (typeof body.action !== "object" || body.action === null)
    return fail(400, "That move wasn't understood.");

  const seatId = (secret.state as GameState & { players: { id: string }[] }).players[idx].id;
  const next = applyPlayerAction(secret.state, seatId, body.action as GameAction);
  // A no-op (wrong turn / unknown type / out of phase) returns the same reference.
  if (next === secret.state) return ok({ ok: false, reason: "not-applied" });

  const status = next.phase === "gameOver" ? "over" : "playing";
  const rec = bumped(game.rec, { status });
  if (
    !(await store.update(gameId, game.etag, rec, {
      state: next,
      seatTokens: secret.seatTokens,
    }))
  )
    // The word "retry" matters: the client treats an act conflict as recoverable.
    return fail(409, "The game just changed — please retry.");
  return ok({ ok: true });
}

/* ──────────────────────────── state ─────────────────────────── */

export async function handleState(
  store: GameStore,
  body: { gameId?: unknown; seatToken?: unknown },
): Promise<OpResult> {
  const gameId = String(body.gameId ?? "");
  const game = await store.getGame(gameId);
  const secret = await store.getSecret(gameId);
  if (!game || !secret) return fail(404, "That game no longer exists.");
  const tok = body.seatToken;
  const idx = typeof tok === "string" ? secret.seatTokens[tok] : undefined;
  const seatId =
    idx !== undefined
      ? (secret.state as GameState & { players: { id: string }[] }).players[idx].id
      : null;
  return ok({
    status: game.rec.status,
    version: game.rec.version,
    seats: game.rec.seats,
    seatIndex: idx ?? null,
    state: redactState(secret.state, seatId),
  });
}

/* ─────────────────────────── version ────────────────────────── */

export function handleVersion(): OpResult {
  return ok({
    ok: true,
    version: APP_VERSION,
    provider: PROVIDER,
    protocol: PROTOCOL_VERSION,
  });
}
