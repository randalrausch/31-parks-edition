/**
 * Single entry point bundled for the Supabase Edge Function (Deno). Re-exports
 * the pure, tested game logic so the server runs the exact same rules as the
 * client — no duplication, no drift. Build with `npm run build:edge`, which
 * bundles this into supabase/functions/_shared/engine.mjs.
 */
export { createGameState, applyAction } from "./actions";
export type { GameAction, NewGamePlayer } from "./actions";
export { applyPlayerAction, advanceAuthority, redactState } from "./authority";
export { APP_VERSION, PROTOCOL_VERSION } from "./version";
export type { GameState, GameOptions } from "./engine";
export {
  buildCreateSetup,
  sanitizeOptions,
  clampName,
  clampKey,
} from "./config";
export type {
  CreateConfigInput,
  CreateSetup,
  SeatSetup,
} from "./config";
