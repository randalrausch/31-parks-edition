/**
 * A small easter egg: the game recognizes one friend's birthday and greets
 * them on the board that day. Purely a client-side visual touch — it's not a
 * `GameOption`, isn't sent over the wire, and never affects rules or scoring.
 */
export const BIRTHDAY = {
  name: "Dan",
  /** 1-indexed, matching Date#getMonth() + 1. */
  month: 7,
  day: 8,
} as const;

export function isBirthdayToday(now: Date = new Date()): boolean {
  return now.getMonth() + 1 === BIRTHDAY.month && now.getDate() === BIRTHDAY.day;
}
