/**
 * Pre-game lobby (online). Shows the shareable room code and the seats as
 * players join in real time. The host (seat 0) can start once at least two
 * seats are filled; any unfilled human seats become AI at start.
 */
import { useTheme } from "./ParkThemeProvider";
import Avatar from "./Avatar";
import { StarDivider } from "../art/Glyphs";
import type { NetworkSnapshot } from "../game/networkTransport";
import "./Lobby.css";

export default function Lobby({
  snap,
  code,
  isHost,
  onStart,
  onLeave,
}: {
  snap: NetworkSnapshot;
  code: string;
  isHost: boolean;
  onStart: () => void;
  onLeave: () => void;
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
              <span className="lobby__seat-name">
                {seat.isAI ? seat.name : (seat.name ?? "Open seat…")}
              </span>
              <span className="lobby__seat-tag">
                {seat.isAI ? "AI" : seat.filled ? "Ready" : "Waiting"}
              </span>
            </li>
          ))}
        </ul>

        {isHost ? (
          <>
            <button
              className="lobby__start"
              type="button"
              onClick={onStart}
              disabled={!canStart}
            >
              {canStart ? "Start Game" : "Need 2+ players"}
            </button>
            {humansFilled < humans.length && canStart && (
              <p className="lobby__note">
                Unfilled human seats will be played by AI.
              </p>
            )}
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
