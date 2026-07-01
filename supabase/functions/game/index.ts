/**
 * 31 · National Parks Edition — game Edge Function (the authority).
 *
 * The ONLY component that reads/writes authoritative game state. Clients call it
 * with a secret per-seat token; it validates, runs the shared pure rules, and
 * persists. Hidden info is enforced here via redactState — the wire never
 * carries another player's cards.
 *
 * Ops (POST JSON { op, ... }):
 *   create { config }                     → { gameId, code, seatIndex, seatToken }
 *   join   { code, name }                 → { gameId, seatIndex, seatToken }
 *   start  { gameId, seatToken }          → { ok }
 *   act    { gameId, seatToken, action }  → { ok }
 *   state  { gameId, seatToken? }         → { status, version, seats, seatIndex, state }
 */
// @ts-expect-error — Deno std import resolved at deploy time
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createGameState,
  applyAction,
  applyPlayerAction,
  advanceAuthority,
  redactState,
  buildCreateSetup,
} from "../_shared/engine.mjs";

// @ts-expect-error — Deno global
const env = (k: string) => Deno.env.get(k);
const admin = createClient(
  env("SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
);

/**
 * CORS origin allow-list, kept in parity with the Azure router. ALLOWED_ORIGIN
 * may be a comma-separated list (the site host plus any custom domains). A
 * single Access-Control-Allow-Origin can name only one origin, so reflect the
 * request's Origin when it's in the list ("Vary: Origin" keeps that cacheable);
 * "*" allows all, and an unlisted origin falls back to the first entry
 * (effectively denied). Defaults to "*" so an unconfigured project still works.
 */
const ALLOWED_ORIGINS = (env("ALLOWED_ORIGIN") ?? "*")
  .split(",")
  .map((o: string) => o.trim())
  .filter(Boolean);
function corsFor(reqOrigin: string | null): Record<string, string> {
  const origin = ALLOWED_ORIGINS.includes("*")
    ? "*"
    : reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin)
      ? reqOrigin
      : (ALLOWED_ORIGINS[0] ?? "*");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

/** Bump with releases (the deployed function's version, shown in About). Kept
 * in step with the Azure backend's FN_VERSION so both providers report the same
 * release. */
const FN_VERSION = "0.2.0";

/**
 * Best-effort, per-instance rate limiting. Edge instances are ephemeral and not
 * shared, so this is only a cheap first line against accidental floods; the
 * durable per-IP/day caps below (a DB counter) are what actually bound cost.
 */
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 5000)
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return false;
  }
  e.n += 1;
  return e.n > max;
}
const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  req.headers.get("cf-connecting-ip") ||
  "unknown";

/**
 * Durable, cross-instance create caps backed by a Postgres counter (the
 * `incr_if_below` RPC), mirroring the Azure Table limiter. Two ceilings: a
 * global games/day hard cap and a per-IP games/hour cap. Fail-open on any DB
 * error — a transient hiccup must never lock players out.
 */
const MAX_GAMES_PER_DAY = Number(env("MAX_GAMES_PER_DAY")) || 500;
const MAX_GAMES_PER_IP_PER_HOUR = Number(env("MAX_GAMES_PER_IP_PER_HOUR")) || 20;
const safeKey = (s: string) => s.replace(/[^A-Za-z0-9.:_-]/g, "_").slice(0, 200);
async function incrIfBelow(
  bucket: string,
  windowKey: string,
  limit: number,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("incr_if_below", {
      p_bucket: bucket,
      p_window: windowKey,
      p_limit: limit,
    });
    if (error) {
      logEvent("ratelimit.error", { message: error.message });
      return true; // fail open
    }
    return data === true;
  } catch (e) {
    logEvent("ratelimit.error", { message: (e as Error).message });
    return true; // fail open
  }
}
async function allowCreate(ip: string): Promise<boolean> {
  const now = new Date().toISOString();
  const day = now.slice(0, 10); // YYYY-MM-DD
  const hour = now.slice(0, 13); // YYYY-MM-DDTHH
  if (!(await incrIfBelow("global", `d:${day}`, MAX_GAMES_PER_DAY)))
    return false;
  return incrIfBelow("ip", `${safeKey(ip)}:${hour}`, MAX_GAMES_PER_IP_PER_HOUR);
}

