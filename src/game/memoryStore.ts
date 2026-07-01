/**
 * In-memory GameStore for unit tests. Deterministic, no emulator required.
 * Models the same atomic compare-and-set semantics as the Table Storage impl:
 * a monotonic integer ETag per game; update() succeeds only if the caller's ETag
 * is current. Deep-clones on read/write so callers can't mutate stored state.
 */
import type { GameRecord, GameStore, SecretRecord } from "./store";

interface Entry {
  rec: GameRecord;
  secret: SecretRecord;
  etag: number;
}

const clone = <T>(v: T): T => structuredClone(v);

export function makeMemoryStore(): GameStore {
  const games = new Map<string, Entry>();
  const codes = new Map<string, string>(); // CODE -> gameId

  return {
    async createGame(rec, secret) {
      codes.set(rec.code.toUpperCase(), rec.gameId);
      games.set(rec.gameId, {
        rec: clone(rec),
        secret: clone(secret),
        etag: 1,
      });
    },

    async getByCode(code) {
      return codes.get(code.toUpperCase()) ?? null;
    },

    async getGame(gameId) {
      const e = games.get(gameId);
      return e ? { rec: clone(e.rec), etag: String(e.etag) } : null;
    },

    async getSecret(gameId) {
      const e = games.get(gameId);
      return e ? clone(e.secret) : null;
    },

    async update(gameId, etag, rec, secret) {
      const e = games.get(gameId);
      if (!e || String(e.etag) !== etag) return false;
      e.rec = clone(rec);
      e.secret = clone(secret);
      e.etag += 1;
      return true;
    },

    async deleteExpired(nowIso) {
      let n = 0;
      for (const [gameId, e] of games) {
        if (e.rec.expiresAt <= nowIso) {
          games.delete(gameId);
          codes.delete(e.rec.code.toUpperCase());
          n += 1;
        }
      }
      return n;
    },
  };
}
