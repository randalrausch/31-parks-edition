/**
 * Shared, pure request-sanitization for the `create` op — the ONE place both
 * authorities (the Supabase Edge Function and the Azure Functions app) turn an
 * untrusted client `config` into the seats/players/options a new game starts
 * with. Previously each backend carried its own copy of this logic; keeping two
 * hand-maintained copies in sync was the single biggest source of parity drift
 * (see docs/ARCHITECTURE.md). Now there is one implementation, bundled into the
 * Edge Function via edgeEntry and imported directly by Azure.
 *
 * Everything here is pure and framework-free, exactly like the rest of the core.
 */
import type { GameOptions } from "./engine";
import type { NewGamePlayer } from "./actions";

/** Public, client-visible seat summary written to the lobby record (no cards). */
export interface SeatSetup {
  idx: number;
  name: string | null;
  avatar: string;
  emoji?: string | null;
  isAI: boolean;
  filled: boolean;
}

/** The untrusted shape a client sends with `{ op: "create", config }`. */
export interface CreateConfigInput {
  creatorName?: unknown;
  humans?: unknown;
  ai?: {
    name?: unknown;
    avatarKey?: unknown;
    traits?: unknown;
    emoji?: unknown;
    image?: unknown;
  }[];
  options?: unknown;
}

const TRAIT_KEYS = ["bluff", "memory", "patience", "aggression", "risk"] as const;
/** Boolean options that default to false — an explicit `true` turns them on. */
const BOOL_OPTS = [
  "threeOfAKind",
  "grace",
  "knockPenalty",
  "sound",
  "fullHistory",
] as const;

/** Trim + cap a client string; fall back when empty/absent. */
export const clampName = (s: unknown, fallback: string): string =>
  (typeof s === "string" ? s.trim().slice(0, 40) : "") || fallback;

/** Accept only a short slug-like avatar key; otherwise fall back. */
export const clampKey = (s: unknown, fallback: string): string =>
  typeof s === "string" && /^[a-z0-9-]{1,32}$/.test(s) ? s : fallback;

/** Bound an optional image URL length (undefined if absent/oversized). */
export const clampImage = (s: unknown): string | undefined =>
  typeof s === "string" && s.length <= 512 ? s : undefined;

/** Coerce client traits into 1–5 integers, defaulting missing ones to 3. */
export function clampTraits(t: unknown): Record<string, number> | undefined {
  if (!t || typeof t !== "object") return undefined;
  const src = t as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of TRAIT_KEYS) {
    const v = Number(src[k]);
    out[k] = Number.isFinite(v) ? Math.max(1, Math.min(5, Math.round(v))) : 3;
  }
  return out;
}

/**
 * Whitelist client options into a full, trusted GameOptions. Unknown fields are
 * dropped; the action feed shows by default (only an explicit `false` hides it).
 */
export function sanitizeOptions(o: unknown): GameOptions {
  const src = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const k of BOOL_OPTS) out[k] = src[k] === true;
  out.showLog = src.showLog !== false;
  return out as unknown as GameOptions;
}

/** The clamped seats + players + options a new game is created from. */
export interface CreateSetup {
  players: NewGamePlayer[];
  seats: SeatSetup[];
  options: GameOptions;
  humans: number;
  aiCount: number;
}

/**
 * Turn an untrusted `create` config into the exact seats/players/options both
 * backends build a fresh game from — 31 seats at most 8 players, AI capped to
 * the seats humans don't take, every client string clamped so a malicious
 * caller can't balloon the persisted state.
 */
export function buildCreateSetup(config: CreateConfigInput): CreateSetup {
  const humans = Math.max(1, Math.min(8, Number(config.humans) | 0));
  const ai = (Array.isArray(config.ai) ? config.ai : []).slice(
    0,
    Math.max(0, 8 - humans),
  );

  const players: NewGamePlayer[] = [];
  const seats: SeatSetup[] = [];
  for (let i = 0; i < humans; i++) {
    const isCreator = i === 0;
    const name = isCreator
      ? clampName(config.creatorName, "Player 1")
      : `Player ${i + 1}`;
    players.push({ id: `p${i}`, name, isAI: false, avatarKey: "ranger" });
    seats.push({
      idx: i,
      name: isCreator ? name : null,
      avatar: "ranger",
      isAI: false,
      filled: isCreator,
    });
  }
  ai.forEach((c, j) => {
    const idx = humans + j;
    const aiName = clampName(c.name, `Bot ${j + 1}`);
    const avatar = clampKey(c.avatarKey, "ranger");
    const emoji = typeof c.emoji === "string" ? c.emoji.slice(0, 8) : undefined;
    players.push({
      id: `p${idx}`,
      name: aiName,
      isAI: true,
      avatarKey: avatar,
      traits: clampTraits(c.traits) as NewGamePlayer["traits"],
      emoji,
      image: clampImage(c.image),
    });
    seats.push({ idx, name: aiName, avatar, emoji, isAI: true, filled: true });
  });

  return {
    players,
    seats,
    options: sanitizeOptions(config.options),
    humans,
    aiCount: ai.length,
  };
}
