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
} from "../_shared/engine.mjs";

// @ts-expect-error — Deno global
const env = (k: string) => Deno.env.get(k);
const admin = createClient(
  env("SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
const err = (msg: string, status = 400) => json({ error: msg }, status);

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
async function saveSecret(id: string, state: unknown, seatTokens: unknown) {
  await admin
    .from("game_secrets")
    .update({ state, seat_tokens: seatTokens })
    .eq("game_id", id);
}
async function bump(id: string, patch: Record<string, unknown>) {
  await admin
    .from("games")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err("POST only", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON");
  }
  const op = body.op as string;

  try {
    /* ── create ── */
    if (op === "create") {
      const config = body.config as {
        creatorName: string;
        humans: number;
        ai: {
          name: string;
          avatarKey: string;
          traits?: unknown;
          emoji?: string;
          image?: string;
        }[];
        options: unknown;
      };
      const humans = Math.max(1, Math.min(8, config.humans | 0));
      const ai = config.ai ?? [];
      const players: Record<string, unknown>[] = [];
      const seats: Record<string, unknown>[] = [];
      for (let i = 0; i < humans; i++) {
        const isCreator = i === 0;
        const name = isCreator
          ? config.creatorName?.trim() || "Player 1"
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
        players.push({
          id: `p${idx}`,
          name: c.name,
          isAI: true,
          avatarKey: c.avatarKey ?? "ranger",
          traits: c.traits,
          emoji: c.emoji,
          image: c.image,
        });
        seats.push({
          idx,
          name: c.name,
          avatar: c.avatarKey,
          emoji: c.emoji,
          isAI: true,
          filled: true,
        });
      });

      const state = createGameState(players, config.options);
      const code = makeCode();
      const creatorToken = token();
      const { data: game, error } = await admin
        .from("games")
        .insert({ code, status: "lobby", version: 0, seats })
        .select()
        .single();
      if (error) return err(error.message, 500);
      await admin.from("game_secrets").insert({
        game_id: game.id,
        state,
        seat_tokens: { [creatorToken]: 0 },
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
      if (!game) return err("No game with that code", 404);
      if (game.status !== "lobby") return err("Game already started", 409);
      const seats = game.seats as Record<string, unknown>[];
      const seat = seats.find((s) => !s.isAI && !s.filled);
      if (!seat) return err("Game is full", 409);
      const loaded = await loadById(game.id);
      if (!loaded) return err("Game state missing", 500);
      const idx = seat.idx as number;
      const name = ((body.name as string) || `Player ${idx + 1}`).trim();
      seat.name = name;
      seat.filled = true;
      const state = loaded.secret.state;
      state.players[idx].name = name;
      const seatTokens = loaded.secret.seat_tokens;
      const t = token();
      seatTokens[t] = idx;
      await saveSecret(game.id, state, seatTokens);
      await bump(game.id, { seats, version: game.version + 1 });
      return json({ gameId: game.id, seatIndex: idx, seatToken: t });
    }

    /* ── start ── */
    if (op === "start") {
      const loaded = await loadById(body.gameId as string);
      if (!loaded) return err("No such game", 404);
      const idx = loaded.secret.seat_tokens[body.seatToken as string];
      if (idx !== 0) return err("Only the host can start", 403);
      if (loaded.game.status !== "lobby") return err("Already started", 409);
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
      await saveSecret(loaded.game.id, dealt, loaded.secret.seat_tokens);
      await bump(loaded.game.id, {
        seats,
        status: "playing",
        version: loaded.game.version + 1,
      });
      return json({ ok: true });
    }

    /* ── act ── */
    if (op === "act") {
      const loaded = await loadById(body.gameId as string);
      if (!loaded) return err("No such game", 404);
      const idx = loaded.secret.seat_tokens[body.seatToken as string];
      if (idx === undefined) return err("Invalid seat token", 403);
      const seatId = loaded.secret.state.players[idx].id;
      const next = applyPlayerAction(loaded.secret.state, seatId, body.action);
      await saveSecret(loaded.game.id, next, loaded.secret.seat_tokens);
      await bump(loaded.game.id, {
        version: loaded.game.version + 1,
        status: next.phase === "gameOver" ? "over" : "playing",
      });
      return json({ ok: true });
    }

    /* ── state ── */
    if (op === "state") {
      const loaded = await loadById(body.gameId as string);
      if (!loaded) return err("No such game", 404);
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

    return err(`Unknown op: ${op}`);
  } catch (e) {
    return err(`Server error: ${(e as Error).message}`, 500);
  }
});
