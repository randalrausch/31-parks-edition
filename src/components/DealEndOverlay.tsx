/**
 * Deal-end reveal — every hand is shown face-up with its score and the tokens
 * each player lost. This is the only time opponents' cards/scores are visible.
 */
import { useState } from "react";
import Modal from "./Modal";
import Card from "./Card";
import LogFeed from "./LogFeed";
import { TokenRow } from "./TokenRow";
import { formatScore, isAlive, type GameState } from "../game/engine";
import "./DealEndOverlay.css";

export default function DealEndOverlay({
  state,
  onNext,
}: {
  state: GameState;
  onNext: () => void;
}) {
  const [showMoves, setShowMoves] = useState(false);
  if (!state.result) return null;
  const { rows, title } = state.result;
  const aliveCount = state.players.filter(isAlive).length;
  const gameEnding = aliveCount <= 1;
  const topScore = Math.max(...rows.map((r) => r.score));
  const knockerId =
    state.knocker !== null ? state.players[state.knocker]?.id : null;

  return (
    <Modal open onClose={onNext} variant="modal--results" labelledBy="re-title">
      <h2 className="re__title" id="re-title">
        {title}
      </h2>
      <div className="re__grid">
        {rows.map((row) => {
          const p = state.players.find((pl) => pl.id === row.playerId);
          if (!p) return null;
          const champ = !row.isLoser && row.score === topScore;
          return (
            <div
              key={p.id}
              className={`re__panel${row.isLoser ? " re__panel--loser" : ""}${champ ? " re__panel--champ" : ""}`}
            >
              <div className="re__name">
                {p.name}
                {p.id === knockerId && (
                  <span className="re__knock">🔨 Knocked</span>
                )}
              </div>
              <div className="re__hand">
                {p.hand.map((c) => (
                  <Card key={c.id} card={c} size="sm" />
                ))}
              </div>
              <div className="re__score">{formatScore(row.score)}</div>
              <TokenRow tokens={p.tokens} grace={p.grace} />
              {row.outcome === "grace" && (
                <div className="re__note re__note--grace">Now on Grace 🕯</div>
              )}
              {row.outcome === "eliminated" && (
                <div className="re__note re__note--out">Eliminated</div>
              )}
              {row.outcome === "lost" && (
                <div className="re__note">
                  Loses {row.livesLost} token{row.livesLost === 1 ? "" : "s"}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {state.log.length > 0 && (
        <div className="re__moves">
          <button
            type="button"
            className="re__moves-toggle"
            onClick={() => setShowMoves((v) => !v)}
            aria-expanded={showMoves}
          >
            {showMoves ? "Hide" : "Show"} moves this deal ({state.log.length})
          </button>
          {showMoves && (
            <div className="re__moves-list">
              <LogFeed entries={state.log} />
            </div>
          )}
        </div>
      )}
      <button className="re__btn" type="button" onClick={onNext}>
        {gameEnding ? "See Winner" : "Next Deal"}
      </button>
    </Modal>
  );
}
