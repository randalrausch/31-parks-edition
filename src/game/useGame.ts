/**
 * useGame — orchestrates a full game of 31 over the pure engine.
 *
 * State lives in a mutable ref (mirroring the proven original) with a render
 * tick to repaint React; timeouts drive the deal animation, AI turns, and
 * pass-the-device flow. Every mutation goes through the engine helpers so the
 * rules stay in one place (and stay portable to a future networked transport).
 */
import { useCallback, useRef } from "react";
import { useReducer } from "react";
import type { CardModel } from "../types";
import {
  type GameOptions,
  type GamePlayer,
  type GameState,
  type AITraits,
  type DamageOutcome,
  makeDeck,
  shuffle,
  scoreHand,
  isAlive,
  isEliminated,
  takeDamage,
  planAITurn,
  aiDiscardIndex,
  aiPlayRandomChance,
  DEFAULT_TRAITS,
} from "./engine";
import { sndShuffle, sndDeal, sndKnock, sndCoin } from "./sound";

export interface PlayerConfig {
  name: string;
  isAI: boolean;
  avatarKey: string;
  /** AI character traits + emoji/portrait (omitted for humans). */
  traits?: AITraits;
  emoji?: string;
  image?: string;
}

export interface GameConfig {
  players: PlayerConfig[];
  options: GameOptions;
}

export interface GameApi {
  state: GameState | null;
  startGame: (config: GameConfig) => void;
  drawDeck: () => void;
  drawDiscard: () => void;
  selectCard: (idx: number) => void;
  confirmDiscard: () => void;
  knock: () => void;
  coverReady: () => void;
  nextDeal: () => void;
  newGame: () => void;
}

