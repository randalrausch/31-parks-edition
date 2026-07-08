import { describe, it, expect } from "vitest";
import { sanitizeOptions, buildCreateSetup, clampImage, type CreateConfigInput } from "./config";
import { DEFAULT_OPTIONS } from "./engine";

describe("sanitizeOptions", () => {
  it("returns the app defaults for an empty/absent config", () => {
    // A raw API caller who sends no options must get the same game the app
    // builds — in particular grace ON (it defaults true).
    expect(sanitizeOptions({})).toEqual(DEFAULT_OPTIONS);
    expect(sanitizeOptions(undefined)).toEqual(DEFAULT_OPTIONS);
    expect(sanitizeOptions(null)).toEqual(DEFAULT_OPTIONS);
  });

  it("lets an explicit false turn off a true-default option", () => {
    const o = sanitizeOptions({ grace: false, showLog: false });
    expect(o.grace).toBe(false);
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

describe("buildCreateSetup", () => {
  it("coerces null / non-object AI entries instead of crashing", () => {
    // `ai: [null, ...]` is valid JSON a hostile client can POST; buildCreateSetup
    // must default each bogus entry, not dereference null and 500 the create op.
    const setup = buildCreateSetup({
      humans: 1,
      ai: [null, "nope", 42],
    } as unknown as CreateConfigInput);
    const bots = setup.players.filter((p) => p.isAI);
    expect(bots).toHaveLength(3);
    for (const b of bots) {
      expect(typeof b.name).toBe("string");
      expect(b.avatarKey).toBe("ranger");
    }
  });
});

describe("clampImage", () => {
  it("accepts a same-origin root-relative asset path", () => {
    expect(clampImage("/assets/chars/otter-a1b2c3.webp")).toBe("/assets/chars/otter-a1b2c3.webp");
  });

  it("rejects any URL the browser would fetch cross-origin (opponent-IP beacon)", () => {
    for (const bad of [
      "https://evil.example/pixel.gif?g=lobby",
      "http://evil.example/x.png",
      "//evil.example/x.png", // protocol-relative
      "/\\evil.example/x", // backslash-authority trick
      "/\tevil", // control-char/newline trick
      "data:image/svg+xml,<svg/>",
      "javascript:alert(1)",
    ]) {
      expect(clampImage(bad)).toBeUndefined();
    }
  });

  it("rejects oversized and non-string values", () => {
    expect(clampImage("/" + "a".repeat(600))).toBeUndefined();
    expect(clampImage(123)).toBeUndefined();
    expect(clampImage(undefined)).toBeUndefined();
  });
});
