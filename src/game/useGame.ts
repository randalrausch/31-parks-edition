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
import { type GameOptions, type GameState, type AITraits } from "./engine";
import { LocalTransport, type Transport } from "./transport";
import type { GameAction, NewGamePlayer } from "./actions";
import { sndShuffle, sndDeal, sndKnock, sndCoin } from "./sound";
import {
  step,
  freshPresentation,
  TIMING,
  type Presentation,
  type PEvent,
  type Snd,
} from "./presentation";
import { elog } from "./debug";
import { seatPlayerId } from "./ids";
import {
  saveSolo,
  loadSolo,
  clearSolo,
  soloResumeCrashed,
  markSoloResuming,
  clearSoloResuming,
} from "./soloPersist";

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

export function useGame(): SoloGameApi {
  const transportRef = useRef<Transport | null>(null);
  const authRef = useRef<GameState | null>(null);
  const presRef = useRef<Presentation>(freshPresentation());
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

  const beep = (fn: () => void) => {
    if (authRef.current?.options.sound) fn();
  };
  const play = (snd: Snd) => {
    if (snd === "shuffle") beep(sndShuffle);
    else if (snd === "deal") beep(sndDeal);
    else if (snd === "knock") beep(sndKnock);
    else beep(sndCoin);
  };
  const dispatch = (action: GameAction) => {
    transportRef.current?.dispatch(action);
    authRef.current = transportRef.current?.getState() ?? null;
  };

  /* ── flow control: interpret the pure presentation machine ─────────────── */

  // Run one event and its synchronous cascade (dispatch → now → …) against the
  // real transport, timers, sound, and persistence, then re-render once. Every
  // *decision* — which view phase, which beat, how long — lives in the pure
  // machine (presentation.ts, step()); this only performs the effects it emits.
  const run = useCallback(
    (event: PEvent) => {
      let touched = false;
      const process = (ev: PEvent) => {
        const a = authRef.current;
        if (!a) return;
        const res = step(presRef.current, a, ev);
        if (!res) return; // guard-rejected no-op — render nothing
        touched = true;
        presRef.current = res.pres;
        for (const eff of res.effects) {
          switch (eff.e) {
            case "dispatch":
              dispatch(eff.action); // advances authRef for the next now/scheduled read
              break;
            case "sound":
              play(eff.snd);
              break;
            case "coinStagger":
              for (let c = 0; c < eff.count; c++) after(c * TIMING.coinStep, () => play("coin"));
              break;
            case "save": {
              const cur = authRef.current;
              if (cur) saveSolo(cur);
              break;
            }
            case "clearSave":
              clearSolo();
              break;
            case "schedule":
              after(eff.ms, () => run(eff.ev));
              break;
            case "now":
              process(eff.ev); // synchronous continuation, re-reads authRef
              break;
          }
        }
      };
      process(event);
      if (touched) render();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [after, render],
  );

  /* ── public actions ──────────────────────────────────────────────────── */

  const startGame = useCallback(
    (config: GameConfig) => {
      clearTimers();
      clearSolo(); // a fresh game replaces any prior save
      presRef.current = freshPresentation();
      const players: NewGamePlayer[] = config.players.map((c, i) => ({
        id: seatPlayerId(i),
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
      run({ t: "dealStart" });
    },
    [clearTimers, run],
  );

  const drawDeck = useCallback(() => run({ t: "drawDeck" }), [run]);
  const drawDiscard = useCallback(() => run({ t: "drawDiscard" }), [run]);
  const selectCard = useCallback((idx: number) => run({ t: "select", idx }), [run]);
  const confirmDiscard = useCallback(() => run({ t: "confirmDiscard" }), [run]);
  const knock = useCallback(() => run({ t: "knock" }), [run]);
  const coverReady = useCallback(() => run({ t: "coverReady" }), [run]);
  const nextDeal = useCallback(() => run({ t: "nextDeal" }), [run]);

  const newGame = useCallback(() => {
    clearTimers();
    clearSolo();
    transportRef.current?.destroy();
    transportRef.current = null;
    authRef.current = null;
    presRef.current = freshPresentation();
    render();
  }, [clearTimers, render]);

  // Restore a persisted solo game (only at app start, before any game is
  // active). We only ever saved a human-rest or deal-end state, so the "advance"
  // event lands directly on the board / deal-end screen and waits — no re-deal
  // animation, and never a stranded AI turn.
  const resumeSolo = useCallback((): boolean => {
    if (authRef.current) return false; // a game is already in progress
    const saved = loadSolo();
    if (!saved) return false;
    // A resume guard left over from before a reload means the last attempt to
    // restore THIS save crashed the app before the board could mount — the save
    // is poison. Discard it rather than reload it into an endless crash loop.
    if (soloResumeCrashed()) {
      clearSolo();
      clearSoloResuming();
      elog("solo", "discarded a saved game that crashed on resume");
      return false;
    }
    markSoloResuming(); // cleared by GameBoard's mount effect once it renders OK
    try {
      clearTimers();
      presRef.current = freshPresentation();
      const t = new LocalTransport();
      transportRef.current = t;
      t.load(saved);
      authRef.current = t.getState();
      run({ t: "advance" });
    } catch (err) {
      // A synchronous throw while restoring — clear the poison and reset so the
      // app lands on a clean setup screen instead of a broken board.
      clearSolo();
      clearSoloResuming();
      transportRef.current?.destroy();
      transportRef.current = null;
      authRef.current = null;
      presRef.current = freshPresentation();
      render();
      elog("solo", "failed to resume a saved game; discarded it", err);
      return false;
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers, run, render]);

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
