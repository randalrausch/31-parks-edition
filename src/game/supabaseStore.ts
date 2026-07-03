/**
 * Supabase (Postgres) implementation of the shared GameStore + RateLimiter, so
 * the Edge Function routes through the SAME handlers.ts/router.ts as Azure. A
 * thin adapter over the DB: reads/writes the public `games` row and the secret
 * `game_secrets` row, committing atomically via the `commit_game` RPC (a single
 * transaction that bumps the version iff unchanged AND writes the secret — see
 * supabase/migrations). The rate limiter wraps the `incr_if_below` RPC.
 *
 * Types come from @supabase/supabase-js but are import-only (erased at build);
 * the concrete client is constructed in the Edge Function and passed in, so this
 * module bundles into engine.mjs without pulling the SDK into the bundle.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CodeCollisionError,
  StateTooLargeError,
  type GameRecord,
  type GameStore,
  type SecretRecord,
} from "./store";
import { makeLimiter, type Counter, type RateLimiter } from "./rateLimit";

// Mirrors the Azure Table Storage cap so a game behaves identically on either
// provider (Postgres jsonb has no hard limit, but an unbounded row is a DoS/cost
// vector). A state over this fails with the same 507 the shared router returns.
const MAX_STATE_BYTES = 60_000;
// Games are reaped 14 days after their last write — matches the Azure TTL.
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

function guardSize(state: unknown): void {
  const size = JSON.stringify(state).length;
  if (size > MAX_STATE_BYTES) throw new StateTooLargeError(size);
}

/** Map a public `games` row (snake_case) to the shared GameRecord (camelCase). */
function toRecord(row: {
  id: string;
  code: string;
  status: string;
  version: number;
  seats: GameRecord["seats"];
  updated_at: string;
  created_at: string;
}): GameRecord {
  return {
    gameId: row.id,
    code: row.code,
    status: row.status,
    version: row.version,
    seats: row.seats,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Supabase reaps by updated_at (see deleteExpired), so expiresAt is derived
    // for interface parity and never used as the source of truth here.
    expiresAt: new Date(new Date(row.updated_at).getTime() + TTL_MS).toISOString(),
  };
}

export function makeSupabaseStore(admin: SupabaseClient): GameStore {
  return {
    async createGame(rec, secret) {
      guardSize(secret.state);
      // create_game inserts the public row and the secret row in ONE
      // transaction (no orphan-row window) and returns false on a code/id
      // collision so the caller can retry with a fresh code — mirroring the
      // Azure store's collision-safe create.
      const { data, error } = await admin.rpc("create_game", {
        p_id: rec.gameId,
        p_code: rec.code,
        p_status: rec.status,
        p_seats: rec.seats,
        p_state: secret.state,
        p_seat_tokens: secret.seatTokens,
      });
      if (error) throw new Error(`createGame(create_game): ${error.message}`);
      if (data === false) throw new CodeCollisionError(rec.code);
    },

    // Reads MUST distinguish "row absent" from "DB error". With maybeSingle(),
    // a missing row is { data: null, error: null }; a transient failure is
    // { data: null, error }. Swallowing the error and returning null would make
    // a blip look like a permanent 404 — the handler then tells the player the
    // game no longer exists (they may leave and lose their seat token), and the
    // health probe reports 200 while the DB is unreachable. So rethrow on error
    // and let the router surface a 500 the client treats as "reconnecting".
    async getByCode(code) {
      const { data, error } = await admin
        .from("games")
        .select("id")
        .eq("code", code.toUpperCase())
        .maybeSingle();
      if (error) throw new Error(`getByCode: ${error.message}`);
      return (data?.id as string | undefined) ?? null;
    },

    async getGame(gameId) {
      const { data, error } = await admin.from("games").select("*").eq("id", gameId).maybeSingle();
      if (error) throw new Error(`getGame: ${error.message}`);
      if (!data) return null;
      const rec = toRecord(data);
      // The client-visible version doubles as the optimistic-concurrency token.
      return { rec, etag: String(rec.version) };
    },

    async getSecret(gameId) {
      const { data, error } = await admin
        .from("game_secrets")
        .select("*")
        .eq("game_id", gameId)
        .maybeSingle();
      if (error) throw new Error(`getSecret: ${error.message}`);
      if (!data) return null;
      return {
        state: data.state as SecretRecord["state"],
        seatTokens: data.seat_tokens as Record<string, number>,
      };
    },

    async update(gameId, etag, rec, secret) {
      guardSize(secret.state);
      // commit_game bumps games.version iff it still equals p_expected_version
      // AND writes the secret, in ONE transaction. It returns the new version,
      // or -1 on a version conflict (the caller then reports a 409 "retry").
      const { data, error } = await admin.rpc("commit_game", {
        p_id: gameId,
        p_expected_version: Number(etag),
        p_status: rec.status,
        p_seats: rec.seats,
        p_state: secret.state,
        p_seat_tokens: secret.seatTokens,
      });
      if (error) throw new Error(`update(commit_game): ${error.message}`);
      return typeof data === "number" && data >= 0;
    },

    async deleteExpired(nowIso) {
      const cutoff = new Date(new Date(nowIso).getTime() - TTL_MS).toISOString();
      const { data, error } = await admin
        .from("games")
        .delete()
        .lt("updated_at", cutoff)
        .select("id");
      if (error) throw new Error(`deleteExpired: ${error.message}`);
      return data?.length ?? 0;
    },
  };
}

/**
 * Durable, cross-instance rate limiter backed by the `incr_if_below` Postgres
 * RPC (atomic increment-iff-below-limit). Fail-open on any DB error — a transient
 * hiccup must never lock players out; the global games/day ceiling still bounds
 * cost. Limits are passed in (read from the Edge Function's env).
 */
export function makeSupabaseRateLimiter(
  admin: SupabaseClient,
  maxPerDay: number,
  maxPerIpHour: number,
): RateLimiter {
  const counter: Counter = {
    async incrIfBelow(pk, rk, limit) {
      try {
        const { data, error } = await admin.rpc("incr_if_below", {
          p_bucket: pk,
          p_window: rk,
          p_limit: limit,
        });
        if (error) return true; // fail open
        return data === true;
      } catch {
        return true; // fail open
      }
    },
  };
  return makeLimiter(counter, maxPerDay, maxPerIpHour);
}
