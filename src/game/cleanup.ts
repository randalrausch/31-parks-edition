/**
 * Abandoned-game reaper. A daily timer trigger (registered in index.ts) calls
 * this; it deletes every game whose expiresAt has passed so a free-tier Storage
 * account never grows unbounded. Pure and testable (no Azure types here).
 */
import type { GameStore } from "./store";

export async function sweep(store: GameStore, nowIso: string): Promise<number> {
  return store.deleteExpired(nowIso);
}
