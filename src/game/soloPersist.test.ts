import { describe, it, expect, beforeEach } from "vitest";
import {
  saveSolo,
  loadSolo,
  clearSolo,
  soloResumeCrashed,
  markSoloResuming,
  clearSoloResuming,
} from "./soloPersist";
import type { GameState } from "./engine";

// Minimal storage stub (the vitest env is node, which has none).
function makeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    api: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  };
}
function installStorage() {
  const local = makeStorage();
  const session = makeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = local.api;
  (globalThis as { sessionStorage?: unknown }).sessionStorage = session.api;
  return local.map;
}

// A structurally-plausible solo snapshot (loadSolo now validates shape).
const fakeState = {
  phase: "drawing",
  cur: 0,
  players: [{ id: "p0", hand: [], tokens: 3 }],
  deck: [],
  discard: [],
  dealNum: 1,
  options: {},
} as unknown as GameState;

describe("soloPersist", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });

  it("round-trips a saved state", () => {
    saveSolo(fakeState);
    expect(loadSolo()).toEqual(fakeState);
  });

  it("returns null when nothing is saved", () => {
    expect(loadSolo()).toBeNull();
  });

  it("clearSolo removes the save", () => {
    saveSolo(fakeState);
    clearSolo();
    expect(loadSolo()).toBeNull();
  });

  it("discards a snapshot written under a different save version", () => {
    // Simulate an older save schema.
    store.set("parks31.solo", JSON.stringify({ v: 0, state: fakeState }));
    expect(loadSolo()).toBeNull();
    // and it's cleared, not left to trip up a later read
    expect(store.has("parks31.solo")).toBe(false);
  });

  it("discards a corrupt (unparseable) snapshot without throwing", () => {
    store.set("parks31.solo", "{not json");
    expect(loadSolo()).toBeNull();
  });

  it("discards a structurally-implausible snapshot (right version, wrong shape)", () => {
    // Same SAVE_VERSION but a shape the engine/board can't read (no players) —
    // exactly what an engine change without a SAVE_VERSION bump could produce.
    store.set("parks31.solo", JSON.stringify({ v: 1, state: { phase: "drawing", cur: 0 } }));
    expect(loadSolo()).toBeNull();
    expect(store.has("parks31.solo")).toBe(false);
  });

  it("resume guard: set survives, then clears", () => {
    expect(soloResumeCrashed()).toBe(false);
    markSoloResuming();
    expect(soloResumeCrashed()).toBe(true);
    clearSoloResuming();
    expect(soloResumeCrashed()).toBe(false);
  });

  it("resume guard is a no-op (no throw) when sessionStorage is unavailable", () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(() => markSoloResuming()).not.toThrow();
    expect(soloResumeCrashed()).toBe(false);
    expect(() => clearSoloResuming()).not.toThrow();
  });

  it("save is a no-op (no throw) when localStorage is unavailable", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => saveSolo(fakeState)).not.toThrow();
    expect(loadSolo()).toBeNull();
  });
});
