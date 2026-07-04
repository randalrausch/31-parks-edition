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
import { createGameState, applyAction, seatHumanPlayer, fillSeatsWithAI } from "./actions";
import type { GameAction } from "./actions";
import { applyPlayerAction, advanceAuthority, redactState } from "./authority";
import { buildCreateSetup } from "./config";
import type { CreateConfigInput } from "./config";
import { APP_VERSION, PROTOCOL_VERSION, STATE_VERSION } from "./version";
import type { GameState } from "./engine";
import { makeCode, newToken } from "./ids";
import { CodeCollisionError, type GameRecord, type GameStore, type SecretRecord } from "./store";

const TTL_MS = 14 * 24 * 60 * 60 * 1000; // games expire 14 days after last activity

export type OpResult = { status: number; body: unknown };
const ok = (body: unknown): OpResult => ({ status: 200, body });
const fail = (status: number, error: string): OpResult => ({
  status,
  body: { error },
});

const nowIso = () => new Date().toISOString();
const expiry = () => new Date(Date.now() + TTL_MS).toISOString();

/**
 * Guard a stored state against the current engine's schema version. Returns a
 * distinct, user-meaningful failure when a game was written by an incompatible
 * older build, instead of letting the engine crash the op with a generic 500 and
 * stranding the whole in-flight population behind undifferentiated errors. A
 * state with no stateVersion predates versioning and reads as version 1.
 */
function incompatibleState(state: SecretRecord["state"]): OpResult | null {
  const v = (state as { stateVersion?: number }).stateVersion ?? 1;
  if (v === STATE_VERSION) return null;
  return fail(
    410,
    "This game was started on an older version and can't be continued. Please start a new game.",
  );
}

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

/**
 * Resolve a client-supplied seat token to its seat index, or `undefined` when
 * the token isn't a real seat credential. `seatTokens` is a plain JSON object,
 * so a crafted token like "__proto__", "toString", or "constructor" would
 * otherwise resolve to an inherited Object.prototype member — a value that is
 * neither `undefined` nor a number, letting it slip past a bare
 * `seatTokens[token]` check and then crash on `players[idx]`. Only an OWN,
 * numeric mapping is a valid seat; anything else reads as "no such seat".
 */
