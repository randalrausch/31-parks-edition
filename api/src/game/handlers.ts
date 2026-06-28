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
  type GameState,
  type GameAction,
  type NewGamePlayer,
} from "./engine.js";
import { makeCode, newToken } from "./ids.js";
import type { GameRecord, GameStore, SeatInfo, SecretRecord } from "./store.js";

/** Bump with releases; surfaced by the in-app About dialog via the `version` op. */
export const FN_VERSION = "0.2.0";
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

interface CreateConfig {
  creatorName?: unknown;
  humans?: unknown;
  ai?: {
    name?: unknown;
    avatarKey?: unknown;
    traits?: unknown;
    emoji?: unknown;
    image?: unknown;
  }[];
  options?: unknown;
}

const TRAIT_KEYS = [
  "bluff",
  "memory",
  "patience",
  "aggression",
  "risk",
] as const;
const BOOL_OPTS = ["threeOfAKind", "grace", "knockPenalty", "sound"] as const;

const clampName = (s: unknown, fallback: string) =>
  (typeof s === "string" ? s.trim().slice(0, 40) : "") || fallback;
const clampKey = (s: unknown, fallback: string) =>
  typeof s === "string" && /^[a-z0-9-]{1,32}$/.test(s) ? s : fallback;
const clampImage = (s: unknown) =>
  typeof s === "string" && s.length <= 512 ? s : undefined;
const clampTraits = (t: unknown) => {
  if (!t || typeof t !== "object") return undefined;
  const src = t as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of TRAIT_KEYS) {
    const v = Number(src[k]);
    out[k] = Number.isFinite(v) ? Math.max(1, Math.min(5, Math.round(v))) : 3;
  }
  return out;
};
const sanitizeOptions = (o: unknown) => {
  const src = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const k of BOOL_OPTS) out[k] = src[k] === true;
  return out as {
    threeOfAKind: boolean;
    grace: boolean;
    knockPenalty: boolean;
    sound: boolean;
  };
};

export async function handleCreate(
  store: GameStore,
  body: { config?: CreateConfig },
): Promise<OpResult> {
  const config = body.config ?? {};
  const humans = Math.max(1, Math.min(8, Number(config.humans) | 0));
  const ai = (Array.isArray(config.ai) ? config.ai : []).slice(
    0,
    Math.max(0, 8 - humans),
  );

  const players: NewGamePlayer[] = [];
  const seats: SeatInfo[] = [];
  for (let i = 0; i < humans; i++) {
    const isCreator = i === 0;
    const name = isCreator
      ? clampName(config.creatorName, "Player 1")
      : `Player ${i + 1}`;
    players.push({ id: `p${i}`, name, isAI: false, avatarKey: "ranger" });
    seats.push({
      idx: i,
      name: isCreator ? name : null,
      avatar: "ranger",
      isAI: false,
      filled: isCreator,
    });
  }
  ai.forEach((c, j) => {
    const idx = humans + j;
    const aiName = clampName(c.name, `Bot ${j + 1}`);
    const avatar = clampKey(c.avatarKey, "ranger");
    const emoji = typeof c.emoji === "string" ? c.emoji.slice(0, 8) : undefined;
    players.push({
      id: `p${idx}`,
      name: aiName,
      isAI: true,
      avatarKey: avatar,
      traits: clampTraits(c.traits),
      emoji,
      image: clampImage(c.image),
    } as NewGamePlayer);
    seats.push({ idx, name: aiName, avatar, emoji, isAI: true, filled: true });
  });

  const state = createGameState(players, sanitizeOptions(config.options));
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
  if (game.rec.status !== "lobby")
    return fail(409, "That game has already started.");

  const seats = game.rec.seats;
  let seat =
    seats.find((s) => !s.isAI && !s.filled) ?? seats.find((s) => s.isAI);
  if (!seat) return fail(409, "That game is full.");

  const idx = seat.idx;
  const name =
    (typeof body.name === "string" ? body.name.trim().slice(0, 40) : "") ||
    `Player ${idx + 1}`;
  const tookAI = seat.isAI === true;
  seat.isAI = false;
  seat.filled = true;
  seat.name = name;
  seat.avatar = "ranger";
  seat.emoji = null;

  const players = (
    secret.state as unknown as { players: Record<string, unknown>[] }
  ).players;
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
  if (game.rec.status !== "lobby")
    return fail(409, "The game has already started.");

  const seats = game.rec.seats;
  const state = secret.state as GameState & { players: { isAI: boolean }[] };
  for (const s of seats) {
    if (!s.isAI && !s.filled) {
      s.isAI = true;
      s.filled = true;
      state.players[s.idx].isAI = true;
    }
  }
  const dealt = advanceAuthority(
    applyAction(secret.state, { type: "deal" } as GameAction),
  );
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
  if (idx === undefined)
    return fail(403, "Your seat is no longer valid for this game.");
  if (typeof body.action !== "object" || body.action === null)
    return fail(400, "That move wasn't understood.");

  const seatId = (secret.state as GameState & { players: { id: string }[] })
    .players[idx].id;
  const next = applyPlayerAction(
    secret.state,
    seatId,
    body.action as GameAction,
  );
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
      ? (secret.state as GameState & { players: { id: string }[] }).players[idx]
          .id
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
  return ok({ ok: true, version: FN_VERSION, provider: PROVIDER });
}
