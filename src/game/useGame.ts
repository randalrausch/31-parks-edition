/**
 * useGame — presentation layer over a Transport.
 *
 * The authoritative game state lives in the Transport (LocalTransport runs the
 * pure `applyAction` reducer in-process; online play uses NetworkTransport +
 * useNetworkGame instead). This hook NEVER mutates game state directly — every
 * change is a dispatched GameAction. What lives here is purely presentational:
 * the staggered
 * deal animation, AI "thinking" pauses, the pass-the-device cover, sound
 * effects, and the knock beat.
 *
 * A small presentation overlay is layered on the authoritative state:
 *   • viewPhase  — overrides the auth phase with "dealing" | "cover" | "thinking"
 *   • selected   — which hand card the local human tapped (UI-only)
 *   • status     — the status-line text
 *   • dealReveal — how many cards have flown in during the deal animation
 *   • holdCur    — pins the displayed current player during a post-discard beat,
 *                  so the reducer's atomic turn-advance never flashes the next
 *                  player's hand.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { type GameOptions, type GameState, type AITraits, isAlive } from "./engine";
import { LocalTransport, type Transport } from "./transport";
import { aiTurnActions } from "./authority";
import type { GameAction, NewGamePlayer } from "./actions";
import { sndShuffle, sndDeal, sndKnock, sndCoin } from "./sound";
import { saveSolo, loadSolo, clearSolo } from "./soloPersist";

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

export interface SoloGameApi {
  state: GameState | null;
  startGame: (config: GameConfig) => void;
  /** Restore a persisted solo game if one exists; returns whether it did. */
  resumeSolo: () => boolean;
  drawDeck: () => void;
  drawDiscard: () => void;
  selectCard: (idx: number) => void;
  confirmDiscard: () => void;
  knock: () => void;
  coverReady: () => void;
  nextDeal: () => void;
  newGame: () => void;
}

interface Presentation {
  viewPhase: "dealing" | "cover" | "thinking" | null;
  selected: number | null;
  status: string;
  dealReveal: number;
  holdCur: number | null;
  /** True while a committed move is animating (e.g. a knock) — locks input so a
   * follow-up click can't be applied or silently dropped before it resolves. */
  committing: boolean;
}

const freshPres = (): Presentation => ({
  viewPhase: null,
  selected: null,
  status: "",
  dealReveal: 0,
  holdCur: null,
  committing: false,
});

