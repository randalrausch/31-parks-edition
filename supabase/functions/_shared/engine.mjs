// src/types.ts
function cardValue(rank) {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return Number(rank);
}

// src/game/engine.ts
var SUITS = ["spades", "hearts", "diamonds", "clubs"];
var RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
var DEFAULT_TRAITS = {
  bluff: 2,
  memory: 3,
  patience: 3,
  aggression: 3,
  risk: 3
};
function randomInt(n) {
  const limit = Math.floor(4294967295 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ id: `${r}-${s}`, rank: r, suit: s });
  return shuffle(d);
}
function scoreHand(hand, opts) {
  if (hand.length === 0) return 0;
  if (opts.threeOfAKind && hand.length === 3 && hand[0].rank === hand[1].rank && hand[1].rank === hand[2].rank)
    return 30.5;
  let best = 0;
  for (const suit of SUITS) {
    const t = hand.filter((c) => c.suit === suit).reduce((n, c) => n + cardValue(c.rank), 0);
    if (t > best) best = t;
  }
  return best;
}
function isAlive(p) {
  return p.tokens > 0 || p.grace;
}
function isEliminated(p) {
  return !isAlive(p);
}
function takeDamage(player, amount, opts) {
  const hadTokens = player.tokens;
  player.tokens = Math.max(0, player.tokens - amount);
  if (player.tokens === 0) {
    const overflow = amount - hadTokens;
    if (opts.grace && !player.grace && overflow <= 0) {
      player.grace = true;
      return "grace";
    }
    player.grace = false;
    return "eliminated";
  }
  return "lost";
}
function aiKnockTarget(t) {
  const drive = Math.max(t.patience, t.risk);
  const minor = Math.min(t.patience, t.risk);
  return Math.max(18, Math.min(29, Math.round(16 + drive * 2 + minor * 0.4)));
}
function aiBluffChance(t) {
  return t.bluff * 0.05;
}
function aiPlayRandomChance(t) {
  return (5 - t.memory) * 0.06;
}
function aiGrabsHighDiscard(t) {
  return t.aggression >= 4 || t.risk >= 4;
}
function planAITurn(state) {
  const p = state.players[state.cur];
  const t = p.traits ?? DEFAULT_TRAITS;
  const hand = p.hand;
  const sc = scoreHand(hand, state.options);
  const top = state.discard[state.discard.length - 1] ?? null;
  const desperate = !p.grace && p.tokens === 1;
  const knockAt = aiKnockTarget(t) - (desperate ? 2 : 0);
  const bluffChance = aiBluffChance(t) + (desperate ? 0.12 : 0);
  if (state.knocker === null) {
    if (sc >= knockAt) return { kind: "knock" };
    const bluffFloor = 17;
    const relaxedTarget = Math.max(bluffFloor, knockAt - t.bluff * 2);
    if (sc >= relaxedTarget && Math.random() < bluffChance) {
      return { kind: "knock" };
    }
  }
  const playRandom = Math.random() < aiPlayRandomChance(t);
  let bestImprove = sc;
  let bestSwapIdx = -1;
  if (top && !playRandom) {
    for (let i = 0; i < hand.length; i++) {
      const test = [...hand];
      test[i] = top;
      const ts = scoreHand(test, state.options);
      if (ts > bestImprove) {
        bestImprove = ts;
        bestSwapIdx = i;
      }
    }
  }
  if (aiGrabsHighDiscard(t) && top && bestSwapIdx < 0) {
    if (cardValue(top.rank) >= 10) {
      for (let i = 0; i < hand.length; i++) {
        const test = [...hand];
        test[i] = top;
        if (scoreHand(test, state.options) >= sc) {
          bestSwapIdx = i;
          break;
        }
      }
    }
  }
  if (bestSwapIdx >= 0) return { kind: "takeDiscard", handIndex: bestSwapIdx };
  return { kind: "drawDeck" };
}
function aiDiscardIndex(hand, opts, playRandom) {
  if (playRandom) return Math.floor(Math.random() * hand.length);
  let worst = 0;
  let bestRem = -1;
  for (let i = 0; i < hand.length; i++) {
    const rem = hand.filter((_, j) => j !== i);
    const rs = scoreHand(rem, opts);
    if (rs > bestRem) {
      bestRem = rs;
      worst = i;
    }
  }
  return worst;
}

