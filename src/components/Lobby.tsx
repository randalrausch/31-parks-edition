/**
 * Pre-game lobby (online). Shows the shareable room code and the seats as
 * players join in real time. The host (seat 0) can start once at least two
 * seats are filled; any unfilled human seats become AI at start.
 */
import { useEffect, useRef, useState } from "react";
import { useTheme } from "./ParkThemeProvider";
import Avatar from "./Avatar";
import { StarDivider } from "../art/Glyphs";
import type { NetworkSnapshot } from "../game/networkTransport";
import "./Lobby.css";

/**
 * Inline, host-only seat rename. Keeps a local draft so an incoming snapshot
 * (the lobby re-renders on every 4s poll / Realtime ping) can't overwrite what
 * the host is mid-typing: the draft only re-syncs to the authoritative name
 * while the field is NOT focused. Commits on blur/Enter, reverts on Escape, and
 * ignores an empty or unchanged value.
 */
function SeatNameEditor({
  idx,
  name,
  onRename,
}: {
  idx: number;
  name: string;
  onRename: (seatIndex: number, name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  // The name we just committed and are waiting for the server to echo back. While
  // set, the effect below leaves the optimistic value in place instead of briefly
  // reverting to the stale prop (which would look like the rename didn't save).
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (editing) return;
    if (pending.current !== null) {
      if (name === pending.current) pending.current = null; // server caught up
      return; // keep showing the optimistic value until it does
    }
    setDraft(name);
  }, [name, editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      setDraft(trimmed); // show it immediately; the server refresh will confirm
      pending.current = trimmed;
      onRename(idx, trimmed);
    } else {
      setDraft(name); // empty or unchanged → keep the current name
    }
  };

  return (
    <input
      className="lobby__seat-name lobby__seat-name--edit"
      value={draft}
      maxLength={14}
      aria-label={`Rename ${name}`}
      onFocus={(e) => {
        setEditing(true);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setDraft(name);
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export default function Lobby({
  snap,
  code,
  isHost,
  onStart,
  onRename,
  onLeave,
  startError,
  renameError,
}: {
  snap: NetworkSnapshot;
  code: string;
  isHost: boolean;
  onStart: () => void;
  /** Host-only: rename a filled seat (human or AI). Absent for non-hosts. */
  onRename?: (seatIndex: number, name: string) => void;
  onLeave: () => void;
  startError?: string | null;
  renameError?: string | null;
}) {
  const { theme } = useTheme();
  const seats = snap.seats;
  const filled = seats.filter((s) => s.filled).length;
  const humans = seats.filter((s) => !s.isAI);
  const humansFilled = humans.filter((s) => s.filled).length;
  const canStart = filled >= 2;
  // A friend can join while there's an open human seat OR an AI to take over.
  const openHumanSeat = seats.some((s) => !s.isAI && !s.filled);
  const hasAISeat = seats.some((s) => s.isAI);
  const joinHint = openHumanSeat
    ? "Share this code so friends can join."
    : hasAISeat
      ? "Share this code — a friend can take an AI's seat."
      : "Every seat is taken.";

  return (
    <div className="lobby">
      <div className="lobby__panel">
        <header className="lobby__head">
          <h1 className="lobby__title">Game Lobby</h1>
          <span className="lobby__park">
            {theme.displayName} · {theme.designation}
          </span>
        </header>

        <div className="lobby__code-block">
          <span className="lobby__code-label">Room Code</span>
          <span className="lobby__code">{code}</span>
          <span className="lobby__code-hint">{joinHint}</span>
        </div>

        <div className="lobby__sectitle">
          <StarDivider className="lobby__rule" />
          <h2>
            Seats ({filled}/{seats.length})
          </h2>
          <StarDivider className="lobby__rule" />
        </div>

        {isHost && onRename && <p className="lobby__edit-hint">Tap a name to edit it.</p>}

        <ul className="lobby__seats">
          {seats.map((seat) => (
            <li
              key={seat.idx}
              className={`lobby__seat${seat.filled ? " lobby__seat--filled" : ""}`}
            >
              <Avatar
                avatarKey={seat.avatar ?? "mountain"}
                emoji={seat.emoji}
                className="avatar--sm"
              />
              {isHost && onRename && seat.filled ? (
                <SeatNameEditor
                  idx={seat.idx}
                  name={seat.name ?? `Player ${seat.idx + 1}`}
                  onRename={onRename}
                />
              ) : (
                <span className="lobby__seat-name">
                  {seat.isAI ? seat.name : (seat.name ?? "Open seat…")}
                </span>
              )}
              <span className="lobby__seat-tag">
                {seat.isAI ? "AI" : seat.filled ? "Ready" : "Waiting"}
              </span>
            </li>
          ))}
        </ul>

        {renameError && <p className="lobby__error">{renameError}</p>}

        {isHost ? (
          <>
            <button className="lobby__start" type="button" onClick={onStart} disabled={!canStart}>
              {canStart ? "Start Game" : "Need 2+ players"}
            </button>
            {humansFilled < humans.length && canStart && (
              <p className="lobby__note">Unfilled human seats will be played by AI.</p>
            )}
            {startError && <p className="lobby__error">{startError}</p>}
          </>
        ) : (
          <p className="lobby__waiting">Waiting for the host to start…</p>
        )}

        <button className="lobby__leave" type="button" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
