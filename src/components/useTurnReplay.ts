/**
 * useTurnReplay — paces opponent turns on the online board.
 *
 * The server settles all consecutive AI (and remote) turns atomically, so a
 * client only ever receives the final snapshot: opponents' moves would otherwise
 * happen instantly and invisibly. This hook diffs the public action log between
 * snapshots and "replays" the new opponent moves one beat at a time — narrating
 * each ("Ben drew, dropped 7♣"), highlighting the acting seat, and stepping the
 * discard pile through each move — before handing control back to the viewer.
 *
 * It's purely presentational: it never changes game state, only how/when the
 * already-authoritative snapshot is revealed. The viewer's own move is shown
 * immediately (no self-narration); only opponents are paced.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NetworkSnapshot } from "../game/networkTransport";
import type { LogEntry } from "../game/engine";
import type { CardModel, Suit } from "../types";

export interface ReplayView {
  /** Discard top to render while replaying (otherwise use the live top). */
  discardTop: CardModel | null;
  /** Seat index of the opponent currently acting during replay, else null. */
  actingSeat: number | null;
  /** Recap line to show during replay (overrides the normal turn label). */
  note: string | null;
  /** True while opponents are animating — lock the viewer's controls. */
  busy: boolean;
  /** Max log-entry id to reveal right now, so the "At the Table" feed steps in
   * sync with the animation instead of dumping every move at once. */
  logThrough: number;
}

const ALL_LOG = Number.MAX_SAFE_INTEGER;
const IDLE: ReplayView = {
  discardTop: null,
  actingSeat: null,
  note: null,
  busy: false,
  logThrough: ALL_LOG,
};
const STEP_MS = 950; // a beat per opponent turn
const SETTLE_MS = 650; // hold on the last move before returning control

const top = (d: CardModel[]) => d[d.length - 1] ?? null;
const lastId = (log: LogEntry[]) => (log.length ? log[log.length - 1].id : -1);
const SUIT: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};
const cardName = (c: CardModel | null | undefined) => (c ? `${c.rank}${SUIT[c.suit]}` : "a card");

interface Shown {
  version: number;
  dealNum: number;
  lastLogId: number;
  discard: CardModel[];
}

export function useTurnReplay(snap: NetworkSnapshot | null, viewerName: string | null): ReplayView {
  const [view, setView] = useState<ReplayView>(IDLE);
  const shownRef = useRef<Shown | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clear any pending beats on unmount.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // useLayoutEffect so the initial clamped frame is applied before paint — the
  // feed/discard never flash the full new state before the replay steps it in.
  useLayoutEffect(() => {
    const s = snap?.state ?? null;
    if (!snap || !s) return;
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const shown = shownRef.current;
    const settleNow = () => {
      shownRef.current = {
        version: snap.version,
        dealNum: s.dealNum,
        lastLogId: lastId(s.log),
        discard: s.discard,
      };
      setView(IDLE);
    };

    // First load, no change / stale, or a fresh deal: just show the live board.
    if (!shown || snap.version <= shown.version || s.dealNum !== shown.dealNum) {
      clear();
      settleNow();
      return;
    }

    // New public actions since last shown, in chronological order.
    const fresh = s.log.filter((e) => e.id > shown.lastLogId);
    const hasOpponent = fresh.some((e) => e.actor !== viewerName);
    if (fresh.length === 0 || !hasOpponent) {
      clear();
      settleNow();
      return;
    }

    // One beat per player turn: group consecutive entries by the same actor.
    const groups: LogEntry[][] = [];
    for (const e of fresh) {
      const g = groups[groups.length - 1];
      if (g && g[0].actor === e.actor) g.push(e);
      else groups.push([e]);
    }

    clear();
    // Initial frame (synchronous, pre-paint): show exactly what was on screen
    // before this snapshot — old discard, old log — then step forward.
    setView({
      discardTop: top(shown.discard),
      actingSeat: null,
      note: null,
      busy: true,
      logThrough: shown.lastLogId,
    });
    const running = [...shown.discard];
    let t = 0;
    for (const g of groups) {
      const actor = g[0].actor;
      const mine = actor === viewerName;
      const seat = s.players.findIndex((p) => p.name === actor);
      for (const e of g) {
        if (e.kind === "discard" && e.card) running.push(e.card);
        else if (e.kind === "takeDiscard") running.pop();
      }
      const knocked = g.some((e) => e.kind === "knock");
      const drop = [...g].reverse().find((e) => e.kind === "discard")?.card ?? null;
      const took = g.some((e) => e.kind === "takeDiscard");
      const note = knocked
        ? `${actor} knocked!`
        : `${actor} ${took ? "took the discard" : "drew"}${
            drop ? `, dropped ${cardName(drop)}` : ""
          }`;
      // Reveal the feed up through this turn's last move, in step with the beat.
      const groupMaxId = g[g.length - 1].id;
      const step: ReplayView = {
        discardTop: top(running),
        actingSeat: mine ? null : seat,
        note: mine ? null : note,
        busy: true,
        logThrough: groupMaxId,
      };
      t += mine ? 0 : STEP_MS; // the viewer's own move shows immediately
      timers.current.push(setTimeout(() => setView(step), t));
    }
    timers.current.push(setTimeout(settleNow, t + SETTLE_MS));

    return clear;
  }, [snap, viewerName]);

  return view;
}