// src/game/actions.ts
function applyAction(state, action) {
  const s = structuredClone(state);
  switch (action.type) {
    case "deal":
      dealCards(s);
      return s;
    case "drawDeck":
      if (s.phase !== "drawing") return s;
      if (s.deck.length === 0) reshuffle(s);
      if (s.deck.length === 0) return s;
      s.players[s.cur].hand.push(s.deck.pop());
      log(s, "deck", null);
      s.phase = "discarding";
      return s;
    case "takeDiscard": {
      if (s.phase !== "drawing" || s.discard.length === 0) return s;
      const taken = s.discard.pop();
      s.players[s.cur].hand.push(taken);
      log(s, "takeDiscard", taken);
      s.phase = "discarding";
      return s;
    }
    case "discard": {
      if (s.phase !== "discarding") return s;
      const p = s.players[s.cur];
      const idx = p.hand.findIndex((c) => c.id === action.cardId);
      if (idx < 0) return s;
      const removed = p.hand.splice(idx, 1)[0];
      s.discard.push(removed);
      log(s, "discard", removed);
      s.phase = "drawing";
      if (scoreHand(p.hand, s.options) === 31) {
        resolveDeal(s, s.cur);
      } else {
        endTurn(s);
      }
      return s;
    }
    case "knock": {
      if (s.phase !== "drawing" || s.knocker !== null) return s;
      log(s, "knock", null);
      s.knocker = s.cur;
      s.queue = [];
      let i = (s.cur + 1) % s.players.length;
      while (i !== s.cur) {
        if (isAlive(s.players[i])) s.queue.push(i);
        i = (i + 1) % s.players.length;
      }
      if (s.queue.length === 0) {
        resolveDeal(s, null);
      } else {
        s.cur = s.queue.shift();
        s.turnInDeal += 1;
      }
      return s;
    }
    case "setShowLog":
      s.options.showLog = action.value === true;
      return s;
    case "nextDeal": {
      if (s.phase !== "dealEnd") return s;
      const alive = s.players.filter(isAlive);
      if (alive.length <= 1) {
        s.winnerId = alive[0]?.id ?? null;
        s.phase = "gameOver";
      } else {
        dealCards(s);
      }
      return s;
    }
    default:
      return s;
  }
}
function dealCards(s) {
  s.dealNum += 1;
  s.turnInDeal = 1;
  s.deck = makeDeck();
  s.discard = [];
  s.knocker = null;
  s.queue = [];
  s.selected = null;
  s.result = null;
  s.status = "";
  s.log = [];
  for (const p of s.players) p.hand = [];
  const dealt = s.players.filter(isAlive);
  s.dealPlayers = dealt.length;
  for (let r = 0; r < 3; r++) for (const p of dealt) p.hand.push(s.deck.pop());
  s.discard.push(s.deck.pop());
  s.dealer = s.dealNum <= 1 ? firstLivingFrom(s, 0) : firstLivingFrom(s, s.dealer + 1);
  s.cur = s.dealer;
  const blitz = dealtBlitzIndex(s.players, s.options);
  if (blitz >= 0) {
    resolveDeal(s, blitz);
  } else {
    s.phase = "drawing";
  }
}
function dealtBlitzIndex(players, options) {
  return players.findIndex((p) => p.hand.length > 0 && scoreHand(p.hand, options) === 31);
}
function firstLivingFrom(s, from) {
  const n = s.players.length;
  let i = (from % n + n) % n;
  for (let guard = 0; guard < n && isEliminated(s.players[i]); guard++) {
    i = (i + 1) % n;
  }
  return i;
}
var MAX_ROUNDS_PER_DEAL = 20;
function endTurn(s) {
  if (s.knocker !== null) {
    if (s.queue.length === 0) {
      resolveDeal(s, null);
      return;
    }
    s.cur = s.queue.shift();
  } else {
    const nextRound = s.dealPlayers > 0 ? Math.ceil((s.turnInDeal + 1) / s.dealPlayers) : 1;
    if (nextRound > MAX_ROUNDS_PER_DEAL) {
      resolveDeal(s, null);
      return;
    }
    let next = (s.cur + 1) % s.players.length;
    while (isEliminated(s.players[next])) next = (next + 1) % s.players.length;
    s.cur = next;
  }
  s.turnInDeal += 1;
  s.phase = "drawing";
}
function resolveDeal(s, winnerIdx) {
  const opts = s.options;
  const participants = s.players.filter((p) => p.hand.length > 0);
  const knockerId = s.knocker !== null ? s.players[s.knocker].id : null;
  const winnerId = winnerIdx !== null ? s.players[winnerIdx].id : null;
  const rows = participants.map((p) => ({
    playerId: p.id,
    score: scoreHand(p.hand, opts),
    isLoser: false,
    livesLost: 0,
    outcome: null
  }));
  const rowOf = (id) => rows.find((r) => r.playerId === id);
  if (winnerId !== null) {
    for (const p of participants) {
      if (p.id !== winnerId) {
        const outcome = takeDamage(p, 1, opts);
        const r = rowOf(p.id);
        r.isLoser = true;
        r.livesLost = 1;
        r.outcome = outcome;
      }
    }
  } else {
    const min = Math.min(...rows.map((r) => r.score));
    for (const p of participants) {
      if (scoreHand(p.hand, opts) !== min) continue;
      const livesLost = opts.knockPenalty && knockerId !== null && p.id === knockerId ? 2 : 1;
      const outcome = takeDamage(p, livesLost, opts);
      const r = rowOf(p.id);
      r.isLoser = true;
      r.livesLost = livesLost;
      r.outcome = outcome;
    }
  }
  const rounds = s.dealPlayers > 0 ? Math.ceil(s.turnInDeal / s.dealPlayers) : 0;
  s.scoreHistory.push({
    deal: s.dealNum,
    rounds,
    scores: Object.fromEntries(rows.map((r) => [r.playerId, r.score])),
    knockerId
  });
  s.result = {
    title: winnerId !== null ? `31! ${s.players[winnerIdx].name} takes the deal` : "Deal Over",
    rows
  };
  s.phase = "dealEnd";
}
function reshuffle(s) {
  if (s.discard.length <= 1) return;
  const top = s.discard.pop();
  s.deck = shuffle(s.discard);
  s.discard = [top];
}
function log(s, kind, card) {
  const id = s.log.length === 0 ? 0 : s.log[s.log.length - 1].id + 1;
  s.log.push({ id, actor: s.players[s.cur].name, kind, card });
  if (s.log.length > 30) s.log.shift();
}
function createGameState(players, options) {
  return {
    players: players.map((p) => ({
      ...p,
      tokens: 3,
      grace: false,
      hand: []
    })),
    deck: [],
    discard: [],
    cur: 0,
    dealer: 0,
    knocker: null,
    queue: [],
    phase: "dealEnd",
    // a no-op starting phase; "deal" begins play
    selected: null,
    options,
    dealNum: 0,
    turnInDeal: 0,
    dealPlayers: 0,
    status: "",
    result: null,
    scoreHistory: [],
    log: [],
    winnerId: null
  };
}

