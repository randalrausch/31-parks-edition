/**
 * NetworkTransport — drives an online game over a provider-agnostic GameBackend.
 *
 * Reads: subscribes to the backend's change pings, then re-fetches the per-seat
 * *redacted* state via the backend API (the wire never carries another player's
 * cards), plus a safety-net poll. Writes: submits actions through the backend's
 * `act` op; after a successful own action it refetches immediately rather than
 * waiting for a ping.
 *
 * It depends only on the GameBackend interface (see backend.ts), so swapping the
 * provider (Supabase → Azure, etc.) needs no change here. Lifecycle differs from
 * LocalTransport (games are created/joined via the lobby API, not `start`), so
 * this exposes connect()/getState()/subscribe()/act()/destroy().
 */
import type { GameAction } from "./actions";
import type { GameState } from "./engine";
import type { SeatInfo } from "./supabaseClient";
import type { GameBackend } from "./backend";
import { dlog } from "./debug";

export interface NetworkSnapshot {
  status: string;
  version: number;
  seats: SeatInfo[];
  seatIndex: number | null;
  state: GameState;
}

export class NetworkTransport {
  private unsubscribe: (() => void) | null = null;
  private snap: NetworkSnapshot | null = null;
  private listeners = new Set<(s: NetworkSnapshot) => void>();
  private statusListeners = new Set<(live: boolean) => void>();
  private linkLive = true;
  private lastVersion = -1;
  private fetching = false;
  private refetchQueued = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Poll interval (ms) as a safety net under Realtime. Realtime delivery is
   * best-effort — a dropped change event would otherwise leave a waiting player
   * stuck forever (each side "waiting for the other"). A modest poll guarantees
   * everyone converges within a few seconds even if a ping is missed. refresh()
   * is version-gated and deduped, so an unchanged poll is cheap.
   */
  private static readonly POLL_MS = 4000;

  constructor(
    private backend: GameBackend,
    readonly gameId: string,
    readonly seatToken: string,
  ) {}

  getState(): GameState | null {
    return this.snap?.state ?? null;
  }
  /** The seat (player id) this client controls, e.g. "p2". */
  get seatId(): string | null {
    return this.snap?.seatIndex != null ? `p${this.snap.seatIndex}` : null;
  }

  subscribe(listener: (s: NetworkSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    if (this.snap) for (const l of this.listeners) l(this.snap);
  }

  /** Subscribe to link health (true = synced, false = trying to reconnect). */
  onStatus(listener: (live: boolean) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.linkLive); // prime with the current value
    return () => this.statusListeners.delete(listener);
  }
  private setLink(live: boolean) {
    if (this.linkLive === live) return;
    this.linkLive = live;
    dlog("net", `link ${live ? "live" : "lost"}`);
    for (const l of this.statusListeners) l(live);
  }

  /**
   * Fetch the latest redacted snapshot. Concurrent calls are coalesced, but a
   * refresh requested while one is in flight schedules exactly one more after it
   * — so a post-action refresh is never dropped (which would leave the UI showing
   * stale state even though the action applied).
   */
  async refresh(): Promise<void> {
    if (this.fetching) {
      this.refetchQueued = true;
      return;
    }
    this.fetching = true;
    try {
      const snap = await this.backend.api.state(this.gameId, this.seatToken);
      // Ignore stale fetches that arrive out of order.
      if (snap.version >= this.lastVersion) {
        const changed = snap.version !== this.lastVersion;
        this.lastVersion = snap.version;
        this.snap = snap;
        this.emit();
        if (changed) dlog("net", `snapshot v${snap.version}`, snap.state.phase);
      }
      this.setLink(true); // a successful fetch means we're synced
    } catch (e) {
      dlog("net", "refresh failed", (e as Error).message);
      this.setLink(false); // couldn't reach the server — show "reconnecting"
      throw e;
    } finally {
      this.fetching = false;
      if (this.refetchQueued) {
        this.refetchQueued = false;
        void this.refresh();
      }
    }
  }

  /** Begin syncing: initial fetch + backend change subscription + safety poll. */
  async connect(): Promise<void> {
    await this.refresh();
    // The backend's change subscription (Realtime on Supabase; possibly a no-op
    // elsewhere). Push health feeds the "reconnecting" indicator; on (re)connect
    // we refetch to catch anything missed.
    this.unsubscribe = this.backend.subscribe(
      this.gameId,
      () => void this.refresh(),
      (live) => {
        this.setLink(live);
        if (live) void this.refresh();
      },
    );
    // Safety-net poll in case a change event is dropped (or push isn't offered).
    this.pollTimer = setInterval(
      () => void this.refresh(),
      NetworkTransport.POLL_MS,
    );
  }

  async act(action: GameAction): Promise<void> {
    dlog("net", `act ${action.type}`);
    try {
      await this.backend.api.act(this.gameId, this.seatToken, action);
    } catch (e) {
      const msg = (e as Error).message;
      // A version conflict (concurrent/duplicate submit) is recoverable: the
      // authority already moved, so resync to the truth instead of erroring.
      if (/\bretry\b/i.test(msg)) {
        dlog("net", `act ${action.type} conflict — resyncing`);
        await this.refresh();
        return;
      }
      dlog("net", `act ${action.type} failed`, msg);
      throw e;
    }
    await this.refresh(); // don't wait for the ping round-trip
  }
  async nextDeal(): Promise<void> {
    await this.act({ type: "nextDeal" });
  }

  destroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
    this.statusListeners.clear();
    this.snap = null;
  }
}
