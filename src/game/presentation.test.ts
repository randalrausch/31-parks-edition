/**
 * Unit tests for the pure solo presentation machine (presentation.ts). Because
 * step() is a pure function of (overlay, authoritative state, event) → effects,
 * every transition — including the ones the E2E happy path can't reach (knock,
 * cover, deal-end coin stagger, game over, the AI hold, the committing lock) — is
 * pinned here without a DOM or timers.
 */
import { describe, it, expect } from "vitest";
import { step, freshPresentation, TIMING, type Presentation, type Effect } from "./presentation";
import { createGameState, applyAction } from "./actions";
import { DEFAULT_OPTIONS, type GameState } from "./engine";

// A minimal authoritative state; tests set only the fields the machine reads.
function auth(over: Partial<GameState>): GameState {
  return {
    players: [],
    deck: [],
    discard: [],
    cur: 0,
    knocker: null,
    phase: "drawing",
    options: { sound: true },
    result: null,
    ...(over as object),
  } as unknown as GameState;
}
const human = (over = {}) => ({
  id: "p0",
  avatarKey: "ranger",
  isAI: false,
  name: "You",
  hand: [],
  tokens: 3,
  grace: false,
  ...over,
});
const ai = (over = {}) => ({
  id: "p1",
  avatarKey: "ranger",
  isAI: true,
  name: "Bot",
  hand: [],
  tokens: 3,
  grace: false,
  ...over,
});

const kinds = (effs: Effect[]) => effs.map((e) => e.e);
const scheduled = (effs: Effect[]) =>
  effs.filter((e) => e.e === "schedule") as Extract<Effect, { e: "schedule" }>[];

describe("presentation machine — advance", () => {
  it("human's turn (single human): no cover, saves a rest point, no timers", () => {
    const s = auth({ players: [human(), ai()], phase: "drawing", cur: 0 });
    const r = step(freshPresentation(), s, { t: "advance" })!;
    expect(r.pres.viewPhase).toBeNull();
    expect(r.pres.committing).toBe(false);
    expect(kinds(r.effects)).toEqual(["save"]);
  });

  it("human's turn (multiple humans): raises the cover", () => {
    const s = auth({ players: [human(), human({ name: "P2" })], phase: "drawing", cur: 0 });
    const r = step(freshPresentation(), s, { t: "advance" })!;
    expect(r.pres.viewPhase).toBe("cover");
  });

  it("shows the knocker banner on the last hand", () => {
    const s = auth({
      players: [human(), ai({ name: "Bill" })],
      phase: "drawing",
      cur: 0,
      knocker: 1,
    });
    const r = step(freshPresentation(), s, { t: "advance" })!;
    expect(r.pres.status).toMatch(/Bill knocked/);
  });

  it("AI's turn: shows thinking and schedules runAI after the think beat", () => {
    const s = auth({ players: [human(), ai()], phase: "drawing", cur: 1 });
    const r = step(freshPresentation(), s, { t: "advance" })!;
    expect(r.pres.viewPhase).toBe("thinking");
    expect(r.pres.status).toMatch(/thinking/);
    expect(scheduled(r.effects)).toEqual([
      { e: "schedule", ms: TIMING.aiThink, ev: { t: "runAI" } },
    ]);
  });

  it("deal end: clears the view and staggers one coin per token lost, then saves", () => {
    const s = auth({
      phase: "dealEnd",
      players: [human(), ai()],
      result: { rows: [{ livesLost: 1 }, { livesLost: 2 }] } as GameState["result"],
    });
    const r = step(freshPresentation(), s, { t: "advance" })!;
    expect(r.pres.viewPhase).toBeNull();
    expect(r.effects).toContainEqual({ e: "coinStagger", count: 2 });
    expect(r.effects).toContainEqual({ e: "save" });
  });

  it("game over: clears the save (nothing left to resume)", () => {
    const s = auth({ phase: "gameOver", players: [human(), ai()] });
    const r = step(freshPresentation(), s, { t: "advance" })!;
    expect(kinds(r.effects)).toEqual(["clearSave"]);
  });
});