// src/game/authority.ts
var HIDDEN_CARD = {
  id: "hidden",
  rank: "A",
  suit: "spades"
};
function aiTurnActions(s) {
  const plan = planAITurn(s);
  if (plan.kind === "knock") return [{ type: "knock" }];
  if (plan.kind === "takeDiscard") {
    const cardId = s.players[s.cur].hand[plan.handIndex].id;
    return [{ type: "takeDiscard" }, { type: "discard", cardId }];
  }
  const drew = applyAction(s, { type: "drawDeck" });
  const p = drew.players[drew.cur];
  const playRandom = Math.random() < aiPlayRandomChance(p.traits ?? DEFAULT_TRAITS);
  const idx = aiDiscardIndex(p.hand, drew.options, playRandom);
  return [{ type: "drawDeck" }, { type: "discard", cardId: p.hand[idx].id }];
}
function stepAI(s) {
  return aiTurnActions(s).reduce((state, a) => applyAction(state, a), s);
}
function advanceAuthority(s) {
  let state = s;
  let guard = 0;
  while ((state.phase === "drawing" || state.phase === "discarding") && state.players[state.cur].isAI && guard++ < 500) {
    state = stepAI(state);
  }
  return state;
}
var PLAYER_TURN_ACTIONS = /* @__PURE__ */ new Set([
  "drawDeck",
  "takeDiscard",
  "discard",
  "knock"
]);
function applyPlayerAction(state, seatId, action) {
  if (action.type === "setShowLog") {
    if (state.players[0]?.id !== seatId) return state;
    return settledOrSame(state, applyAction(state, action));
  }
  if (action.type === "nextDeal") {
    if (state.phase !== "dealEnd") return state;
    return settledOrSame(state, advanceAuthority(applyAction(state, action)));
  }
  if (!PLAYER_TURN_ACTIONS.has(action.type)) return state;
  if (state.phase !== "drawing" && state.phase !== "discarding") return state;
  if (state.players[state.cur].id !== seatId) return state;
  return settledOrSame(state, advanceAuthority(applyAction(state, action)));
}
function settledOrSame(state, next) {
  return JSON.stringify(next) === JSON.stringify(state) ? state : next;
}
function redactState(state, viewerId) {
  const revealAll = state.phase === "dealEnd" || state.phase === "gameOver";
  return {
    ...state,
    deck: state.deck.map(() => HIDDEN_CARD),
    players: state.players.map(
      (p) => revealAll || p.id === viewerId ? p : { ...p, hand: p.hand.map(() => HIDDEN_CARD) }
    )
  };
}