export function useGame(): GameApi {
  const sRef = useRef<GameState | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [, force] = useReducer((n) => n + 1, 0);

  const render = useCallback(() => force(), []);
  const after = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const beep = useCallback((fn: () => void) => {
    if (sRef.current?.options.sound) fn();
  }, []);

  /* ── helpers over the live state ── */
  const S = () => sRef.current!;
  const multipleHumans = () =>
    S().players.filter((p) => !p.isAI && isAlive(p)).length > 1;

  const logSeq = useRef(0);
  /** Record a publicly-visible action by the current player. */
  const pushLog = (
    kind: GameState["log"][number]["kind"],
    card: CardModel | null,
  ) => {
    const s = sRef.current;
    if (!s) return;
    s.log.push({
      id: logSeq.current++,
      actor: s.players[s.cur].name,
      kind,
      card,
    });
    if (s.log.length > 30) s.log.shift();
  };

  const reshuffleDiscard = () => {
    const s = S();
    if (s.discard.length <= 1) return;
    const top = s.discard.pop()!;
    s.deck = shuffle(s.discard);
    s.discard = [top];
  };

  /* ── round resolution ── */
  const finishDeal = useCallback(
    (title: string, winnerIdx: number | null) => {
      const s = S();
      const opts = s.options;

      // Only players who were dealt in this round (alive at deal time) are
      // scored and revealed. Eliminated players have empty hands and are
      // excluded entirely.
      const participants = s.players.filter((p) => p.hand.length > 0);
      const knockerId = s.knocker !== null ? s.players[s.knocker].id : null;
      const winnerId = winnerIdx !== null ? s.players[winnerIdx].id : null;

      const rows = participants.map((p) => ({
        playerId: p.id,
        score: scoreHand(p.hand, opts),
        isLoser: false,
        livesLost: 0,
        outcome: null as DamageOutcome | null,
      }));
      const rowOf = (id: string) => rows.find((r) => r.playerId === id)!;

      if (winnerId !== null) {
        // Instant 31 (or blitz): every other participant loses a token.
        participants.forEach((p) => {
          if (p.id !== winnerId) {
            const outcome = takeDamage(p, 1, opts);
            const r = rowOf(p.id);
            r.isLoser = true;
            r.livesLost = 1;
            r.outcome = outcome;
          }
        });
      } else {
        const min = Math.min(...rows.map((r) => r.score));
        for (const p of participants) {
          if (scoreHand(p.hand, opts) !== min) continue;
          const livesLost =
            opts.knockPenalty && knockerId !== null && p.id === knockerId
              ? 2
              : 1;
          const outcome = takeDamage(p, livesLost, opts);
          const r = rowOf(p.id);
          r.isLoser = true;
          r.livesLost = livesLost;
          r.outcome = outcome;
        }
      }

      const anyLost = rows.some((r) => r.isLoser);
      if (anyLost) {
        const maxDrop = Math.max(...rows.map((r) => r.livesLost), 0);
        for (let c = 0; c < maxDrop; c++) after(c * 280, () => beep(sndCoin));
      }

      // Record this deal's hand scores + how many rounds (laps) it took.
      const rounds =
        s.dealPlayers > 0 ? Math.ceil(s.turnInDeal / s.dealPlayers) : 0;
      s.scoreHistory.push({
        deal: s.dealNum,
        rounds,
        scores: Object.fromEntries(rows.map((r) => [r.playerId, r.score])),
        knockerId,
      });

      s.result = { title, rows };
      s.phase = "dealEnd";
      render();
    },
    [after, beep, render],
  );

  const endDeal = useCallback(
    () => finishDeal("Deal Over", null),
    [finishDeal],
  );

  const instantWin = useCallback(
    (winnerIdx: number) => {
      const name = S().players[winnerIdx].name;
      finishDeal(`31! ${name} takes the deal`, winnerIdx);
    },
    [finishDeal],
  );

  /* ── turn flow ── */
  const runAI = useCallback(() => {
    const s = S();
    const p = s.players[s.cur];
    const plan = planAITurn(s);

    if (plan.kind === "knock") {
      doKnock();
      return;
    }

    if (plan.kind === "takeDiscard") {
      const drawn = s.discard.pop()!;
      p.hand.push(drawn);
      pushLog("takeDiscard", drawn);
      beep(sndDeal);
      render();
      after(700, () => {
        const disc = p.hand.splice(plan.handIndex, 1)[0];
        s.discard.push(disc);
        pushLog("discard", disc);
        beep(sndDeal);
        render();
        after(600, endTurn);
      });
      return;
    }

    // drawDeck
    if (s.deck.length === 0) reshuffleDiscard();
    const drawn = s.deck.pop()!;
    p.hand.push(drawn);
    pushLog("deck", null);
    beep(sndDeal);
    render();
    const playRandom =
      Math.random() < aiPlayRandomChance(p.traits ?? DEFAULT_TRAITS);
    after(700, () => {
      const idx = aiDiscardIndex(p.hand, s.options, playRandom);
      const disc = p.hand.splice(idx, 1)[0];
      s.discard.push(disc);
      pushLog("discard", disc);
      render();
      after(600, endTurn);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after, beep, render]);

  const beginTurn = useCallback(() => {
    const s = S();
    s.turnInDeal += 1; // a new turn begins; rounds = turns / players
    s.phase = "drawing";
    s.selected = null;
    const p = s.players[s.cur];
    if (p.isAI) {
      s.phase = "thinking";
      s.status = `${p.name} is thinking…`;
      render();
      after(900, runAI);
    } else {
      // Human's turn — clear any stale "… is thinking" status (otherwise it
      // lingers from the previous AI turn and looks like it's still their go).
      s.status =
        s.knocker !== null
          ? `${s.players[s.knocker].name} knocked — your last hand`
          : "";
      if (multipleHumans()) s.phase = "cover";
      render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after, render, runAI]);

  const endTurn = useCallback(() => {
    const s = S();
    if (s.knocker !== null) {
      if (s.queue.length === 0) {
        endDeal();
        return;
      }
      s.cur = s.queue.shift()!;
    } else {
      // Safety net: force a showdown if a deal drags on with nobody knocking.
      const nextRound =
        s.dealPlayers > 0 ? Math.ceil((s.turnInDeal + 1) / s.dealPlayers) : 1;
      if (nextRound > 20) {
        endDeal();
        return;
      }
      let next = (s.cur + 1) % s.players.length;
      while (isEliminated(s.players[next]))
        next = (next + 1) % s.players.length;
      s.cur = next;
    }
    beginTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beginTurn, endDeal]);

  const doKnock = useCallback(() => {
    const s = S();
    beep(sndKnock);
    s.knocker = s.cur;
    s.queue = [];
    let idx = (s.cur + 1) % s.players.length;
    while (idx !== s.cur) {
      if (isAlive(s.players[idx])) s.queue.push(idx);
      idx = (idx + 1) % s.players.length;
    }
    pushLog("knock", null);
    s.status = `${s.players[s.cur].name} knocks!`;
    render();
    if (s.queue.length === 0) {
      after(700, endDeal);
      return;
    }
    // Keep `cur` on the knocker during the pause so the async re-render shows
    // the knocker's own board — only advance when beginTurn raises the cover,
    // otherwise the next human's hand would flash before it's hidden.
    after(800, () => {
      s.cur = s.queue.shift()!;
      beginTurn();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after, beep, render, beginTurn, endDeal]);

  const startDeal = useCallback(() => {
    const s = S();
    s.dealNum += 1; // deal 1 is the first deal; drives the on-screen counter
    s.turnInDeal = 0;
    s.deck = makeDeck();
    s.discard = [];
    s.knocker = null;
    s.queue = [];
    s.selected = null;
    s.result = null;
    s.status = "";
    s.log = [];
    for (const p of s.players) p.hand = [];
    s.dealPlayers = s.players.filter(isAlive).length;
    s.cur = 0;
    while (isEliminated(s.players[s.cur]))
      s.cur = (s.cur + 1) % s.players.length;
    // With multiple humans, deal behind the pass-the-device cover so nobody
    // sees the first player's hand being dealt. Otherwise show the deal.
    s.phase = multipleHumans() && !s.players[s.cur].isAI ? "cover" : "dealing";
    render();
    beep(sndShuffle);

    // Deal three rounds, one card per ALIVE player, staggered. Eliminated
    // players are skipped so no cards are wasted off the deck.
    const dealt = s.players.filter(isAlive);
    const seq: GamePlayer[] = [];
    for (let r = 0; r < 3; r++) for (const p of dealt) seq.push(p);
    let t = 420;
    seq.forEach((p) => {
      after(t, () => {
        p.hand.push(s.deck.pop()!);
        beep(sndDeal);
        render();
      });
      t += 130;
    });
    after(t + 80, () => {
      s.discard.push(s.deck.pop()!);
      s.phase = "drawing";
      if (scoreHand(s.players[s.cur].hand, s.options) === 31) {
        instantWin(s.cur);
        return;
      }
      beginTurn();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after, beep, render, beginTurn, instantWin]);

  /* ── public actions ── */
  const startGame = useCallback(
    (config: GameConfig) => {
      clearTimers();
      const players: GamePlayer[] = config.players.map((c, i) => ({
        id: `p${i}`,
        name: c.name.trim() || (c.isAI ? "AI" : `Player ${i + 1}`),
        isAI: c.isAI,
        traits: c.traits,
        emoji: c.emoji,
        image: c.image,
        avatarKey: c.avatarKey,
        lives: 3,
        grace: false,
        hand: [],
      }));
      sRef.current = {
        players,
        deck: [],
        discard: [],
        cur: 0,
        knocker: null,
        queue: [],
        phase: "dealing",
        selected: null,
        options: config.options,
        dealNum: 0,
        turnInDeal: 0,
        dealPlayers: 0,
        status: "",
        result: null,
        scoreHistory: [],
        log: [],
        winnerId: null,
      };
      startDeal();
    },
    [clearTimers, startDeal],
  );

  const drawDeck = useCallback(() => {
    const s = sRef.current;
    if (!s || s.phase !== "drawing" || s.players[s.cur].isAI) return;
    if (s.deck.length === 0) reshuffleDiscard();
    if (s.deck.length === 0) return;
    s.players[s.cur].hand.push(s.deck.pop()!);
    pushLog("deck", null);
    beep(sndDeal);
    s.phase = "discarding";
    s.selected = null;
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beep, render]);

  const drawDiscard = useCallback(() => {
    const s = sRef.current;
    if (!s || s.phase !== "drawing" || s.players[s.cur].isAI) return;
    if (s.discard.length === 0) return;
    const taken = s.discard.pop()!;
    s.players[s.cur].hand.push(taken);
    pushLog("takeDiscard", taken);
    beep(sndDeal);
    s.phase = "discarding";
    s.selected = null;
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beep, render]);

  const selectCard = useCallback(
    (idx: number) => {
      const s = sRef.current;
      if (!s || s.phase !== "discarding" || s.players[s.cur].isAI) return;
      s.selected = s.selected === idx ? null : idx;
      render();
    },
    [render],
  );

  const confirmDiscard = useCallback(() => {
    const s = sRef.current;
    if (!s || s.selected === null) return;
    const p = s.players[s.cur];
    const removed = p.hand.splice(s.selected, 1)[0];
    s.discard.push(removed);
    pushLog("discard", removed);
    s.selected = null;
    s.phase = "drawing";
    if (scoreHand(p.hand, s.options) === 31) {
      instantWin(s.cur);
      return;
    }
    endTurn();
  }, [endTurn, instantWin]);

  const knock = useCallback(() => {
    const s = sRef.current;
    if (
      !s ||
      s.phase !== "drawing" ||
      s.players[s.cur].isAI ||
      s.knocker !== null
    )
      return;
    doKnock();
  }, [doKnock]);

  const coverReady = useCallback(() => {
    const s = sRef.current;
    if (!s || s.phase !== "cover") return;
    s.phase = "drawing";
    render();
  }, [render]);

  const nextDeal = useCallback(() => {
    const s = sRef.current;
    if (!s) return;
    const alive = s.players.filter(isAlive);
    if (alive.length <= 1) {
      s.winnerId = alive[0]?.id ?? null;
      s.phase = "gameOver";
      render();
      return;
    }
    startDeal();
  }, [startDeal, render]);

  const newGame = useCallback(() => {
    clearTimers();
    sRef.current = null;
    render();
  }, [clearTimers, render]);

  return {
    state: sRef.current,
    startGame,
    drawDeck,
    drawDiscard,
    selectCard,
    confirmDiscard,
    knock,
    coverReady,
    nextDeal,
    newGame,
  };
}
