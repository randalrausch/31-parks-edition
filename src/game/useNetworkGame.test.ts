// @vitest-environment happy-dom
/**
 * Hook-level tests for useNetworkGame — the React binding over NetworkTransport.
 * The transport itself is integration-tested elsewhere (multiplayerIntegration);
 * here we mock the backend and drive the REAL transport through it to pin what
 * the hook exposes to the board: the live snapshot, link status, the terminal
 * "outdated" state, the transient action-error surface (including the lost-race
 * hint), a fatal connect error, and clean unmount teardown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { BackendError } from "./gameApi";
import { NetworkTransport } from "./networkTransport";
import type { GameAction } from "./actions";

// A controllable fake backend, injected in place of the env-selected one.
const ctl = vi.hoisted(() => ({
  state: vi.fn(),
  act: vi.fn(),
  onChange: null as null | (() => void),
  onStatus: null as null | ((live: boolean) => void),
}));

vi.mock("./backend", () => ({
  activeBackend: {
    name: "fake",
    api: {
      create: vi.fn(),
      join: vi.fn(),
      start: vi.fn(),
      act: (...a: unknown[]) => ctl.act(...a),
      state: (...a: unknown[]) => ctl.state(...a),
    },
    subscribe: (_gameId: string, onChange: () => void, onStatus: (live: boolean) => void) => {
      ctl.onChange = onChange;
      ctl.onStatus = onStatus;
      return () => {};
    },
  },
}));

// Imported AFTER the mock so it binds the fake activeBackend.
const { useNetworkGame } = await import("./useNetworkGame");

const snapshot = (over = false) => ({
  status: over ? "over" : "playing",
  version: 1,
  seats: [],
  seatIndex: 0,
  state: { phase: over ? "gameOver" : "drawing" },
});

beforeEach(() => {
  ctl.state.mockReset().mockResolvedValue(snapshot());
  ctl.act.mockReset().mockResolvedValue(undefined);
  ctl.onChange = null;
  ctl.onStatus = null;
});
afterEach(() => cleanup());

/** Fire a sync action and flush the microtasks its fire-and-forget catch schedules. */
async function flush(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useNetworkGame", () => {
  it("connects on mount and exposes the initial snapshot", async () => {
    const { result } = renderHook(() => useNetworkGame("g1", "tok"));
    await waitFor(() => expect(result.current.snap).not.toBeNull());
    expect(result.current.snap?.version).toBe(1);
    expect(result.current.error).toBeNull();
    expect(ctl.state).toHaveBeenCalledWith("g1", "tok");
  });

  it("reflects link status changes from the transport", async () => {
    const { result } = renderHook(() => useNetworkGame("g1", "tok"));
    await waitFor(() => expect(result.current.snap).not.toBeNull());
    expect(result.current.connected).toBe(true);
    act(() => ctl.onStatus?.(false));
    expect(result.current.connected).toBe(false);
    act(() => ctl.onStatus?.(true));
    expect(result.current.connected).toBe(true);
  });

  it("goes terminal-outdated when the server reports a newer protocol (426)", async () => {
    ctl.state.mockRejectedValue(new BackendError("update", 426, false, true));
    const { result } = renderHook(() => useNetworkGame("g1", "tok"));
    await waitFor(() => expect(result.current.outdated).toBe(true));
  });

  it("surfaces a lost-race conflict as a dismissible action error", async () => {
    const { result } = renderHook(() => useNetworkGame("g1", "tok"));
    await waitFor(() => expect(result.current.snap).not.toBeNull());

    // The next act loses the CAS (409). The transport resyncs, then reports the
    // dropped move; the hook turns it into the "table changed" hint.
    ctl.act.mockRejectedValueOnce(new BackendError("please retry", 409, true));
    await flush(() => result.current.act({ type: "drawDeck" } as GameAction));
    await waitFor(() => expect(result.current.actionError).toMatch(/table changed/i));

    act(() => result.current.clearActionError());
    expect(result.current.actionError).toBeNull();
  });

  it("flashes a connection hint on a generic send failure", async () => {
    const { result } = renderHook(() => useNetworkGame("g1", "tok"));
    await waitFor(() => expect(result.current.snap).not.toBeNull());

    ctl.act.mockRejectedValueOnce(new Error("network down"));
    await flush(() => result.current.act({ type: "knock" }));
    await waitFor(() => expect(result.current.actionError).toMatch(/check your connection/i));
  });

  it("reports a fatal connect failure (game gone) as a hard error", async () => {
    ctl.state.mockRejectedValue(new BackendError("That game no longer exists.", 404));
    const { result } = renderHook(() => useNetworkGame("g1", "tok"));
    await waitFor(() => expect(result.current.error).toMatch(/no longer exists/i));
    expect(result.current.snap).toBeNull();
  });

  it("tears down the transport on unmount", async () => {
    const destroy = vi.spyOn(NetworkTransport.prototype, "destroy");
    const { result, unmount } = renderHook(() => useNetworkGame("g1", "tok"));
    await waitFor(() => expect(result.current.snap).not.toBeNull());
    unmount();
    expect(destroy).toHaveBeenCalled();
    destroy.mockRestore();
  });
});