// src/game/version.ts
var APP_VERSION = "0.2.3";
var PROTOCOL_VERSION = 1;

// src/game/config.ts
var TRAIT_KEYS = ["bluff", "memory", "patience", "aggression", "risk"];
var BOOL_OPTS = ["threeOfAKind", "grace", "knockPenalty", "sound", "fullHistory"];
var clampName = (s, fallback) => (typeof s === "string" ? s.trim().slice(0, 40) : "") || fallback;
var clampKey = (s, fallback) => typeof s === "string" && /^[a-z0-9-]{1,32}$/.test(s) ? s : fallback;
var clampImage = (s) => typeof s === "string" && s.length <= 512 ? s : void 0;
function clampTraits(t) {
  if (!t || typeof t !== "object") return void 0;
  const src = t;
  const out = {};
  for (const k of TRAIT_KEYS) {
    const v = Number(src[k]);
    out[k] = Number.isFinite(v) ? Math.max(1, Math.min(5, Math.round(v))) : 3;
  }
  return out;
}
function sanitizeOptions(o) {
  const src = o && typeof o === "object" ? o : {};
  const out = {};
  for (const k of BOOL_OPTS) out[k] = src[k] === true;
  out.showLog = src.showLog !== false;
  return out;
}
function buildCreateSetup(config) {
  const humans = Math.max(1, Math.min(8, Number(config.humans) | 0));
  const ai = (Array.isArray(config.ai) ? config.ai : []).slice(0, Math.max(0, 8 - humans));
  const players = [];
  const seats = [];
  for (let i = 0; i < humans; i++) {
    const isCreator = i === 0;
    const name = isCreator ? clampName(config.creatorName, "Player 1") : `Player ${i + 1}`;
    players.push({ id: `p${i}`, name, isAI: false, avatarKey: "ranger" });
    seats.push({
      idx: i,
      name: isCreator ? name : null,
      avatar: "ranger",
      isAI: false,
      filled: isCreator
    });
  }
  ai.forEach((c, j) => {
    const idx = humans + j;
    const aiName = clampName(c.name, `Bot ${j + 1}`);
    const avatar = clampKey(c.avatarKey, "ranger");
    const emoji = typeof c.emoji === "string" ? c.emoji.slice(0, 8) : void 0;
    players.push({
      id: `p${idx}`,
      name: aiName,
      isAI: true,
      avatarKey: avatar,
      traits: clampTraits(c.traits),
      emoji,
      image: clampImage(c.image)
    });
    seats.push({ idx, name: aiName, avatar, emoji, isAI: true, filled: true });
  });
  return {
    players,
    seats,
    options: sanitizeOptions(config.options),
    humans,
    aiCount: ai.length
  };
}

