import { describe, it, expect, beforeEach } from "vitest";
import { saveSolo, loadSolo, clearSolo } from "./soloPersist";
import type { GameState } from "./engine";

// Minimal localStorage stub (the vitest env is node, which has none).
function installStorage() {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return map;
}

const fakeState = { phase: "drawing", cur: 0 } as unknown as GameState;

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

  it("save is a no-op (no throw) when localStorage is unavailable", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => saveSolo(fakeState)).not.toThrow();
    expect(loadSolo()).toBeNull();
  });
});
