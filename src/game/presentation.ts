/**
 * Solo presentation state machine — pure, framework-free, and unit-tested.
 *
 * This owns the *presentation* flow that sits on top of the authoritative reducer
 * (`applyAction`): the staggered deal, the AI "thinking" pause, the knock beat,
 * the pass-the-device cover, and the coin stagger at deal end. It emits **effect
 * descriptors** (schedule a beat, dispatch an authoritative action, play a sound,
 * persist a rest point) rather than performing side effects itself, so the whole
 * flow can be exercised as a pure function. `useGame` is the thin interpreter that
 * runs the effects against a real Transport, real timers, and React.
 *
 * `step(pres, auth, event)` returns the next presentation overlay + the effects to
 * run, or `null` for a guard-rejected no-op (the interpreter then does nothing —
 * not even a re-render). `auth` is the CURRENT authoritative state; after a
 * `dispatch` effect the interpreter advances the transport and feeds the fresh
 * `auth` into any `now`/scheduled follow-up event, exactly as the old imperative
 * chain re-read state after each dispatch.
 */
import { type GameState, isAlive } from "./engine";
import { aiTurnActions } from "./authority";
import type { GameAction } from "./actions";

export type ViewPhase = "dealing" | "cover" | "thinking" | null;

/** The presentation overlay layered on the authoritative state (see useGame). */
export interface Presentation {
  viewPhase: ViewPhase;
  selected: number | null;
  status: string;
  dealReveal: number;
  holdCur: number | null;
  /** True while a committed move (knock) is animating — locks input. */
  committing: boolean;
  /** Ephemeral: the AI's planned actions, carried across its paced beats. */
  aiActions: GameAction[] | null;
  aiIdx: number | null;
}

export const freshPresentation = (): Presentation => ({
  viewPhase: null,
  selected: null,
  status: "",
  dealReveal: 0,
  holdCur: null,
  committing: false,
  aiActions: null,
  aiIdx: null,
});

/** Sounds the interpreter plays (gated on the client's local sound preference). */
export type Snd = "shuffle" | "deal" | "knock" | "coin";

/** Events that drive the machine — external (user) and internal (scheduled). */
export type PEvent =
  | { t: "dealStart" } // a fresh deal was dealt: cover or animate it in
  | { t: "dealReveal"; k: number } // one card flew in
  | { t: "dealDone" } // deal animation finished
  | { t: "advance" } // turn passed / deal resolved: set up the next rest point
  | { t: "runAI" } // begin the current AI's paced turn
  | { t: "aiStep2" } // AI: discard beat
  | { t: "aiStep3" } // AI: release the hold and advance
  | { t: "aiKnockCommit" } // AI: commit the announced knock
  | { t: "drawDeck" }
  | { t: "drawDiscard" }
  | { t: "select"; idx: number }
  | { t: "confirmDiscard" }
  | { t: "knock" }
  | { t: "knockCommit" } // human: commit the announced knock
  | { t: "coverReady" }
  | { t: "nextDeal" } // human: advance from the deal-end screen
  | { t: "afterNextDeal" }; // re-read state after nextDeal: game over vs. next deal

/** Effects the interpreter performs. `render` is implicit (once per cascade). */
export type Effect =
  | { e: "schedule"; ms: number; ev: PEvent } // setTimeout(ev, ms)
  | { e: "now"; ev: PEvent } // process ev synchronously (after prior effects)
  | { e: "dispatch"; action: GameAction } // apply to the transport; advances auth
  | { e: "sound"; snd: Snd }
  | { e: "coinStagger"; count: number } // `count` coin sounds, 280ms apart
  | { e: "save" } // snapshot this rest point (saveSolo)
  | { e: "clearSave" }; // nothing left to resume (clearSolo)

export interface StepResult {
  pres: Presentation;
  effects: Effect[];
}

// Beat timings (ms) — preserved exactly from the original imperative flow.
export const TIMING = {
  aiThink: 900,
  aiDrawToDiscard: 700,
  aiDiscardHold: 600,
  knockBeat: 800,
  dealFirst: 420,
  dealStep: 130,
  dealTail: 80,
  coinStep: 280,
} as const;