// src/game/ids.ts
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let c = "";
  for (let i = 0; i < 5; i++) c += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return c;
}
var newToken = () => crypto.randomUUID();

// src/game/handlers.ts
var TTL_MS = 14 * 24 * 60 * 60 * 1e3;
var ok = (body) => ({ status: 200, body });
var fail = (status, error) => ({
  status,
  body: { error }
});
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
var expiry = () => new Date(Date.now() + TTL_MS).toISOString();
function bumped(rec, patch) {
  const now = nowIso();
  return {
    ...rec,
    ...patch,
    version: rec.version + 1,
    updatedAt: now,
    expiresAt: expiry()
  };
}
async function handleCreate(store, body) {
  const { players, seats, options } = buildCreateSetup(body.config ?? {});
  const state = createGameState(players, options);
  const code = makeCode();
  const creatorToken = newToken();
  const gameId = crypto.randomUUID();
  const now = nowIso();
  const rec = {
    gameId,
    code,
    status: "lobby",
    version: 0,
    seats,
    createdAt: now,
    updatedAt: now,
    expiresAt: expiry()
  };
  const secret = { state, seatTokens: { [creatorToken]: 0 } };
  await store.createGame(rec, secret);
  return ok({ gameId, code, seatIndex: 0, seatToken: creatorToken });
}
async function handleJoin(store, body) {
  const code = typeof body.code === "string" ? body.code : "";
  const gameId = await store.getByCode(code);
  if (!gameId) return fail(404, "No game with that code.");
  const game = await store.getGame(gameId);
  const secret = await store.getSecret(gameId);
  if (!game || !secret) return fail(404, "No game with that code.");
  if (game.rec.status !== "lobby") return fail(409, "That game has already started.");
  const seats = game.rec.seats;
  const seat = seats.find((s) => !s.isAI && !s.filled) ?? seats.find((s) => s.isAI);
  if (!seat) return fail(409, "That game is full.");
  const idx = seat.idx;
  const name = (typeof body.name === "string" ? body.name.trim().slice(0, 40) : "") || `Player ${idx + 1}`;
  const tookAI = seat.isAI === true;
  seat.isAI = false;
  seat.filled = true;
  seat.name = name;
  seat.avatar = "ranger";
  seat.emoji = null;
  const players = secret.state.players;
  const player = players[idx];
  player.isAI = false;
  player.name = name;
  player.avatarKey = "ranger";
  if (tookAI) {
    delete player.traits;
    player.emoji = null;
    player.image = null;
  }
  const t = newToken();
  const seatTokens = { ...secret.seatTokens, [t]: idx };
  const next = bumped(game.rec, { seats });
  if (!await store.update(gameId, game.etag, next, {
    state: secret.state,
    seatTokens
  }))
    return fail(409, "The game just changed \u2014 please try again.");
  return ok({ gameId, seatIndex: idx, seatToken: t });
}
async function handleStart(store, body) {
  const gameId = String(body.gameId ?? "");
  const game = await store.getGame(gameId);
  const secret = await store.getSecret(gameId);
  if (!game || !secret) return fail(404, "That game no longer exists.");
  if (secret.seatTokens[String(body.seatToken)] !== 0)
    return fail(403, "Only the host can start the game.");
  if (game.rec.status !== "lobby") return fail(409, "The game has already started.");
  const seats = game.rec.seats;
  const state = secret.state;
  for (const s of seats) {
    if (!s.isAI && !s.filled) {
      s.isAI = true;
      s.filled = true;
      state.players[s.idx].isAI = true;
    }
  }
  const dealt = advanceAuthority(applyAction(secret.state, { type: "deal" }));
  const next = bumped(game.rec, { seats, status: "playing" });
  if (!await store.update(gameId, game.etag, next, {
    state: dealt,
    seatTokens: secret.seatTokens
  }))
    return fail(409, "The game just changed \u2014 please try again.");
  return ok({ ok: true });
}
async function handleAct(store, body) {
  const gameId = String(body.gameId ?? "");
  const game = await store.getGame(gameId);
  const secret = await store.getSecret(gameId);
  if (!game || !secret) return fail(404, "That game no longer exists.");
  const idx = secret.seatTokens[String(body.seatToken)];
  if (idx === void 0) return fail(403, "Your seat is no longer valid for this game.");
  if (typeof body.action !== "object" || body.action === null)
    return fail(400, "That move wasn't understood.");
  const seatId = secret.state.players[idx].id;
  const next = applyPlayerAction(secret.state, seatId, body.action);
  if (next === secret.state) return ok({ ok: false, reason: "not-applied" });
  const status = next.phase === "gameOver" ? "over" : "playing";
  const rec = bumped(game.rec, { status });
  if (!await store.update(gameId, game.etag, rec, {
    state: next,
    seatTokens: secret.seatTokens
  }))
    return fail(409, "The game just changed \u2014 please retry.");
  return ok({ ok: true });
}
async function handleState(store, body) {
  const gameId = String(body.gameId ?? "");
  const game = await store.getGame(gameId);
  const secret = await store.getSecret(gameId);
  if (!game || !secret) return fail(404, "That game no longer exists.");
  const tok = body.seatToken;
  const idx = typeof tok === "string" ? secret.seatTokens[tok] : void 0;
  const seatId = idx !== void 0 ? secret.state.players[idx].id : null;
  return ok({
    status: game.rec.status,
    version: game.rec.version,
    seats: game.rec.seats,
    seatIndex: idx ?? null,
    state: redactState(secret.state, seatId)
  });
}
function handleVersion(provider) {
  return ok({
    ok: true,
    version: APP_VERSION,
    provider,
    protocol: PROTOCOL_VERSION
  });
}