/**
 * Opportunistically delete abandoned games so the database doesn't fill up on a
 * free tier. Runs on a small fraction of creates (no cron needed); failures are
 * ignored. Cascades to game_secrets via the FK. The 14-day window matches the
 * Azure backend's TTL so an async game "waits patiently" for the same duration
 * on either provider.
 */
async function sweepOldGames(): Promise<void> {
  const cutoff = new Date(
    Date.now() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error } = await admin.from("games").delete().lt("updated_at", cutoff);
  if (error) logEvent("sweep.error", { message: error.message });
  else logEvent("sweep.ok", {});
}

/**
 * Structured application log line. Supabase captures stdout in the function's
 * logs (Dashboard → Edge Functions → game → Logs), so emitting JSON here gives
 * developers a queryable trail of every op, outcome, and error. Never logs seat
 * tokens or card data — only ids, seat indices, action types, and versions.
 */
function logEvent(event: string, data: Record<string, unknown> = {}): void {
  try {
    console.log(
      JSON.stringify({ ts: new Date().toISOString(), event, ...data }),
    );
  } catch {
    console.log(`game ${event}`);
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no I/O/0/1
function makeCode(): string {
  // 32 is a power of two, so (byte % 32) is unbiased. Cryptographic RNG.
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let c = "";
  for (let i = 0; i < 5; i++)
    c += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return c;
}
const token = () => crypto.randomUUID();

async function loadByCode(code: string) {
  const { data } = await admin
    .from("games")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  return data;
}
async function loadById(id: string) {
  const { data: game } = await admin
    .from("games")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!game) return null;
  const { data: secret } = await admin
    .from("game_secrets")
    .select("*")
    .eq("game_id", id)
    .maybeSingle();
  return game && secret ? { game, secret } : null;
}

/**
 * Atomic optimistic-concurrency commit. The `commit_game` RPC runs in a single
 * Postgres transaction: it bumps `games.version` ONLY if it still equals
 * `expectedVersion`, and — in the same transaction — writes the new secret
 * state/tokens. Returns false when another writer moved first (client refetches
 * and retries). This replaces the old two-call casBump()+saveSecret() sequence,
 * which could leave `games` bumped while `game_secrets` stayed stale if the
 * second write failed (a torn write). null patch fields keep their column value.
 */
async function commitGame(
  id: string,
  expectedVersion: number,
  patch: {
    status?: string;
    seats?: unknown;
    state?: unknown;
    seatTokens?: unknown;
  },
): Promise<boolean> {
  const { data, error } = await admin.rpc("commit_game", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_status: patch.status ?? null,
    p_seats: patch.seats ?? null,
    p_state: patch.state ?? null,
    p_seat_tokens: patch.seatTokens ?? null,
  });
  if (error) throw new Error(`commitGame: ${error.message}`);
  // The RPC returns the new version, or -1 on a version conflict.
  return typeof data === "number" && data >= 0;
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  const err = (msg: string, status = 400) => json({ error: msg }, status);
  const fail = (
    event: string,
    message: string,
    status: number,
    data: Record<string, unknown> = {},
  ): Response => {
    logEvent(event, { ...data, status, message });
    return err(message, status);
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return err("POST only", 405);

  // Lightweight health/version probe (used by the in-app About dialog).
  // Cheap and unauthenticated; still rate-limited below.
  const ip = clientIp(req);
  if (rateLimited(ip, 90, 60_000))
    return fail("rate-limited", "Too many requests — please slow down.", 429, {
      ip,
    });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("bad-request", "We couldn't read that request.", 400);
  }
  const op = body.op as string;
  if (op === "version")
    return json({ ok: true, version: FN_VERSION, provider: "Supabase" });
  // state/version are high-volume / trivial; don't log them as requests.
  if (op !== "state" && op !== "version") logEvent("request", { op });

  // Creating games is the costliest op — a cheap per-instance first line, then
  // the durable shared caps (per-IP/hour + global/day) that actually bound cost.
  if (op === "create") {
    if (rateLimited(`create:${ip}`, 15, 600_000))
      return fail(
        "rate-limited",
        "You're creating games too quickly — try again in a few minutes.",
        429,
        { ip },
      );
    if (!(await allowCreate(ip)))
      return fail(
        "rate-limited",
        "Too many games are being created right now — please try again later.",
        429,
        { ip },
      );
  }

  try {
    /* ── create ── */
    if (op === "create") {
      // Shared, pure sanitization — the SAME builder the Azure backend uses, so
      // seat/option handling can never drift between the two authorities.
      const { players, seats, options, humans, aiCount } = buildCreateSetup(
        (body.config ?? {}) as Parameters<typeof buildCreateSetup>[0],
      );

      // Occasionally sweep abandoned games so the DB doesn't grow unbounded.
      if (Math.random() < 0.05) await sweepOldGames();

      const state = createGameState(players, options);
      const code = makeCode();
      const creatorToken = token();
      const { data: game, error } = await admin
        .from("games")
        .insert({ code, status: "lobby", version: 0, seats })
        .select()
        .single();
      if (error) return err(error.message, 500);
      const { error: secretErr } = await admin.from("game_secrets").insert({
        game_id: game.id,
        state,
        seat_tokens: { [creatorToken]: 0 },
      });
      if (secretErr) return err(secretErr.message, 500);
      logEvent("create", {
        gameId: game.id,
        code,
        humans,
        ai: aiCount,
      });
      return json({
        gameId: game.id,
        code,
        seatIndex: 0,
        seatToken: creatorToken,
      });
    }

    /* ── join ── */
    if (op === "join") {
      const game = await loadByCode(body.code as string);
      if (!game) return fail("join.no-game", "No game with that code.", 404);
      if (game.status !== "lobby")
        return fail("join.started", "That game has already started.", 409, {
          gameId: game.id,
        });
      const seats = game.seats as Record<string, unknown>[];
      // Prefer an open human seat; otherwise let the joiner take over an AI seat
      // so "share this code so friends can join" holds while any AI is present.
      let seat = seats.find((s) => !s.isAI && !s.filled);
      if (!seat) seat = seats.find((s) => s.isAI);
      if (!seat)
        return fail("join.full", "That game is full.", 409, {
          gameId: game.id,
        });
      const loaded = await loadById(game.id);
      if (!loaded)
        return fail(
          "join.no-state",
          "Something went wrong opening that game.",
          500,
          { gameId: game.id },
        );
      const idx = seat.idx as number;
      const name =
        (typeof body.name === "string" ? body.name.trim().slice(0, 40) : "") ||
        `Player ${idx + 1}`;
      const tookAI = seat.isAI === true;
      seat.isAI = false;
      seat.filled = true;
      seat.name = name;
      seat.avatar = "ranger";
      seat.emoji = null;
      const state = loaded.secret.state;
      const player = state.players[idx] as Record<string, unknown>;
      player.isAI = false;
      player.name = name;
      player.avatarKey = "ranger";
      if (tookAI) {
        // Strip the AI persona so the seat plays as a human from here on.
        delete player.traits;
        player.emoji = null;
        player.image = null;
      }
      const seatTokens = loaded.secret.seat_tokens;
      const t = token();
      seatTokens[t] = idx;
      // One atomic commit: claim the version AND write the new seats/state/tokens
      // together, so two players can't take the same seat and the two rows can
      // never half-commit.
      if (!(await commitGame(game.id, game.version, { seats, state, seatTokens })))
        return fail(
          "join.conflict",
          "The game just changed — please try again.",
          409,
          { gameId: game.id },
        );
      logEvent("join", { gameId: game.id, seat: idx, tookAI });
      return json({ gameId: game.id, seatIndex: idx, seatToken: t });
    }

    /* ── start ── */
    if (op === "start") {
      const loaded = await loadById(body.gameId as string);
      if (!loaded)
        return fail("start.no-game", "That game no longer exists.", 404);
      const idx = loaded.secret.seat_tokens[body.seatToken as string];
      if (idx !== 0)
        return fail(
          "start.not-host",
          "Only the host can start the game.",
          403,
          { gameId: loaded.game.id },
        );
      if (loaded.game.status !== "lobby")
        return fail("start.already", "The game has already started.", 409, {
          gameId: loaded.game.id,
        });
      const seats = loaded.game.seats as Record<string, unknown>[];
      const state = loaded.secret.state;
      // Any unfilled human seat becomes an AI so the game never stalls.
      for (const s of seats) {
        if (!s.isAI && !s.filled) {
          s.isAI = true;
          s.filled = true;
          state.players[s.idx as number].isAI = true;
        }
      }
      const dealt = advanceAuthority(applyAction(state, { type: "deal" }));
      if (
        !(await commitGame(loaded.game.id, loaded.game.version, {
          seats,
          status: "playing",
          state: dealt,
          seatTokens: loaded.secret.seat_tokens,
        }))
      )
        return fail(
          "start.conflict",
          "The game just changed — please try again.",
          409,
          { gameId: loaded.game.id },
        );
      logEvent("start", { gameId: loaded.game.id, phase: dealt.phase });
      return json({ ok: true });
    }

    /* ── act ── */
    if (op === "act") {
      const loaded = await loadById(body.gameId as string);
      if (!loaded)
        return fail("act.no-game", "That game no longer exists.", 404);
      const idx = loaded.secret.seat_tokens[body.seatToken as string];
      if (idx === undefined)
        return fail(
          "act.bad-token",
          "Your seat is no longer valid for this game.",
          403,
          { gameId: loaded.game.id },
        );
      if (typeof body.action !== "object" || body.action === null)
        return fail("act.bad-action", "That move wasn't understood.", 400, {
          gameId: loaded.game.id,
        });
      const seatId = loaded.secret.state.players[idx].id;
      const actionType = (body.action as { type?: string }).type;
      const next = applyPlayerAction(loaded.secret.state, seatId, body.action);
      // Any no-op (wrong turn, unknown type, or out-of-phase action) comes back
      // as the same state reference. Don't bump the version, rewrite state, or
      // broadcast a Realtime ping for those — just report it wasn't applied.
      if (next === loaded.secret.state) {
        logEvent("act.noop", {
          gameId: loaded.game.id,
          seat: idx,
          action: actionType,
          phase: loaded.secret.state.phase,
          cur: loaded.secret.state.cur,
        });
        return json({ ok: false, reason: "not-applied" });
      }
      // One atomic commit claims the version AND writes the new state; a
      // concurrent/double submit gets a clean 409.
      if (
        !(await commitGame(loaded.game.id, loaded.game.version, {
          status: next.phase === "gameOver" ? "over" : "playing",
          state: next,
        }))
      ) {
        logEvent("act.conflict", {
          gameId: loaded.game.id,
          seat: idx,
          action: actionType,
          version: loaded.game.version,
        });
        // NOTE: message must contain "retry" — the client treats an act
        // conflict as recoverable (silently resyncs) by matching that word.
        return err("The game just changed — please retry.", 409);
      }
      logEvent("act.ok", {
        gameId: loaded.game.id,
        seat: idx,
        action: actionType,
        version: loaded.game.version + 1,
        phase: next.phase,
      });
      return json({ ok: true });
    }

    /* ── state ── */
    if (op === "state") {
      const loaded = await loadById(body.gameId as string);
      if (!loaded)
        return fail("state.no-game", "That game no longer exists.", 404);
      const tok = body.seatToken as string | undefined;
      const idx =
        tok !== undefined ? loaded.secret.seat_tokens[tok] : undefined;
      const seatId =
        idx !== undefined ? loaded.secret.state.players[idx].id : null;
      return json({
        status: loaded.game.status,
        version: loaded.game.version,
        seats: loaded.game.seats,
        seatIndex: idx ?? null,
        state: redactState(loaded.secret.state, seatId),
      });
    }

    return fail("unknown-op", "Unsupported request.", 400, { op });
  } catch (e) {
    // Log the real cause (with stack) server-side; never leak internals to the
    // client — they get a clear, generic message.
    logEvent("error", {
      op,
      message: (e as Error).message,
      stack: (e as Error).stack,
    });
    return err("Something went wrong on our end. Please try again.", 500);
  }
});