const humansAlive = (s: GameState): number => s.players.filter((p) => !p.isAI && isAlive(p)).length;
const multipleHumans = (s: GameState): boolean => humansAlive(s) > 1;
/** A seat that's known in-bounds (a current/AI/knocker index). */
const seat = (s: GameState, i: number) => s.players[i]!;

/** Shallow-clone the overlay so callers never mutate the input. */
const clone = (p: Presentation): Presentation => ({ ...p });

/**
 * The machine. Returns the next overlay + effects, or `null` for a no-op guard
 * rejection (the interpreter renders nothing in that case).
 */
export function step(pres: Presentation, auth: GameState, ev: PEvent): StepResult | null {
  const p = clone(pres);
  switch (ev.t) {
    case "dealStart": {
      // A fresh deal: hide it behind the cover for multiple humans, else animate.
      if (multipleHumans(auth) && !seat(auth, auth.cur).isAI) {
        p.viewPhase = "cover";
        p.status = "";
        return { pres: p, effects: [] };
      }
      p.viewPhase = "dealing";
      p.dealReveal = 0;
      p.status = "";
      const effects: Effect[] = [{ e: "sound", snd: "shuffle" }];
      const dealt = auth.players.filter((pl) => pl.hand.length > 0).length;
      const total = dealt * 3;
      for (let k = 1; k <= total; k++) {
        effects.push({
          e: "schedule",
          ms: TIMING.dealFirst + (k - 1) * TIMING.dealStep,
          ev: { t: "dealReveal", k },
        });
      }
      effects.push({
        e: "schedule",
        ms: TIMING.dealFirst + total * TIMING.dealStep + TIMING.dealTail,
        ev: { t: "dealDone" },
      });
      return { pres: p, effects };
    }

    case "dealReveal": {
      p.dealReveal = ev.k;
      return { pres: p, effects: [{ e: "sound", snd: "deal" }] };
    }

    case "dealDone": {
      p.viewPhase = null;
      return { pres: p, effects: [{ e: "now", ev: { t: "advance" } }] };
    }

    case "advance": {
      // A committed move has resolved; re-enable input.
      p.committing = false;
      if (auth.phase === "drawing") {
        const cur = seat(auth, auth.cur);
        if (cur.isAI) {
          p.viewPhase = "thinking";
          p.status = `${cur.name} is thinking…`;
          return { pres: p, effects: [{ e: "schedule", ms: TIMING.aiThink, ev: { t: "runAI" } }] };
        }
        p.viewPhase = multipleHumans(auth) ? "cover" : null;
        p.status =
          auth.knocker !== null ? `${seat(auth, auth.knocker).name} knocked — your last hand` : "";
        // Rest point: waiting on a human. Snapshot so a reload/crash resumes here.
        return { pres: p, effects: [{ e: "save" }] };
      }
      if (auth.phase === "dealEnd") {
        p.viewPhase = null;
        const rows = auth.result?.rows ?? [];
        const maxDrop = rows.reduce((m, r) => Math.max(m, r.livesLost), 0);
        return { pres: p, effects: [{ e: "coinStagger", count: maxDrop }, { e: "save" }] };
      }
      // gameOver or any other terminal phase.
      p.viewPhase = null;
      return {
        pres: p,
        effects: auth.phase === "gameOver" ? [{ e: "clearSave" }] : [],
      };
    }

    case "runAI": {
      if (auth.phase !== "drawing") return null;
      const aiIdx = auth.cur;
      const cur = seat(auth, aiIdx);
      const actions = aiTurnActions(auth);
      p.aiActions = actions;
      p.aiIdx = aiIdx;
      if (actions[0]!.type === "knock") {
        p.status = `${cur.name} knocks!`;
        return {
          pres: p,
          effects: [
            { e: "sound", snd: "knock" },
            { e: "schedule", ms: TIMING.knockBeat, ev: { t: "aiKnockCommit" } },
          ],
        };
      }
      // Draw (deck or discard), a beat, then discard while holding on the AI.
      return {
        pres: p,
        effects: [
          { e: "dispatch", action: actions[0]! },
          { e: "sound", snd: "deal" },
          { e: "schedule", ms: TIMING.aiDrawToDiscard, ev: { t: "aiStep2" } },
        ],
      };
    }

    case "aiStep2": {
      const actions = p.aiActions;
      if (!actions) return null;
      p.holdCur = p.aiIdx; // keep showing the AI while its discard sits
      return {
        pres: p,
        effects: [
          { e: "dispatch", action: actions[1]! },
          { e: "sound", snd: "deal" },
          { e: "schedule", ms: TIMING.aiDiscardHold, ev: { t: "aiStep3" } },
        ],
      };
    }

    case "aiStep3": {
      p.holdCur = null;
      p.aiActions = null;
      p.aiIdx = null;
      return { pres: p, effects: [{ e: "now", ev: { t: "advance" } }] };
    }

    case "aiKnockCommit": {
      const actions = p.aiActions;
      if (!actions) return null;
      p.aiActions = null;
      p.aiIdx = null;
      return {
        pres: p,
        effects: [
          { e: "dispatch", action: actions[0]! },
          { e: "now", ev: { t: "advance" } },
        ],
      };
    }

    case "drawDeck": {
      if (p.committing || auth.phase !== "drawing" || seat(auth, auth.cur).isAI) return null;
      p.selected = null;
      return {
        pres: p,
        effects: [
          { e: "dispatch", action: { type: "drawDeck" } },
          { e: "sound", snd: "deal" },
        ],
      };
    }

    case "drawDiscard": {
      if (p.committing || auth.phase !== "drawing" || seat(auth, auth.cur).isAI) return null;
      if (auth.discard.length === 0) return null;
      p.selected = null;
      return {
        pres: p,
        effects: [
          { e: "dispatch", action: { type: "takeDiscard" } },
          { e: "sound", snd: "deal" },
        ],
      };
    }

    case "select": {
      if (auth.phase !== "discarding" || seat(auth, auth.cur).isAI) return null;
      p.selected = p.selected === ev.idx ? null : ev.idx;
      return { pres: p, effects: [] };
    }

    case "confirmDiscard": {
      if (p.committing || p.selected === null || auth.phase !== "discarding") return null;
      const card = seat(auth, auth.cur).hand[p.selected];
      if (!card) return null;
      p.selected = null;
      return {
        pres: p,
        effects: [
          { e: "dispatch", action: { type: "discard", cardId: card.id } },
          { e: "now", ev: { t: "advance" } },
        ],
      };
    }

    case "knock": {
      if (
        p.committing ||
        auth.phase !== "drawing" ||
        seat(auth, auth.cur).isAI ||
        auth.knocker !== null
      )
        return null;
      // Lock input immediately so a stray draw/second-knock during the beat can't
      // be applied (and silently drop the queued knock).
      p.committing = true;
      p.status = `${seat(auth, auth.cur).name} knocks!`;
      return {
        pres: p,
        effects: [
          { e: "sound", snd: "knock" },
          { e: "schedule", ms: TIMING.knockBeat, ev: { t: "knockCommit" } },
        ],
      };
    }

    case "knockCommit": {
      return {
        pres: p,
        effects: [
          { e: "dispatch", action: { type: "knock" } },
          { e: "now", ev: { t: "advance" } },
        ],
      };
    }

    case "coverReady": {
      if (p.viewPhase !== "cover") return null;
      p.viewPhase = null;
      return { pres: p, effects: [] };
    }

    case "nextDeal": {
      if (auth.phase !== "dealEnd") return null;
      return {
        pres: p,
        effects: [
          { e: "dispatch", action: { type: "nextDeal" } },
          { e: "now", ev: { t: "afterNextDeal" } },
        ],
      };
    }

    case "afterNextDeal": {
      // Called after dispatching nextDeal (auth is now the fresh state).
      if (auth.phase === "gameOver") {
        p.viewPhase = null;
        return { pres: p, effects: [] };
      }
      return { pres: p, effects: [{ e: "now", ev: { t: "dealStart" } }] };
    }
  }
}