// src/game/store.ts
var StateTooLargeError = class extends Error {
  constructor(bytes) {
    super(`Game state too large to persist: ${bytes} bytes`);
    this.name = "StateTooLargeError";
  }
};

// src/game/router.ts
var OPS = {
  create: handleCreate,
  join: handleJoin,
  start: handleStart,
  act: handleAct,
  state: handleState
};
function makeRouter(store, opts = {}) {
  const allowed = (opts.allowedOrigin ?? "*").split(",").map((o) => o.trim()).filter(Boolean);
  const pickOrigin = (reqOrigin) => allowed.includes("*") ? "*" : reqOrigin && allowed.includes(reqOrigin) ? reqOrigin : allowed[0] ?? "*";
  const provider = opts.provider ?? "Azure";
  const rateLimiter = opts.rateLimiter;
  const cors = (reqOrigin) => ({
    "Access-Control-Allow-Origin": pickOrigin(reqOrigin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": opts.allowedHeaders ?? "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  });
  const hits = /* @__PURE__ */ new Map();
  const limited = (key, max, windowMs) => {
    const now = Date.now();
    const e = hits.get(key);
    if (!e || now > e.reset) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 5e3) {
        for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
      }
      return false;
    }
    e.n += 1;
    return e.n > max;
  };
  return async function route(req) {
    const corsHeaders = cors(req.origin);
    const reply = (status, body2) => ({
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: body2
    });
    if (req.method === "OPTIONS") return { status: 204, headers: corsHeaders };
    if (req.method !== "POST") return reply(405, { error: "POST only." });
    if (limited(req.ip, 90, 6e4))
      return reply(429, { error: "Too many requests \u2014 please slow down." });
    let body;
    try {
      body = await req.readJson();
    } catch {
      return reply(400, { error: "We couldn't read that request." });
    }
    const op = String(body?.op ?? "");
    if (op === "version") return reply(200, handleVersion(provider).body);
    if (op === "create") {
      if (limited(`create:${req.ip}`, 15, 6e5))
        return reply(429, {
          error: "You're creating games too quickly \u2014 try again in a few minutes."
        });
      if (rateLimiter && !await rateLimiter.allowCreate(req.ip, (/* @__PURE__ */ new Date()).toISOString()))
        return reply(429, {
          error: "Too many games are being created right now \u2014 please try again later."
        });
    }
    const fn = OPS[op];
    if (!fn) return reply(400, { error: "Unsupported request." });
    try {
      const { status, body: out } = await fn(store, body);
      return reply(status, out);
    } catch (e) {
      if (e instanceof StateTooLargeError) {
        console.error(`game op=${op} state-too-large: ${e.message}`);
        return reply(507, {
          error: "This game has grown too large to continue. Please start a new one."
        });
      }
      console.error(`game op=${op} failed:`, e?.stack ?? e);
      return reply(500, {
        error: "Something went wrong on our end. Please try again."
      });
    }
  };
}