describe("presentation machine — deal animation", () => {
  it("single human: shuffles, schedules a reveal per card + a dealDone tail", () => {
    const s = auth({
      players: [human({ hand: [1, 2, 3] }), ai({ hand: [1, 2, 3] })],
      phase: "drawing",
      cur: 0,
    });
    const r = step(freshPresentation(), s, { t: "dealStart" })!;
    expect(r.pres.viewPhase).toBe("dealing");
    expect(r.effects[0]).toEqual({ e: "sound", snd: "shuffle" });
    const sch = scheduled(r.effects);
    // 2 dealt players × 3 cards = 6 reveals, then one dealDone.
    expect(sch.filter((e) => e.ev.t === "dealReveal")).toHaveLength(6);
    const done = sch.find((e) => e.ev.t === "dealDone")!;
    expect(done.ms).toBe(TIMING.dealFirst + 6 * TIMING.dealStep + TIMING.dealTail);
  });

  it("multiple humans: covers the deal instead of animating it", () => {
    const s = auth({
      players: [human({ hand: [1, 2, 3] }), human({ name: "P2", hand: [1, 2, 3] })],
      phase: "drawing",
      cur: 0,
    });
    const r = step(freshPresentation(), s, { t: "dealStart" })!;
    expect(r.pres.viewPhase).toBe("cover");
    expect(r.effects).toEqual([]);
  });

  it("dealReveal advances the counter; dealDone clears the view and advances", () => {
    const rev = step({ ...freshPresentation(), viewPhase: "dealing" }, auth({}), {
      t: "dealReveal",
      k: 4,
    })!;
    expect(rev.pres.dealReveal).toBe(4);
    const done = step({ ...freshPresentation(), viewPhase: "dealing" }, auth({}), {
      t: "dealDone",
    })!;
    expect(done.pres.viewPhase).toBeNull();
    expect(done.effects).toEqual([{ e: "now", ev: { t: "advance" } }]);
  });
});

describe("presentation machine — AI turn beats", () => {
  const twoAI = auth({
    players: [human(), ai()],
    phase: "drawing",
    cur: 1,
    deck: [{ id: "d" }] as GameState["deck"],
  });

  it("runAI plans the AI's turn and emits one of the two valid beat sequences", () => {
    // Use a real dealt state so aiTurnActions runs the genuine reducer. The
    // knock-vs-draw *decision* is aiTurnActions' job (tested in the engine); here
    // we only assert the machine turns either choice into the right beats.
    let s = createGameState(
      [
        { id: "p0", name: "You", isAI: false, avatarKey: "ranger" },
        {
          id: "p1",
          name: "Bot",
          isAI: true,
          avatarKey: "ranger",
          traits: { bluff: 3, memory: 3, patience: 3, aggression: 3, risk: 3 },
        },
      ],
      DEFAULT_OPTIONS,
    );
    s = applyAction(s, { type: "deal" });
    // Point the machine at the AI seat mid-draw.
    s = { ...s, cur: 1, phase: "drawing" } as GameState;
    const r = step(freshPresentation(), s, { t: "runAI" })!;
    expect(r.pres.aiActions).not.toBeNull();
    expect(r.pres.aiIdx).toBe(1);
    const sch = scheduled(r.effects);
    if (r.effects.some((e) => e.e === "dispatch")) {
      // Draw path: dispatch the draw now, schedule the discard beat.
      expect(sch).toContainEqual({
        e: "schedule",
        ms: TIMING.aiDrawToDiscard,
        ev: { t: "aiStep2" },
      });
    } else {
      // Knock path: announce, schedule the knock commit.
      expect(r.effects).toContainEqual({ e: "sound", snd: "knock" });
      expect(sch).toContainEqual({
        e: "schedule",
        ms: TIMING.knockBeat,
        ev: { t: "aiKnockCommit" },
      });
    }
  });

  it("runAI is a no-op when it's not a drawing phase", () => {
    expect(
      step(freshPresentation(), auth({ phase: "discarding", players: [human(), ai()], cur: 1 }), {
        t: "runAI",
      }),
    ).toBeNull();
  });

  it("aiStep2 holds on the AI seat and schedules the release; aiStep3 releases and advances", () => {
    const withActions: Presentation = {
      ...freshPresentation(),
      aiIdx: 1,
      aiActions: [{ type: "drawDeck" }, { type: "discard", cardId: "x" }],
    };
    const s2 = step(withActions, twoAI, { t: "aiStep2" })!;
    expect(s2.pres.holdCur).toBe(1);
    expect(scheduled(s2.effects)).toContainEqual({
      e: "schedule",
      ms: TIMING.aiDiscardHold,
      ev: { t: "aiStep3" },
    });
    const s3 = step(s2.pres, twoAI, { t: "aiStep3" })!;
    expect(s3.pres.holdCur).toBeNull();
    expect(s3.effects).toEqual([{ e: "now", ev: { t: "advance" } }]);
  });

  it("aiStep2 is a no-op without planned actions (stale beat)", () => {
    expect(step(freshPresentation(), twoAI, { t: "aiStep2" })).toBeNull();
  });
});

