import { describe, expect, it } from "vitest";
import { isBirthdayToday } from "./birthday";

describe("isBirthdayToday", () => {
  it("is true on July 8th, any year", () => {
    expect(isBirthdayToday(new Date(2026, 6, 8))).toBe(true);
    expect(isBirthdayToday(new Date(2031, 6, 8))).toBe(true);
  });

  it("is false on any other day", () => {
    expect(isBirthdayToday(new Date(2026, 6, 7))).toBe(false);
    expect(isBirthdayToday(new Date(2026, 6, 9))).toBe(false);
    expect(isBirthdayToday(new Date(2026, 0, 8))).toBe(false);
  });
});
