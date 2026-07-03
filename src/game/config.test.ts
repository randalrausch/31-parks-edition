import { describe, it, expect } from "vitest";
import { sanitizeOptions } from "./config";
import { DEFAULT_OPTIONS } from "./engine";

describe("sanitizeOptions", () => {
  it("returns the app defaults for an empty/absent config", () => {
    // A raw API caller who sends no options must get the same game the app
    // builds — in particular grace and sound ON (they default true).
    expect(sanitizeOptions({})).toEqual(DEFAULT_OPTIONS);
    expect(sanitizeOptions(undefined)).toEqual(DEFAULT_OPTIONS);
    expect(sanitizeOptions(null)).toEqual(DEFAULT_OPTIONS);
  });

  it("lets an explicit false turn off a true-default option", () => {
    const o = sanitizeOptions({ grace: false, sound: false, showLog: false });
    expect(o.grace).toBe(false);
    expect(o.sound).toBe(false);
    expect(o.showLog).toBe(false);
  });

  it("lets an explicit true turn on a false-default option", () => {
    const o = sanitizeOptions({ threeOfAKind: true, knockPenalty: true, fullHistory: true });
    expect(o.threeOfAKind).toBe(true);
    expect(o.knockPenalty).toBe(true);
    expect(o.fullHistory).toBe(true);
  });

  it("drops unknown fields and never returns extras", () => {
    const o = sanitizeOptions({ hax: true, grace: true }) as unknown as Record<string, unknown>;
    expect("hax" in o).toBe(false);
    expect(Object.keys(o).sort()).toEqual(Object.keys(DEFAULT_OPTIONS).sort());
  });
});