describe("presentation machine — human actions", () => {
  const myTurn = auth({
    players: [
      human({
        hand: [
          { id: "a", rank: "2", suit: "clubs" },
          { id: "b", rank: "3", suit: "clubs" },
          { id: "c", rank: "4", suit: "clubs" },
        ],
      }),
      ai(),
    ],
    phase: "drawing",
    cur: 0,
    discard: [{ id: "z", rank: "9", suit: "clubs" }] as GameState["discard"],
  });

  it("drawDeck dispatches the draw and clears any selection", () => {
    const r = step({ ...freshPresentation(), selected: 2 }, myTurn, { t: "drawDeck" })!;
    expect(r.pres.selected).toBeNull();
    expect(r.effects).toContainEqual({ e: "dispatch", action: { type: "drawDeck" } });
  });

  it("drawDeck is a no-op while committing, out of phase, or on the AI's turn", () => {
    expect(
      step({ ...freshPresentation(), committing: true }, myTurn, { t: "drawDeck" }),
    ).toBeNull();
    expect(
      step(freshPresentation(), auth({ ...myTurn, phase: "discarding" }), { t: "drawDeck" }),
    ).toBeNull();
    expect(
      step(freshPresentation(), auth({ players: [human(), ai()], cur: 1, phase: "drawing" }), {
        t: "drawDeck",
      }),
    ).toBeNull();
  });

  it("drawDiscard is a no-op when the discard pile is empty", () => {
    expect(
      step(freshPresentation(), auth({ ...myTurn, discard: [] }), { t: "drawDiscard" }),
    ).toBeNull();
  });

  it("select toggles the chosen card during the discard phase", () => {
    const disc = auth({ ...myTurn, phase: "discarding" });
    const on = step(freshPresentation(), disc, { t: "select", idx: 1 })!;
    expect(on.pres.selected).toBe(1);
    const off = step(on.pres, disc, { t: "select", idx: 1 })!;
    expect(off.pres.selected).toBeNull();
  });

  it("confirmDiscard dispatches the discard by id then advances", () => {
    const disc = auth({ ...myTurn, phase: "discarding" });
    const r = step({ ...freshPresentation(), selected: 0 }, disc, { t: "confirmDiscard" })!;
    expect(r.effects).toContainEqual({ e: "dispatch", action: { type: "discard", cardId: "a" } });
    expect(r.effects).toContainEqual({ e: "now", ev: { t: "advance" } });
  });

  it("confirmDiscard is a no-op with nothing selected", () => {
    expect(
      step(freshPresentation(), auth({ ...myTurn, phase: "discarding" }), { t: "confirmDiscard" }),
    ).toBeNull();
  });

  it("knock locks input, announces, and schedules the commit beat", () => {
    const r = step(freshPresentation(), myTurn, { t: "knock" })!;
    expect(r.pres.committing).toBe(true);
    expect(r.pres.status).toMatch(/knocks/);
    expect(scheduled(r.effects)).toContainEqual({
      e: "schedule",
      ms: TIMING.knockBeat,
      ev: { t: "knockCommit" },
    });
  });

  it("knock is a no-op once someone has already knocked", () => {
    expect(step(freshPresentation(), auth({ ...myTurn, knocker: 1 }), { t: "knock" })).toBeNull();
  });

  it("knockCommit dispatches the knock then advances", () => {
    const r = step({ ...freshPresentation(), committing: true }, myTurn, { t: "knockCommit" })!;
    expect(r.effects).toEqual([
      { e: "dispatch", action: { type: "knock" } },
      { e: "now", ev: { t: "advance" } },
    ]);
  });
});

describe("presentation machine — cover & next deal", () => {
  it("coverReady lifts the cover only when it's up", () => {
    expect(step(freshPresentation(), auth({}), { t: "coverReady" })).toBeNull();
    const r = step({ ...freshPresentation(), viewPhase: "cover" }, auth({}), { t: "coverReady" })!;
    expect(r.pres.viewPhase).toBeNull();
  });

  it("nextDeal dispatches nextDeal then re-reads state; game over clears the view", () => {
    const de = auth({ phase: "dealEnd", players: [human(), ai()] });
    const r = step(freshPresentation(), de, { t: "nextDeal" })!;
    expect(r.effects).toEqual([
      { e: "dispatch", action: { type: "nextDeal" } },
      { e: "now", ev: { t: "afterNextDeal" } },
    ]);
    // afterNextDeal on a fresh deal → start the next deal presentation.
    const cont = step(freshPresentation(), auth({ phase: "drawing", players: [human(), ai()] }), {
      t: "afterNextDeal",
    })!;
    expect(cont.effects).toEqual([{ e: "now", ev: { t: "dealStart" } }]);
    // afterNextDeal at game over → just clear the view.
    const over = step(freshPresentation(), auth({ phase: "gameOver", players: [human(), ai()] }), {
      t: "afterNextDeal",
    })!;
    expect(over.pres.viewPhase).toBeNull();
    expect(over.effects).toEqual([]);
  });

  it("nextDeal is a no-op when not at the deal-end screen", () => {
    expect(
      step(freshPresentation(), auth({ phase: "drawing", players: [human(), ai()] }), {
        t: "nextDeal",
      }),
    ).toBeNull();
  });
});

describe("presentation machine — purity", () => {
  it("never mutates the input overlay", () => {
    const before = freshPresentation();
    const snapshot = JSON.stringify(before);
    step(before, auth({ players: [human(), ai()], cur: 1, phase: "drawing" }), { t: "advance" });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
