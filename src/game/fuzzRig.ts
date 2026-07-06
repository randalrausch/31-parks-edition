/**
 * Shared rig for the fuzz/property tests (actions, multiplayer, redaction).
 * Test-only — imported exclusively from *.test.ts, never by app or server code.
 *
 * Two env knobs let the nightly deep-fuzz workflow
 * (.github/workflows/nightly-fuzz.yml) crank the same suites far past their
 * PR-sized runs, and make any failure reproducible:
 *
 *   FUZZ_SCALE — multiplies each suite's iteration count (default 1; the
 *                nightly runs 50×).
 *   FUZZ_SEED  — seeds every PRNG stream (default 1, so PR/local runs are
 *                DETERMINISTIC — a fuzz test can never flake an unrelated PR;
 *                the nightly passes a fresh seed per run to explore new games).
 *
 * To reproduce a nightly failure locally, take the values from the run log:
 *   FUZZ_SEED=<seed> FUZZ_SCALE=50 npm test
 */
// src/ is typechecked WITHOUT node types (the app is browser code), so reach
// process.env through globalThis — the same pattern multiplayerConfig.ts uses
// for import.meta.env. Tests always run under Node, where it exists.
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export const FUZZ_SEED = Number(env.FUZZ_SEED ?? 1) >>> 0 || 1;
export const FUZZ_SCALE = Math.max(1, Math.floor(Number(env.FUZZ_SCALE ?? 1)) || 1);

if (env.FUZZ_SEED || env.FUZZ_SCALE) {
  // Only chatty when someone is deliberately fuzzing harder than the default.
  console.log(`[fuzz] FUZZ_SEED=${FUZZ_SEED} FUZZ_SCALE=${FUZZ_SCALE}`);
}

/** mulberry32 — tiny deterministic PRNG so any failure reproduces from the seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
