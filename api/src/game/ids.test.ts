import { describe, it, expect } from "vitest";
import { makeCode, newToken } from "./ids.js";

describe("ids", () => {
  it("makeCode is 5 chars from the no-ambiguous alphabet", () => {
    const allowed = /^[A-HJ-NP-Z2-9]{5}$/; // excludes I, O, 0, 1
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const c = makeCode();
      expect(c).toMatch(allowed);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(900); // overwhelmingly unique
  });

  it("newToken returns a v4 UUID", () => {
    expect(newToken()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
