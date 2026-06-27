/**
 * NetworkTransport — drives an online game over Supabase.
 *
 * Reads: subscribes to Realtime on the public `games` row as a "something
 * changed" ping, then re-fetches the per-seat *redacted* state via the Edge
 * Function (the wire never carries another player's cards). Writes: submits
 * actions through the function's `act` / `nextDeal` ops. After a successful own
 * action it refetches immediately for snappiness rather than waiting for the
 * ping.
 *
 * Lifecycle differs from LocalTransport (games are created/joined via the lobby
 * API, not `start`), so this exposes connect()/getState()/subscribe()/act()/
 * destroy() — the pieces a network game hook consumes.
 */
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type { GameAction } from "./actions";
import type { GameState } from "./engine";
import { makeGameApi, type GameApi, type SeatInfo } from "./supabaseClient";

export interface NetworkSnapshot {
  status: string;
  version: number;
  seats: SeatInfo[];
  seatIndex: number | null;
  state: GameState;
}

export class NetworkTransport {
  private api: GameApi;
  private channel: RealtimeChannel | null = null;
  private snap: NetworkSnapshot | null = null;
  private listeners = new Set<(s: NetworkSnapshot) => void>();
  private lastVersion = -1;
  private fetching = false;

  constructor(
    private client: SupabaseClient,
    readonly gameId: string,
    readonly seatToken: string,
  ) {
    this.api = makeGameApi(client);
  }

  getSnapshot() {
    return this.snap;
  }
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

  /** Fetch the latest redacted snapshot (deduped against concurrent calls). */
  async refresh(): Promise<void> {
    if (this.fetching) return;
    this.fetching = true;
    try {
      const snap = await this.api.state(this.gameId, this.seatToken);
      // Ignore stale fetches that arrive out of order.
      if (snap.version >= this.lastVersion) {
        this.lastVersion = snap.version;
        this.snap = snap;
        this.emit();
      }
    } finally {
      this.fetching = false;
    }
  }

  /** Begin syncing: initial fetch + Realtime change pings. */
  async connect(): Promise<void> {
    await this.refresh();
    // Unique topic per transport instance so multiple transports never collide
    // on a shared client (each device normally has its own client anyway).
    this.channel = this.client
      .channel(`game:${this.gameId}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter: `id=eq.${this.gameId}`,
        },
        () => void this.refresh(),
      )
      .subscribe();
  }

  async act(action: GameAction): Promise<void> {
    await this.api.act(this.gameId, this.seatToken, action);
    await this.refresh(); // don't wait for the ping round-trip
  }
  async nextDeal(): Promise<void> {
    await this.act({ type: "nextDeal" });
  }

  destroy(): void {
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = null;
    this.listeners.clear();
    this.snap = null;
  }
}
