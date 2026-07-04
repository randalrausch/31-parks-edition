/**
 * Unit tests for the Supabase GameStore adapter against a small in-memory fake
 * of the supabase-js client. The fake models the `commit_game` version CAS and
 * `incr_if_below` counter so these assert the adapter's mapping (snake<->camel),
 * the 409-conflict contract (commit_game returns -1), and the size guard —
 * without a real database.
 */
import { describe, it, expect } from "vitest";
import { makeSupabaseStore, makeSupabaseRateLimiter } from "./supabaseStore";
import { StateTooLargeError, type GameRecord, type SecretRecord } from "./store";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

/** Minimal chainable stand-in for the subset of supabase-js the adapter uses. */
function makeFake() {
  const games = new Map<string, Row>();
  const secrets = new Map<string, Row>();
  const counters = new Map<string, number>();
  // When set, every SELECT resolves to { data: null, error } — models a
  // transient DB failure so we can assert reads rethrow instead of null-ing.
  const control = { readError: null as string | null };

  class Builder {
    private mode: "select" | "insert" | "delete" = "select";
    private payload: Row | null = null;
    private filters: [string, string, unknown][] = [];
    constructor(
      private table: string,
      private ctl: { readError: string | null },
    ) {}
    insert(v: Row) {
      this.mode = "insert";
      this.payload = v;
      return this;
    }
    delete() {
      this.mode = "delete";
      return this;
    }
    select(cols?: string) {
      void cols; // column list is irrelevant to the fake
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push(["eq", col, val]);
      return this;
    }
    lt(col: string, val: unknown) {
      this.filters.push(["lt", col, val]);
      return this;
    }
    private map() {
      return this.table === "games" ? games : secrets;
    }
    private match(): Row[] {
      return [...this.map().values()].filter((r) =>
        this.filters.every(([op, col, val]) =>
          op === "eq" ? r[col] === val : String(r[col]) < String(val),
        ),
      );
    }
    private run(single: boolean) {
      if (this.mode === "insert") {
        const key = this.table === "games" ? "id" : "game_id";
        const row = { ...this.payload } as Row;
        // Postgres defaults these; the games mapping (toRecord) reads them.
        if (this.table === "games") {
          row.created_at ??= "2026-06-28T00:00:00.000Z";
          row.updated_at ??= "2026-06-28T00:00:00.000Z";
        }
        this.map().set(row[key] as string, row);
        return { data: null, error: null };
      }
      if (this.mode === "delete") {
        const hit = this.match();
        for (const r of hit) this.map().delete((r.id ?? r.game_id) as string);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (this.ctl.readError) return { data: null, error: { message: this.ctl.readError } };
      const hit = this.match();
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    }
    maybeSingle() {
      return Promise.resolve(this.run(true));
    }
    single() {
      return Promise.resolve(this.run(true));
    }
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(this.run(false)).then(res, rej);
    }
  }

  const client = {
    from: (table: string) => new Builder(table, control),
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "create_game") {
        const id = args.p_id as string;
        const code = args.p_code as string;
        // unique_violation on either the id or the code → false (caller retries).
        const codeTaken = [...games.values()].some((g) => g.code === code);
        if (games.has(id) || codeTaken) return Promise.resolve({ data: false, error: null });
        games.set(id, {
          id,
          code,
          status: args.p_status,
          version: 0,
          seats: args.p_seats,
          created_at: "2026-06-28T00:00:00.000Z",
          updated_at: "2026-06-28T00:00:00.000Z",
        });
        secrets.set(id, { game_id: id, state: args.p_state, seat_tokens: args.p_seat_tokens });
        return Promise.resolve({ data: true, error: null });
      }
      if (fn === "commit_game") {
        const g = games.get(args.p_id as string);
        if (!g || g.version !== args.p_expected_version)
          return Promise.resolve({ data: -1, error: null });
        g.version = (args.p_expected_version as number) + 1;
        if (args.p_status != null) g.status = args.p_status;
        if (args.p_seats != null) g.seats = args.p_seats;
        const s = secrets.get(args.p_id as string);
        if (s) {
          if (args.p_state != null) s.state = args.p_state;
          if (args.p_seat_tokens != null) s.seat_tokens = args.p_seat_tokens;
        }
        return Promise.resolve({ data: g.version, error: null });
      }
      if (fn === "incr_if_below") {
        const key = `${args.p_bucket}|${args.p_window}`;
        const n = counters.get(key) ?? 0;
        if (n >= (args.p_limit as number)) return Promise.resolve({ data: false, error: null });
        counters.set(key, n + 1);
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } });
    },
  };
  return { client: client as unknown as SupabaseClient, games, secrets, control };
}

