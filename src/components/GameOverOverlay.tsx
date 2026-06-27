/**
 * Game over — the last player with a token wins. Celebrates with the active
 * park's scene, then shows a per-deal score chart for the whole game.
 */
import Modal from "./Modal";
import ParkScene from "./ParkScene";
import ScoreChart from "./ScoreChart";
import { useTheme } from "./ParkThemeProvider";
import { AVATAR_ART, MountainAvatar } from "../art/Avatars";
import type { GameState } from "../game/engine";
import "./VictoryPanel.css";

export default function GameOverOverlay({
  state,
  onNewGame,
}: {
  state: GameState;
  onNewGame: () => void;
}) {
  const { theme } = useTheme();
  const winner = state.players.find((p) => p.id === state.winnerId) ?? null;
  const Art = winner
    ? (AVATAR_ART[winner.avatarKey] ?? MountainAvatar)
    : MountainAvatar;

  return (
    <Modal
      open
      onClose={onNewGame}
      variant="modal--victory"
      labelledBy="go-title"
    >
      <div className="victory">
        <div className="victory__scene">
          <ParkScene theme={theme} className="victory__scene-svg" />
        </div>
        <div className="victory__overlay" />
        <div className="victory__content">
          <span className="victory__avatar">
            {winner?.image ? (
              <img className="victory__avatar-img" src={winner.image} alt="" />
            ) : winner?.emoji ? (
              <span className="victory__avatar-emoji">{winner.emoji}</span>
            ) : (
              <Art />
            )}
          </span>
          <span className="victory__eyebrow">
            Champion of {theme.displayName}
          </span>
          <h2 className="victory__title" id="go-title">
            {winner ? `${winner.name} Wins!` : "Game Over"}
          </h2>
          <p className="victory__msg">{theme.victoryMessage}</p>
        </div>
      </div>

      {state.scoreHistory.length > 0 && (
        <div className="victory__chart">
          <h3 className="victory__chart-title">Score by Deal</h3>
          <ScoreChart players={state.players} history={state.scoreHistory} />
        </div>
      )}

      <button
        className="victory__cta victory__cta--block"
        type="button"
        onClick={onNewGame}
      >
        New Game
      </button>
    </Modal>
  );
}
