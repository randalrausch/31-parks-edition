/**
 * Regenerates the golden serialized-game fixture that
 * src/game/stateFixture.test.ts pins (src/game/__fixtures__/gameState.fixture.json).
 *
 * Run it ONLY when STATE_VERSION changes (see src/game/version.ts):
 *
 *   npm run build:edge && npm run fixture:state
 *
 * It drives the engine through the committed edge bundle (engine.mjs) — the
 * exact code the servers run — with a seeded Math.random, so the fixture is a
 * deterministic, realistic mid-game state: dealt hands, a discard pile, a log.
 * Lives in scripts/ (plain JS) because src/ is typechecked without Node types.
 */
import { writeFileSync } from "node:fs";
import {
  createGameState,
  applyAction,
  applyPlayerAction,
  advanceAuthority,
} from "../supabase/functions/_shared/engine.mjs";

// mulberry32 — deterministic PRNG (same as src/game/fuzzRig.ts) so the fixture
// is identical on every machine.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(0x90d1e);

const players = [0, 1, 2].map((i) => ({
  id: `p${i}`,
  name: `P${i}`,
  isAI: false,
  avatarKey: "ranger",
}));
const options = {
  threeOfAKind: true,
  grace: true,
  knockPenalty: true,
  showLog: true,
  fullHistory: false,
};

// Deal, then play a few deterministic turns (draw, discard the first card) so
// the fixture has real texture: hands, a discard pile, log entries.
let s = advanceAuthority(applyAction(createGameState(players, options), { type: "deal" }));
for (let step = 0; step < 8 && (s.phase === "drawing" || s.phase === "discarding"); step++) {
  const seatId = s.players[s.cur].id;
  s = applyPlayerAction(
    s,
    seatId,
    s.phase === "drawing"
      ? { type: "drawDeck" }
      : { type: "discard", cardId: s.players[s.cur].hand[0].id },
  );
}

// Serialize exactly as the stores do (JSON round-trip).
const stored = JSON.parse(JSON.stringify(s));
const out = new URL("../src/game/__fixtures__/gameState.fixture.json", import.meta.url);
writeFileSync(out, JSON.stringify(stored, null, 2) + "\n");
console.log(
  `wrote ${out.pathname} (stateVersion=${stored.stateVersion ?? 1}, phase=${stored.phase})`,
);