function fixtures(): { rec: GameRecord; secret: SecretRecord } {
  const rec: GameRecord = {
    gameId: "g1",
    code: "ABCDE",
    status: "lobby",
    version: 0,
    seats: [{ idx: 0, name: "Host", avatar: "ranger", isAI: false, filled: true }],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    expiresAt: "2026-07-12T00:00:00.000Z",
  };
  const secret: SecretRecord = {
    state: { anything: true } as unknown as SecretRecord["state"],
    seatTokens: { "tok-host": 0 },
  };
  return { rec, secret };
}

describe("SupabaseGameStore", () => {
  it("creates a game and reads it back with camelCase mapping + version etag", async () => {
    const { client } = makeFake();
    const store = makeSupabaseStore(client);
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);

    expect(await store.getByCode("abcde")).toBe("g1"); // case-insensitive
    const got = await store.getGame("g1");
    expect(got?.rec.gameId).toBe("g1");
    expect(got?.rec.code).toBe("ABCDE");
    expect(got?.etag).toBe("0"); // version doubles as the concurrency token

    const sec = await store.getSecret("g1");
    expect(sec?.seatTokens).toEqual({ "tok-host": 0 }); // seat_tokens -> seatTokens
  });

  it("update succeeds with the current etag and bumps the version", async () => {
    const { client } = makeFake();
    const store = makeSupabaseStore(client);
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);

    const ok = await store.update("g1", "0", { ...rec, status: "playing" }, secret);
    expect(ok).toBe(true);
    const after = await store.getGame("g1");
    expect(after?.rec.status).toBe("playing");
    expect(after?.etag).toBe("1");
  });

  it("update with a stale etag loses the CAS (commit_game returns -1 -> false)", async () => {
    const { client } = makeFake();
    const store = makeSupabaseStore(client);
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);
    await store.update("g1", "0", rec, secret); // version -> 1

    expect(await store.update("g1", "0", rec, secret)).toBe(false); // stale expected version
    expect((await store.getGame("g1"))?.etag).toBe("1");
  });

  it("rejects an oversized state with StateTooLargeError (create + update)", async () => {
    const { client } = makeFake();
    const store = makeSupabaseStore(client);
    const { rec, secret } = fixtures();
    const huge: SecretRecord = {
      state: { blob: "x".repeat(70_000) } as unknown as SecretRecord["state"],
      seatTokens: {},
    };
    await expect(store.createGame(rec, huge)).rejects.toBeInstanceOf(StateTooLargeError);
    await store.createGame(rec, secret);
    await expect(store.update("g1", "0", rec, huge)).rejects.toBeInstanceOf(StateTooLargeError);
  });

  it("rethrows on a DB read error instead of masking it as 'not found'", async () => {
    const { client, control } = makeFake();
    const store = makeSupabaseStore(client);
    const { rec, secret } = fixtures();
    await store.createGame(rec, secret);

    control.readError = "connection reset"; // transient DB failure
    await expect(store.getByCode("ABCDE")).rejects.toThrow(/getByCode/);
    await expect(store.getGame("g1")).rejects.toThrow(/getGame/);
    await expect(store.getSecret("g1")).rejects.toThrow(/getSecret/);

    control.readError = null; // recovered → reads work again
    expect(await store.getByCode("ABCDE")).toBe("g1");
  });

  it("returns null (not an error) for a genuinely absent row", async () => {
    const { client } = makeFake();
    const store = makeSupabaseStore(client);
    expect(await store.getByCode("NOPE0")).toBeNull();
    expect(await store.getGame("missing")).toBeNull();
    expect(await store.getSecret("missing")).toBeNull();
  });

  it("rate limiter enforces the global daily ceiling via incr_if_below", async () => {
    const { client } = makeFake();
    const rl = makeSupabaseRateLimiter(client, 2, 100); // 2/day, 100/hr
    const T = "2026-06-28T10:00:00.000Z";
    expect(await rl.allowCreate("1.1.1.1", T)).toBe(true);
    expect(await rl.allowCreate("2.2.2.2", T)).toBe(true);
    expect(await rl.allowCreate("3.3.3.3", T)).toBe(false); // global cap of 2 hit
  });
});