function seatIndexFor(seatTokens: Record<string, number>, token: unknown): number | undefined {
  if (typeof token !== "string") return undefined;
  if (!Object.prototype.hasOwnProperty.call(seatTokens, token)) return undefined;
  const idx = seatTokens[token];
  return typeof idx === "number" ? idx : undefined;
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
  const creatorToken = newToken();
  const gameId = crypto.randomUUID();
  const now = nowIso();
  const secret: SecretRecord = { state, seatTokens: { [creatorToken]: 0 } };

  // Generate a fresh code per attempt. A collision is astronomically unlikely at
  // 32^6, but if the code already belongs to another game the store raises
  // CodeCollisionError so we regenerate instead of clobbering a live lobby. The
  // gameId is only ever persisted on the winning attempt, so it's safe to reuse.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
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
    try {
      await store.createGame(rec, secret);
      return ok({ gameId, code, seatIndex: 0, seatToken: creatorToken });
    } catch (e) {
      if (e instanceof CodeCollisionError) continue;
      throw e;
    }
  }
  return fail(503, "Couldn't allocate a unique game code — please try again.");
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
  // Same schema guard as start/act/state: refuse an old-build lobby game with a
  // clear message instead of letting seatHumanPlayer crash the op with a 500.
  const joinIncompat = incompatibleState(secret.state);
  if (joinIncompat) return joinIncompat;
  if (game.rec.status !== "lobby") return fail(409, "That game has already started.");

  const seats = game.rec.seats;
  const seat = seats.find((s) => !s.isAI && !s.filled) ?? seats.find((s) => s.isAI);
  if (!seat) return fail(409, "That game is full.");

  const idx = seat.idx;
  const name =
    (typeof body.name === "string" ? body.name.trim().slice(0, 40) : "") || `Player ${idx + 1}`;
  // Public row seat (lobby display) …
  seat.isAI = false;
  seat.filled = true;
  seat.name = name;
  seat.avatar = "ranger";
  seat.emoji = null;
  // … and the authoritative player, via the engine's pure seat transform (no
  // hand-rolled mutation of the serialized state).
  const nextState = seatHumanPlayer(secret.state, idx, name);
  const t = newToken();
  const seatTokens = { ...secret.seatTokens, [t]: idx };

  const next = bumped(game.rec, { seats });
  if (
    !(await store.update(gameId, game.etag, next, {
      state: nextState,
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
  const startIncompat = incompatibleState(secret.state);
  if (startIncompat) return startIncompat;
  if (seatIndexFor(secret.seatTokens, body.seatToken) !== 0)
    return fail(403, "Only the host can start the game.");
  if (game.rec.status !== "lobby") return fail(409, "The game has already started.");

  const seats = game.rec.seats;
  const aiSeatIdxs: number[] = [];
  for (const s of seats) {
    if (!s.isAI && !s.filled) {
      s.isAI = true; // public row (lobby display)
      s.filled = true;
      aiSeatIdxs.push(s.idx);
    }
  }
  // Fill the unclaimed seats with AI via the engine's pure transform, then deal.
  const withAI = fillSeatsWithAI(secret.state, aiSeatIdxs);
  const dealt = advanceAuthority(applyAction(withAI, { type: "deal" } as GameAction));
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
  const actIncompat = incompatibleState(secret.state);
  if (actIncompat) return actIncompat;
  const idx = seatIndexFor(secret.seatTokens, body.seatToken);
  if (idx === undefined) return fail(403, "Your seat is no longer valid for this game.");
  if (typeof body.action !== "object" || body.action === null)
    return fail(400, "That move wasn't understood.");

  const seatId = (secret.state as GameState & { players: { id: string }[] }).players[idx]!.id;
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
  const stateIncompat = incompatibleState(secret.state);
  if (stateIncompat) return stateIncompat;
  const idx = seatIndexFor(secret.seatTokens, body.seatToken);
  const seatId =
    idx !== undefined
      ? (secret.state as GameState & { players: { id: string }[] }).players[idx]!.id
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

export function handleVersion(provider: string): OpResult {
  return ok({
    ok: true,
    version: APP_VERSION,
    provider,
    protocol: PROTOCOL_VERSION,
  });
}

/* ─────────────────────────── health ─────────────────────────── */

/**
 * Liveness+readiness probe. Unlike `version` (a static literal that says nothing
 * about the datastore), this does a trivial round-trip — a code lookup that
 * touches storage but creates/mutates nothing — so a monitor can tell "backend
 * up AND its database reachable" (200) from "backend up but storage down" (503).
 */
export async function handleHealth(store: GameStore, provider: string): Promise<OpResult> {
  try {
    await store.getByCode("__health__"); // sentinel; returns null, proves reachability
    return ok({ ok: true, healthy: true, provider, protocol: PROTOCOL_VERSION });
  } catch {
    return { status: 503, body: { ok: true, healthy: false, provider } };
  }
}

/* ──────────────────────────── clientError ───────────────────────────── */

/**
 * Off-device sink for client-side errors (render crashes, reconnect failures).
 * The client has nowhere to report crashes on its own — this logs a bounded,
 * structured line to server stdout, which App Insights (Azure) / function logs
 * (Supabase) capture, so operators can see how often players hit an error.
 *
 * Every field is client-controlled and untrusted: each is clamped and ONLY ever
 * logged (never executed, persisted, or reflected), so an anonymous caller can't
 * do more than emit one bounded log line — and it sits behind the per-IP limiter.
 */
export function handleClientError(body: {
  message?: unknown;
  stack?: unknown;
  url?: unknown;
  context?: unknown;
}): OpResult {
  const clamp = (v: unknown, n: number): string | undefined =>
    typeof v === "string" && v.length > 0 ? v.slice(0, n) : undefined;
  const entry = {
    kind: "client-error",
    message: clamp(body.message, 500) ?? "(no message)",
    stack: clamp(body.stack, 4000),
    url: clamp(body.url, 300),
    context: clamp(body.context, 200),
  };
  console.warn(`client-error ${JSON.stringify(entry)}`);
  return ok({ ok: true });
}