// src/game/rateLimit.ts
var safe = (s) => s.replace(/[^A-Za-z0-9.:_-]/g, "_").slice(0, 200);
function makeLimiter(counter, maxPerDay, maxPerIpHour) {
  return {
    async allowCreate(ip, nowIso2) {
      const day = nowIso2.slice(0, 10);
      const hour = nowIso2.slice(0, 13);
      if (!await counter.incrIfBelow("global", `d:${day}`, maxPerDay)) return false;
      return counter.incrIfBelow("ip", `${safe(ip)}:${hour}`, maxPerIpHour);
    }
  };
}

// src/game/supabaseStore.ts
var MAX_STATE_BYTES = 6e4;
var TTL_MS2 = 14 * 24 * 60 * 60 * 1e3;
function guardSize(state) {
  const size = JSON.stringify(state).length;
  if (size > MAX_STATE_BYTES) throw new StateTooLargeError(size);
}
function toRecord(row) {
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
    expiresAt: new Date(new Date(row.updated_at).getTime() + TTL_MS2).toISOString()
  };
}
function makeSupabaseStore(admin) {
  return {
    async createGame(rec, secret) {
      guardSize(secret.state);
      const { error: gErr } = await admin.from("games").insert({
        id: rec.gameId,
        code: rec.code,
        status: rec.status,
        version: 0,
        seats: rec.seats
      });
      if (gErr) throw new Error(`createGame(games): ${gErr.message}`);
      const { error: sErr } = await admin.from("game_secrets").insert({
        game_id: rec.gameId,
        state: secret.state,
        seat_tokens: secret.seatTokens
      });
      if (sErr) throw new Error(`createGame(secret): ${sErr.message}`);
    },
    async getByCode(code) {
      const { data } = await admin.from("games").select("id").eq("code", code.toUpperCase()).maybeSingle();
      return data?.id ?? null;
    },
    async getGame(gameId) {
      const { data } = await admin.from("games").select("*").eq("id", gameId).maybeSingle();
      if (!data) return null;
      const rec = toRecord(data);
      return { rec, etag: String(rec.version) };
    },
    async getSecret(gameId) {
      const { data } = await admin.from("game_secrets").select("*").eq("game_id", gameId).maybeSingle();
      if (!data) return null;
      return {
        state: data.state,
        seatTokens: data.seat_tokens
      };
    },
    async update(gameId, etag, rec, secret) {
      guardSize(secret.state);
      const { data, error } = await admin.rpc("commit_game", {
        p_id: gameId,
        p_expected_version: Number(etag),
        p_status: rec.status,
        p_seats: rec.seats,
        p_state: secret.state,
        p_seat_tokens: secret.seatTokens
      });
      if (error) throw new Error(`update(commit_game): ${error.message}`);
      return typeof data === "number" && data >= 0;
    },
    async deleteExpired(nowIso2) {
      const cutoff = new Date(new Date(nowIso2).getTime() - TTL_MS2).toISOString();
      const { data, error } = await admin.from("games").delete().lt("updated_at", cutoff).select("id");
      if (error) throw new Error(`deleteExpired: ${error.message}`);
      return data?.length ?? 0;
    }
  };
}
function makeSupabaseRateLimiter(admin, maxPerDay, maxPerIpHour) {
  const counter = {
    async incrIfBelow(pk, rk, limit) {
      try {
        const { data, error } = await admin.rpc("incr_if_below", {
          p_bucket: pk,
          p_window: rk,
          p_limit: limit
        });
        if (error) return true;
        return data === true;
      } catch {
        return true;
      }
    }
  };
  return makeLimiter(counter, maxPerDay, maxPerIpHour);
}
export {
  APP_VERSION,
  PROTOCOL_VERSION,
  advanceAuthority,
  applyAction,
  applyPlayerAction,
  buildCreateSetup,
  clampKey,
  clampName,
  createGameState,
  makeRouter,
  makeSupabaseRateLimiter,
  makeSupabaseStore,
  redactState,
  sanitizeOptions
};