export function useGame(): SoloGameApi {
  const transportRef = useRef<Transport | null>(null);
  const authRef = useRef<GameState | null>(null);
  const presRef = useRef<Presentation>(freshPres());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [, force] = useReducer((n) => n + 1, 0);

  const render = useCallback(() => force(), []);
  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // Cancel any pending deal/AI/knock timers when the hook unmounts so they
  // can't fire render()/dispatch() on an unmounted component (e.g. switching
  // from a solo game to online play).
  useEffect(() => clearTimers, [clearTimers]);

  const A = () => authRef.current;
  const P = () => presRef.current;
  const beep = (fn: () => void) => {
    if (authRef.current?.options.sound) fn();
  };
  const dispatch = (action: GameAction) => {
    transportRef.current?.dispatch(action);
    authRef.current = transportRef.current?.getState() ?? null;
  };
  const multipleHumans = () => (A()?.players.filter((p) => !p.isAI && isAlive(p)).length ?? 0) > 1;

  /* ── flow control (presentation) ─────────────────────────────────────── */

  // After the turn passes to a new player (or the deal resolves), set up the
  // right presentation and schedule the AI if needed.
  const advance = useCallback(() => {
    const a = A();
    const pres = P();
    if (!a) return;
    pres.committing = false; // the committed move has resolved; re-enable input
    if (a.phase === "drawing") {
      const p = a.players[a.cur];
      if (p.isAI) {
        pres.viewPhase = "thinking";
        pres.status = `${p.name} is thinking…`;
        render();
        after(900, runAITurn);
      } else {
        pres.viewPhase = multipleHumans() ? "cover" : null;
        pres.status =
          a.knocker !== null ? `${a.players[a.knocker].name} knocked — your last hand` : "";
        // Rest point: the game is now waiting on a human. Snapshot it so a
        // reload/crash resumes here (never mid-animation or mid-AI-turn).
        saveSolo(a);
        render();
      }
    } else if (a.phase === "dealEnd") {
      pres.viewPhase = null;
      const rows = a.result?.rows ?? [];
      const maxDrop = rows.reduce((m, r) => Math.max(m, r.livesLost), 0);
      for (let c = 0; c < maxDrop; c++) after(c * 280, () => beep(sndCoin));
      saveSolo(a); // rest point: waiting on the human to start the next deal
      render();
    } else {
      if (a.phase === "gameOver") clearSolo(); // nothing left to resume
      pres.viewPhase = null;
      render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after, render]);

  // Drive one AI turn by dispatching the shared AI action sequence (same logic
  // the server uses), but spaced out with presentational beats.
  const runAITurn = useCallback(() => {
    const a = A();
    const pres = P();
    if (!a || a.phase !== "drawing") return;
    const aiIdx = a.cur;
    const p = a.players[aiIdx];
    const actions = aiTurnActions(a);

    if (actions[0].type === "knock") {
      pres.status = `${p.name} knocks!`;
      beep(sndKnock);
      render();
      after(800, () => {
        dispatch(actions[0]);
        advance();
      });
      return;
    }

    // Draw (deck or discard), beat, then discard while holding on the AI.
    dispatch(actions[0]);
    beep(sndDeal);
    render();
    after(700, () => {
      dispatch(actions[1]);
      beep(sndDeal);
      pres.holdCur = aiIdx; // keep showing the AI while its discard sits
      render();
      after(600, () => {
        pres.holdCur = null;
        advance();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after, render, advance]);

  // Animate the deal (single-human / AI-first), then hand off to advance().
  const startDealAnimation = useCallback(() => {
    const a = A();
    const pres = P();
    if (!a) return;
    pres.viewPhase = "dealing";
    pres.dealReveal = 0;
    pres.status = "";
    render();
    beep(sndShuffle);
    const dealtCount = a.players.filter((p) => p.hand.length > 0).length;
    const total = dealtCount * 3;
    let t = 420;
    for (let k = 1; k <= total; k++) {
      after(t, () => {
        P().dealReveal = k;
        beep(sndDeal);
        render();
      });
      t += 130;
    }
    after(t + 80, () => {
      P().viewPhase = null;
      render();
      advance();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after, render, advance]);

  // After a fresh deal: hide it behind the cover for multiple humans, else
  // play the deal animation.
  const beginDealPresentation = useCallback(() => {
    const a = A();
    const pres = P();
    if (!a) return;
    if (multipleHumans() && !a.players[a.cur].isAI) {
      pres.viewPhase = "cover";
      pres.status = "";
      render();
    } else {
      startDealAnimation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, startDealAnimation]);

  /* ── public actions ──────────────────────────────────────────────────── */

  const startGame = useCallback(
    (config: GameConfig) => {
      clearTimers();
      clearSolo(); // a fresh game replaces any prior save
      presRef.current = freshPres();
      const players: NewGamePlayer[] = config.players.map((c, i) => ({
        id: `p${i}`,
        name: c.name.trim() || (c.isAI ? "AI" : `Player ${i + 1}`),
        isAI: c.isAI,
        traits: c.traits,
        emoji: c.emoji,
        image: c.image,
        avatarKey: c.avatarKey,
      }));
      const t = new LocalTransport();
      transportRef.current = t;
      t.start(players, config.options); // creates state + deals the first hand
      authRef.current = t.getState();
      beginDealPresentation();
    },
    [clearTimers, beginDealPresentation],
  );

  const drawDeck = useCallback(() => {
    const a = A();
    if (!a || P().committing || a.phase !== "drawing" || a.players[a.cur].isAI) return;
    dispatch({ type: "drawDeck" });
    beep(sndDeal);
    P().selected = null;
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render]);

  const drawDiscard = useCallback(() => {
    const a = A();
    if (!a || P().committing || a.phase !== "drawing" || a.players[a.cur].isAI) return;
    if (a.discard.length === 0) return;
    dispatch({ type: "takeDiscard" });
    beep(sndDeal);
    P().selected = null;
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render]);

  const selectCard = useCallback(
    (idx: number) => {
      const a = A();
      if (!a || a.phase !== "discarding" || a.players[a.cur].isAI) return;
      P().selected = P().selected === idx ? null : idx;
      render();
    },
    [render],
  );

  const confirmDiscard = useCallback(() => {
    const a = A();
    const pres = P();
    if (!a || pres.committing || pres.selected === null || a.phase !== "discarding") return;
    const card = a.players[a.cur].hand[pres.selected];
    if (!card) return;
    pres.selected = null;
    dispatch({ type: "discard", cardId: card.id });
    advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advance]);

  const knock = useCallback(() => {
    const a = A();
    const pres = P();
    if (
      !a ||
      pres.committing ||
      a.phase !== "drawing" ||
      a.players[a.cur].isAI ||
      a.knocker !== null
    )
      return;
    // Lock input immediately so a stray draw/second-knock click during the
    // announcement beat can't be applied (and silently drop the queued knock).
    pres.committing = true;
    // Hold on the knocker's own board for the announcement, THEN dispatch so the
    // next player's hand is never shown before the cover/thinking goes up.
    pres.status = `${a.players[a.cur].name} knocks!`;
    beep(sndKnock);
    render();
    after(800, () => {
      dispatch({ type: "knock" });
      advance();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after, render, advance]);

  const coverReady = useCallback(() => {
    if (P().viewPhase !== "cover") return;
    P().viewPhase = null;
    render();
  }, [render]);

  const nextDeal = useCallback(() => {
    const a = A();
    if (!a || a.phase !== "dealEnd") return;
    dispatch({ type: "nextDeal" });
    if (A()?.phase === "gameOver") {
      P().viewPhase = null;
      render();
    } else {
      beginDealPresentation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, beginDealPresentation]);

  const newGame = useCallback(() => {
    clearTimers();
    clearSolo();
    transportRef.current?.destroy();
    transportRef.current = null;
    authRef.current = null;
    presRef.current = freshPres();
    render();
  }, [clearTimers, render]);

  // Restore a persisted solo game (only at app start, before any game is
  // active). We only ever saved a human-rest or deal-end state, so advance()
  // lands directly on the board / deal-end screen and waits — no re-deal
  // animation, and never a stranded AI turn.
  const resumeSolo = useCallback((): boolean => {
    if (authRef.current) return false; // a game is already in progress
    const saved = loadSolo();
    if (!saved) return false;
    clearTimers();
    presRef.current = freshPres();
    const t = new LocalTransport();
    transportRef.current = t;
    t.load(saved);
    authRef.current = t.getState();
    advance();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers, advance]);

  /* ── derive the view state from auth + presentation overlay ───────────── */
  const view = ((): GameState | null => {
    const a = authRef.current;
    if (!a) return null;
    const pres = presRef.current;
    const phase = pres.viewPhase ?? a.phase;
    const cur = pres.holdCur ?? a.cur;

    let players = a.players;
    let discard = a.discard;
    if (pres.viewPhase === "dealing") {
      // Reveal hands progressively (round-robin deal order); hide the discard
      // until every card has flown in.
      const dealt = a.players.filter((p) => p.hand.length > 0);
      const np = dealt.length || 1;
      players = a.players.map((p) => {
        if (p.hand.length === 0) return p;
        const j = dealt.indexOf(p);
        let c = 0;
        for (let k = 0; k < pres.dealReveal; k++) if (k % np === j) c++;
        return { ...p, hand: p.hand.slice(0, Math.min(c, p.hand.length)) };
      });
      discard = [];
    }

    return {
      ...a,
      phase,
      cur,
      players,
      discard,
      selected: pres.selected,
      status: pres.status,
    };
  })();

  return {
    state: view,
    startGame,
    resumeSolo,
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
