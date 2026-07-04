/**
 * Real-Postgres contract + RLS/grant enforcement for the Supabase backend.
 *
 * The other Supabase suite (supabaseStore.test.ts) runs the shared store
 * contract against an in-memory fake of supabase-js — fast, no database, but it
 * can't catch a mistake in the actual SQL (a broken `commit_game` CAS, a missing
 * revoke, an RLS policy that leaks). This suite closes that gap by pointing the
 * SAME `runStoreContract` at a REAL local Supabase stack (`supabase start`), then
 * adds the assertions only a live database can make:
 *
 *   1. anon CANNOT EXECUTE the SECURITY DEFINER RPCs (create_game / commit_game /
 *      incr_if_below) — the schema.grants.test.ts static check, now enforced live.
 *   2. anon CANNOT read game_secrets or the join code (game_codes) — the two
 *      RLS-denied tables — while it CAN still read the public `games` lobby row
 *      (a positive control so the RLS assertions can't pass vacuously).
 *
 * Gating (mirrors api/…/tableStore.test.ts): with the env unset the whole suite
 * SKIPS, so plain `npm test` stays green with no Docker. In CI the supabase-contract
 * job sets SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY from
 * `supabase status`; there an unreachable stack FAILS loudly rather than skipping,
 * so a migration that breaks the CAS or a dropped revoke can't merge behind a
 * green build.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { makeSupabaseStore } from "./supabaseStore";
import { runStoreContract } from "./storeContract";
import { createGameState } from "./actions";
import { DEFAULT_OPTIONS } from "./engine";
import type { GameRecord, SecretRecord } from "./store";

// Read the CI-exported connection details at runtime. The app tsconfig has no
// node types, so reach process.env through a typed globalThis cast rather than
// the `process` global (vitest runs on node, so it's there at runtime).
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.SUPABASE_ANON_KEY;
const configured = Boolean(URL && SERVICE_KEY && ANON_KEY);
// CI sets this so a silently-skipped suite (e.g. a broken env export) FAILS the
// build instead of passing vacuously. Unset locally → a plain skip is fine.
const required = env.SUPABASE_PG_REQUIRED === "1";

if (!configured) {
  console.warn(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY unset — " +
      "skipping the real-Postgres Supabase suite (run `supabase start` and export them).",
  );
}

// Always-run guard (never skipped): in CI the stack is REQUIRED, so if the
// connection env didn't make it through, fail loudly here rather than let the
// skipIf'd suite below pass green having run nothing.
describe("real-Postgres suite wiring", () => {
  it("is not silently skipped when the CI stack is required", () => {
    if (required && !configured) {
      throw new Error(
        "SUPABASE_PG_REQUIRED is set but SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY are missing — " +
          "the real-Postgres suite would skip and pass vacuously. Check the CI env export.",
      );
    }
    expect(true).toBe(true);
  });
});

// A service-role client bypasses RLS (this is what the Edge Function holds); an
// anon client carries only the public key an untrusted browser would have.
const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = (): SupabaseClient => createClient(URL!, SERVICE_KEY!, noPersist);
const anon = (): SupabaseClient => createClient(URL!, ANON_KEY!, noPersist);

function fixtures(): { rec: GameRecord; secret: SecretRecord } {
  const gameId = crypto.randomUUID();
  const code = gameId
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 6)
    .toUpperCase()
    .padEnd(6, "A");
  const state = createGameState(
    [
      { id: "p0", name: "Host", isAI: false, avatarKey: "ranger" },
      { id: "p1", name: "Bot", isAI: true, avatarKey: "ranger" },
    ],
    DEFAULT_OPTIONS,
  );
  const now = "2026-06-28T00:00:00.000Z";
  const rec: GameRecord = {
    gameId,
    code,
    status: "lobby",
    version: 0,
    seats: [{ idx: 0, name: "Host", avatar: "ranger", isAI: false, filled: true }],
    createdAt: now,
    updatedAt: now,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const secret: SecretRecord = { state, seatTokens: { "tok-host": 0 } };
  return { rec, secret };
}

describe.skipIf(!configured)("SupabaseGameStore — real Postgres (supabase start)", () => {
  beforeAll(async () => {
    // Honesty gate: the env is configured (CI), so the stack MUST be reachable.
    // A network/boot failure here fails the suite instead of silently passing —
    // otherwise the live CAS/RLS guarantees could rot behind a green build.
    const { error } = await admin().from("games").select("id").limit(1);
    if (error) {
      throw new Error(
        `SUPABASE_URL is set but the database is unreachable (${error.message}). ` +
          "The real-Postgres contract must run when configured (CI). Start the stack " +
          "(`supabase start && supabase db reset`) or unset SUPABASE_URL for a plain unit run.",
      );
    }
  });

  // The exact same behavioral contract MemoryGameStore, TableGameStore-on-Azurite,
  // and the supabase-js fake are held to — now against real Postgres RPCs, so a
  // migration edit to create_game / commit_game that breaks atomicity or the CAS
  // fails right here.
  describe("shared store contract", () => {
    runStoreContract(() => makeSupabaseStore(admin()));
  });

  describe("RLS + grants (anon is the untrusted browser)", () => {
    it("lets anon read the public games lobby row but NOT the secrets or join code", async () => {
      // Seed one game with the service role (the Edge Function's privilege).
      const { rec, secret } = fixtures();
      await makeSupabaseStore(admin()).createGame(rec, secret);
      const a = anon();

      // Positive control: anon CAN read the lobby row (Realtime needs SELECT).
      const games = await a.from("games").select("id").eq("id", rec.gameId);
      expect(games.error).toBeNull();
      expect(games.data).toHaveLength(1);

      // RLS: game_secrets has no anon policy → anon sees zero rows (no card data).
      const secrets = await a.from("game_secrets").select("game_id").eq("game_id", rec.gameId);
      expect(secrets.error).toBeNull();
      expect(secrets.data).toEqual([]);

      // RLS: the join code lives in the unpublished, anon-denied game_codes table.
      const codes = await a.from("game_codes").select("code").eq("game_id", rec.gameId);
      expect(codes.error).toBeNull();
      expect(codes.data).toEqual([]);
    });

    it("forbids anon from EXECUTE-ing the SECURITY DEFINER RPCs", async () => {
      const a = anon();
      const { rec, secret } = fixtures();

      // create_game: a successful call would forge authoritative state. Revoked
      // from anon → PostgREST reports an error and NO game is created.
      const created = await a.rpc("create_game", {
        p_id: rec.gameId,
        p_code: rec.code,
        p_status: rec.status,
        p_seats: rec.seats,
        p_state: secret.state,
        p_seat_tokens: secret.seatTokens,
      });
      expect(created.error, "anon must not be able to call create_game").not.toBeNull();
      // Prove the forbidden call had no effect: the id never landed in `games`.
      const leaked = await admin().from("games").select("id").eq("id", rec.gameId);
      expect(leaked.data).toEqual([]);

      // commit_game: forging a state write / version bump.
      const committed = await a.rpc("commit_game", {
        p_id: rec.gameId,
        p_expected_version: 0,
        p_status: "playing",
      });
      expect(committed.error, "anon must not be able to call commit_game").not.toBeNull();

      // incr_if_below: poisoning the durable rate counter to deny create globally.
      const incremented = await a.rpc("incr_if_below", {
        p_bucket: "anon-probe",
        p_window: "2026-06-28",
        p_limit: 1,
      });
      expect(incremented.error, "anon must not be able to call incr_if_below").not.toBeNull();
    });
  });
});
