/**
 * Client-side sound on/off preference.
 *
 * Unlike the other House Rules, whether sound effects play is NOT part of
 * `GameOptions` — it's a per-device preference, so each player can mute or
 * unmute their own browser mid-game without touching anyone else's table.
 * Persisted to localStorage (defaults to OFF) so it carries across reloads
 * and future games.
 */
import { useEffect, useState } from "react";

const KEY = "parks31.sound";

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let cached = readStored();
const listeners = new Set<() => void>();

function setStored(v: boolean) {
  if (v === cached) return;
  cached = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* storage unavailable — keep the in-memory choice */
  }
  listeners.forEach((l) => l());
}

/** Non-hook read for imperative code (e.g. gating a sound effect call from
 * outside React render, where a stale hook closure would otherwise apply). */
export function isSoundEnabled(): boolean {
  return cached;
}

/** Reactive access + setter, shared across every component that calls it. */
export function useSoundEnabled(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(cached);
  useEffect(() => {
    const l = () => setOn(cached);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return [on, setStored];
}
