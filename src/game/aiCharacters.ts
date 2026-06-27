/**
 * AI opponent characters. Each has flavor (home park, personality, playing
 * style, catch phrase) and a 1–5 trait profile that drives its actual play via
 * the mappings in engine.ts (see aiKnockTarget / aiBluffChance / etc.).
 */
import type { AITraits } from "./engine";

export interface AICharacter {
  id: string;
  name: string;
  emoji: string;
  homePark: string;
  personality: string;
  style: string;
  catchPhrase: string;
  traits: AITraits;
}

export const AI_CHARACTERS: AICharacter[] = [
  {
    id: "prairie-rose",
    name: "Prairie Rose",
    emoji: "🌼",
    homePark: "Theodore Roosevelt",
    personality: "Cheerful, optimistic, always encourages everyone.",
    style: "Patient. Rarely knocks before 28. Likes to build strong hands.",
    catchPhrase: "The prairie rewards patience.",
    traits: { bluff: 1, memory: 2, patience: 5, aggression: 2, risk: 1 },
  },
  {
    id: "bison-bill",
    name: "Bison Bill",
    emoji: "🦬",
    homePark: "Yellowstone",
    personality: "Slow, steady, impossible to rattle.",
    style:
      "Conservative. Keeps improving until he has a solid hand. Almost never bluffs.",
    catchPhrase: "No need to rush.",
    traits: { bluff: 1, memory: 3, patience: 5, aggression: 2, risk: 2 },
  },
  {
    id: "coyote-cody",
    name: "Coyote Cody",
    emoji: "🐺",
    homePark: "Badlands",
    personality: "Clever prankster who loves taking chances.",
    style: "Aggressive. Knocks early, bluffs often, unpredictable.",
    catchPhrase: "Sometimes luck favors the bold.",
    traits: { bluff: 5, memory: 2, patience: 1, aggression: 5, risk: 5 },
  },
  {
    id: "half-dome-hank",
    name: "Half Dome Hank",
    emoji: "🏔",
    homePark: "Yosemite",
    personality: "Confident climber who thinks every hand can be improved.",
    style: "Greedy. Chases 30 and 31 longer than he should.",
    catchPhrase: "Just one more draw…",
    traits: { bluff: 2, memory: 3, patience: 2, aggression: 4, risk: 5 },
  },
  {
    id: "badlands-becky",
    name: "Badlands Becky",
    emoji: "🌄",
    homePark: "Theodore Roosevelt",
    personality: "Tough, adaptable, doesn't mind rough terrain.",
    style:
      "Flexible. Switches suits more often than others when chances appear.",
    catchPhrase: "Plans are made to change.",
    traits: { bluff: 2, memory: 4, patience: 3, aggression: 3, risk: 3 },
  },
  {
    id: "paula-pine",
    name: "Paula Pine",
    emoji: "🌲",
    homePark: "Glacier",
    personality: "Calm, thoughtful, quietly observant.",
    style:
      "Analytical. Watches every discard and adjusts. Rarely wastes a turn.",
    catchPhrase: "The cards always tell a story.",
    traits: { bluff: 1, memory: 5, patience: 5, aggression: 2, risk: 2 },
  },
  {
    id: "ranger-rick",
    name: "Ranger Rick",
    emoji: "🧭",
    homePark: "Yellowstone",
    personality: "Friendly teacher who plays by the book.",
    style: "Balanced. Fundamentally sound decisions with very few mistakes.",
    catchPhrase: "Play smart. Leave no trace.",
    traits: { bluff: 2, memory: 4, patience: 4, aggression: 3, risk: 3 },
  },
  {
    id: "summit-sam",
    name: "Summit Sam",
    emoji: "⛰️",
    homePark: "Glacier",
    personality: "Competitive adventurer who always aims for the top.",
    style: "High risk. Will chase 31 even when it isn't mathematically ideal.",
    catchPhrase: "Go big or hike home.",
    traits: { bluff: 2, memory: 3, patience: 1, aggression: 5, risk: 5 },
  },
  {
    id: "naturalist-nora",
    name: "Naturalist Nora",
    emoji: "🔍",
    homePark: "Acadia",
    personality: "Curious scientist who notices every little detail.",
    style: "Memory expert. Tracks discards exceptionally well; very informed.",
    catchPhrase: "Nature has patterns. So do cards.",
    traits: { bluff: 1, memory: 5, patience: 4, aggression: 3, risk: 2 },
  },
  {
    id: "backcountry-ben",
    name: "Backcountry Ben",
    emoji: "🎒",
    homePark: "Glacier",
    personality: "Quiet wilderness guide who thrives under pressure.",
    style:
      "Clutch. Cautious early, far more aggressive when down to his last token.",
    catchPhrase: "The best trails aren't the easy ones.",
    traits: { bluff: 3, memory: 4, patience: 4, aggression: 5, risk: 4 },
  },
];

export const TRAIT_KEYS: (keyof AITraits)[] = [
  "bluff",
  "memory",
  "patience",
  "aggression",
  "risk",
];

export const CHARACTERS_BY_ID: Record<string, AICharacter> = Object.fromEntries(
  AI_CHARACTERS.map((c) => [c.id, c]),
);
