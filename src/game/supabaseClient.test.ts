/**
 * Unit test for the Realtime resubscribe-with-backoff state machine, against a
 * minimal fake of the supabase-js channel surface + fake timers. The live path
 * (an actual dropped channel) can only be exercised against a real Supabase, so
 * this locks the logic that's otherwise unverifiable: reconnect after a drop,
 * capped backoff, ignoring superseded-channel callbacks (no reconnect loop), and
 * clean teardown on unsubscribe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subscribeToGame } from "./supabaseClient";

interface FakeChannel {
  emit: (status: string) => void;
  on: () => FakeChannel;
  subscribe: (cb: (status: string) => void) => FakeChannel;
}

function makeFakeClient() {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  const client = {
    channel() {
      let statusCb: ((s: string) => void) | null = null;
      const ch: FakeChannel = {
        on: () => ch,
        subscribe: (cb) => {
          statusCb = cb;
          return ch;
        },
        emit: (s) => statusCb?.(s),
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch: FakeChannel) {
      removed.push(ch);
    },
  };
  return { client: client as unknown as SupabaseClient, channels, removed };
}

describe("subscribeToGame (realtime resubscribe-with-backoff)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tracks link health and reconnects after a drop, ignoring the dead channel", () => {
    const { client, channels, removed } = makeFakeClient();
    const status: boolean[] = [];
    const unsub = subscribeToGame(
      client,
      "g1",
      () => {},
      (live) => status.push(live),
    );

    expect(channels.length).toBe(1);
    channels[0].emit("SUBSCRIBED");
    expect(status).toEqual([true]);

    // A drop reports "not live", tears down the dead channel, and schedules a
    // reconnect (no new channel until the backoff elapses).
    channels[0].emit("CHANNEL_ERROR");
    expect(status).toEqual([true, false]);
    expect(removed).toContain(channels[0]);
    expect(channels.length).toBe(1);

    // After the backoff a fresh channel is created and can go live again.
    vi.advanceTimersByTime(2000);
    expect(channels.length).toBe(2);
    channels[1].emit("SUBSCRIBED");
    expect(status).toEqual([true, false, true]);

    // A late callback from the superseded channel is ignored — no loop, no flap.
    channels[0].emit("CLOSED");
    expect(status).toEqual([true, false, true]);

    unsub();
    expect(removed).toContain(channels[1]);
  });

  it("stops reconnecting after unsubscribe", () => {
    const { client, channels } = makeFakeClient();
    const unsub = subscribeToGame(
      client,
      "g1",
      () => {},
      () => {},
    );
    channels[0].emit("SUBSCRIBED");
    unsub();
    channels[0].emit("CHANNEL_ERROR"); // disposed → ignored
    vi.advanceTimersByTime(60_000);
    expect(channels.length).toBe(1); // no new channel ever created
  });
});
