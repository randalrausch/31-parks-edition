// src/types.ts
function cardValue(rank) {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return Number(rank);
}

// src/game/engine.ts
var SUITS = ["spades", "hearts", "diamonds", "clubs"];
var RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K"
];
var DEFAULT_TRAITS = {
  bluff: 2,
  memory: 3,
  patience: 3,
  aggression: 3,
  risk: 3
};
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeDeck() {
  const d = [];
  for (const s of SUITS)
    for (const r of RANKS) d.push({ id: `${r}-${s}`, rank: r, suit: s });
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
  return p.lives > 0 || p.grace;
}
function isEliminated(p) {
  return !isAlive(p);
}
function takeDamage(player, amount, opts) {
  const hadLives = player.lives;
  player.lives = Math.max(0, player.lives - amount);
  if (player.lives === 0) {
    const overflow = amount - hadLives;
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
  const desperate = !p.grace && p.lives === 1;
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
  s.cur = 0;
  while (isEliminated(s.players[s.cur])) s.cur = (s.cur + 1) % s.players.length;
  if (scoreHand(s.players[s.cur].hand, s.options) === 31) {
    resolveDeal(s, s.cur);
  } else {
    s.phase = "drawing";
  }
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
    players: players.map(
      (p) => ({ ...p, lives: 3, grace: false, hand: [] })
    ),
    deck: [],
    discard: [],
    cur: 0,
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
function stepAI(s) {
  const plan = planAITurn(s);
  if (plan.kind === "knock") return applyAction(s, { type: "knock" });
  if (plan.kind === "takeDiscard") {
    const cardId = s.players[s.cur].hand[plan.handIndex].id;
    return applyAction(applyAction(s, { type: "takeDiscard" }), {
      type: "discard",
      cardId
    });
  }
  const drew = applyAction(s, { type: "drawDeck" });
  const p = drew.players[drew.cur];
  const playRandom = Math.random() < aiPlayRandomChance(p.traits ?? DEFAULT_TRAITS);
  const idx = aiDiscardIndex(p.hand, drew.options, playRandom);
  return applyAction(drew, { type: "discard", cardId: p.hand[idx].id });
}
function advanceAuthority(s) {
  let state = s;
  let guard = 0;
  while ((state.phase === "drawing" || state.phase === "discarding") && state.players[state.cur].isAI && guard++ < 500) {
    state = stepAI(state);
  }
  return state;
}
function applyPlayerAction(state, seatId, action) {
  if (action.type === "nextDeal") {
    if (state.phase !== "dealEnd") return state;
    return advanceAuthority(applyAction(state, action));
  }
  if (state.phase !== "drawing" && state.phase !== "discarding") return state;
  if (state.players[state.cur].id !== seatId) return state;
  return advanceAuthority(applyAction(state, action));
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
export {
  advanceAuthority,
  applyAction,
  applyPlayerAction,
  createGameState,
  redactState
};
