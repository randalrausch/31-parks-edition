/**
 * Azure Table Storage implementation of GameStore.
 *
 * Atomicity: the public "game" row and the secret "secret" row share one
 * PartitionKey (gameId), so they are written together in a single
 * `submitTransaction` batch. The game row carries the ETag gate; a concurrent
 * writer that lost the race triggers a 412, which we surface as `update() ===
 * false` (caller -> 409 retry). The two rows can never half-commit.
 *
 * Auth: managed identity (DefaultAzureCredential) against STORAGE_ACCOUNT in the
 * cloud; a connection string (Azurite) locally and in tests. No data secrets.
 */
import {
  TableClient,
  TableServiceClient,
  odata,
  RestError,
  type TableEntity,
} from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import {
  StateTooLargeError,
  type GameRecord,
  type GameStore,
  type SeatInfo,
  type SecretRecord,
} from "../../../src/game/store";
import type { GameState } from "../../../src/game/engine";

const MAX_STATE_BYTES = 60_000; // Table Storage string property cap is 64 KB.

function connString(): string | undefined {
  const c = process.env.TABLES_CONNECTION || process.env.AzureWebJobsStorage;
  return c && (c.includes("AccountKey") || c.includes("UseDevelopmentStorage")) ? c : undefined;
}

export function tableClient(table: string): TableClient {
  const conn = connString();
  if (conn) {
    return TableClient.fromConnectionString(conn, table, {
      allowInsecureConnection: true,
    });
  }
  const account = process.env.STORAGE_ACCOUNT;
  if (!account) {
    throw new Error("Set STORAGE_ACCOUNT (managed identity) or TABLES_CONNECTION (Azurite).");
  }
  return new TableClient(
    `https://${account}.table.core.windows.net`,
    table,
    new DefaultAzureCredential(),
  );
}

type GameRow = TableEntity & {
  code: string;
  status: string;
  version: number;
  seats: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};
type SecretRow = TableEntity & { state: string; seatTokens: string };
type CodeRow = TableEntity & { gameId: string };

const toGameRow = (r: GameRecord): GameRow => ({
  partitionKey: r.gameId,
  rowKey: "game",
  code: r.code,
  status: r.status,
  version: r.version,
  seats: JSON.stringify(r.seats),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  expiresAt: r.expiresAt,
});

const fromGameRow = (e: GameRow): GameRecord => ({
  gameId: e.partitionKey,
  code: e.code,
  status: e.status,
  version: e.version,
  seats: JSON.parse(e.seats) as SeatInfo[],
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
  expiresAt: e.expiresAt,
});

function toSecretRow(gameId: string, s: SecretRecord): SecretRow {
  const state = JSON.stringify(s.state);
  if (state.length > MAX_STATE_BYTES) throw new StateTooLargeError(state.length);
  return {
    partitionKey: gameId,
    rowKey: "secret",
    state,
    seatTokens: JSON.stringify(s.seatTokens),
  };
}

const is = (e: unknown, code: number) => e instanceof RestError && e.statusCode === code;

export function makeTableStore(): GameStore {
  const games = tableClient("Games");
  const codes = tableClient("GameCodes");

  // Ensure tables exist (idempotent). Kicked off once; awaited lazily per call.
  const ready = (async () => {
    const conn = connString();
    const svc = conn
      ? TableServiceClient.fromConnectionString(conn, {
          allowInsecureConnection: true,
        })
      : new TableServiceClient(
          `https://${process.env.STORAGE_ACCOUNT}.table.core.windows.net`,
          new DefaultAzureCredential(),
        );
    for (const t of ["Games", "GameCodes"]) {
      try {
        await svc.createTable(t);
      } catch (e) {
        if (!is(e, 409)) throw e; // 409 = already exists
      }
    }
  })();

  return {
    async createGame(rec, secret) {
      await ready;
      await codes.upsertEntity<CodeRow>(
        {
          partitionKey: rec.code.toUpperCase(),
          rowKey: rec.code.toUpperCase(),
          gameId: rec.gameId,
        },
        "Replace",
      );
      await games.submitTransaction([
        ["create", toGameRow(rec)],
        ["create", toSecretRow(rec.gameId, secret)],
      ]);
    },

    async getByCode(code) {
      await ready;
      const key = code.toUpperCase();
      try {
        const e = await codes.getEntity<CodeRow>(key, key);
        return e.gameId;
      } catch (e) {
        if (is(e, 404)) return null;
        throw e;
      }
    },

    async getGame(gameId) {
      await ready;
      try {
        const e = await games.getEntity<GameRow>(gameId, "game");
        return { rec: fromGameRow(e), etag: e.etag };
      } catch (e) {
        if (is(e, 404)) return null;
        throw e;
      }
    },

    async getSecret(gameId) {
      await ready;
      try {
        const e = await games.getEntity<SecretRow>(gameId, "secret");
        return {
          state: JSON.parse(e.state) as GameState,
          seatTokens: JSON.parse(e.seatTokens) as Record<string, number>,
        };
      } catch (e) {
        if (is(e, 404)) return null;
        throw e;
      }
    },

    async update(gameId, etag, rec, secret) {
      await ready;
      try {
        await games.submitTransaction([
          ["update", { ...toGameRow(rec) }, "Replace", { etag }],
          ["upsert", toSecretRow(gameId, secret), "Replace"],
        ]);
        return true;
      } catch (e) {
        if (is(e, 412)) return false; // ETag mismatch — lost the CAS race
        throw e;
      }
    },

    async deleteExpired(nowIso) {
      await ready;
      let n = 0;
      const expired = games.listEntities<GameRow>({
        queryOptions: {
          filter: odata`RowKey eq 'game' and expiresAt le ${nowIso}`,
        },
      });
      for await (const g of expired) {
        const gameId = g.partitionKey;
        try {
          await games.submitTransaction([
            ["delete", { partitionKey: gameId, rowKey: "game" }],
            ["delete", { partitionKey: gameId, rowKey: "secret" }],
          ]);
        } catch (e) {
          if (!is(e, 404)) throw e;
        }
        const code = g.code?.toUpperCase();
        if (code) {
          try {
            await codes.deleteEntity(code, code);
          } catch (e) {
            if (!is(e, 404)) throw e;
          }
        }
        n += 1;
      }
      return n;
    },
  };
}
