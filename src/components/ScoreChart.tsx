/**
 * End-of-game chart — two stacked plots sharing one deal (x) axis:
 *   • top: each player's hand score per deal (lines + knock markers)
 *   • bottom: how many rounds (laps) each deal took (bars)
 * Separate plots keep the two very different scales from competing. Pure SVG.
 */
import type { GamePlayer, DealScores } from "../game/engine";
import "./ScoreChart.css";

const COLORS = [
  "#e8c068",
  "#3a99a3",
  "#c9571c",
  "#8fa395",
  "#7fb0e0",
  "#c58fd0",
  "#9bd07a",
  "#e07a7a",
];

const W = 560;
const PAD_L = 46;
const PAD_R = 16;

// Score plot
const SCORE_TOP = 26;
const SCORE_H = 150;
// Rounds plot (below)
const ROUNDS_TOP = 206;
const ROUNDS_H = 46;
const H = 282;

const Y_MAX = 31;

export default function ScoreChart({
  players,
  history,
}: {
  players: GamePlayer[];
  history: DealScores[];
}) {
  if (history.length < 1) return null;

  const innerW = W - PAD_L - PAD_R;
  const xOf = (i: number) =>
    PAD_L +
    (history.length === 1 ? innerW / 2 : (i / (history.length - 1)) * innerW);

  const scoreBottom = SCORE_TOP + SCORE_H;
  const yScore = (v: number) =>
    scoreBottom - (Math.min(v, Y_MAX) / Y_MAX) * SCORE_H;

  const roundsBottom = ROUNDS_TOP + ROUNDS_H;
  const roundsMax = Math.max(...history.map((h) => h.rounds), 1);
  const yRounds = (v: number) => roundsBottom - (v / roundsMax) * ROUNDS_H;
  const barW = Math.min(22, (innerW / history.length) * 0.55);

  const scoreGrid = [0, 10, 20, 31];
  const roundsGrid = Array.from(new Set([0, roundsMax]));

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart__svg"
        role="img"
        aria-label="Score and rounds by deal"
      >
        {/* ── SCORE PLOT ── */}
        <text x={PAD_L} y={SCORE_TOP - 10} className="chart__caption">
          Hand score
        </text>
        {scoreGrid.map((g) => (
          <g key={`sg-${g}`}>
            <line
              x1={PAD_L}
              y1={yScore(g)}
              x2={W - PAD_R}
              y2={yScore(g)}
              className="chart__grid"
            />
            <text
              x={PAD_L - 7}
              y={yScore(g) + 4}
              className="chart__ylabel"
              textAnchor="end"
            >
              {g}
            </text>
          </g>
        ))}
        {players.map((p, pi) => {
          const color = COLORS[pi % COLORS.length];
          const pts = history
            .map((h, i) => {
              const sc = h.scores[p.id];
              return sc === undefined ? null : `${xOf(i)},${yScore(sc)}`;
            })
            .filter(Boolean)
            .join(" ");
          return (
            <g key={p.id}>
              <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
              />
              {history.map((h, i) => {
                const sc = h.scores[p.id];
                if (sc === undefined) return null;
                const knocked = h.knockerId === p.id;
                return (
                  <g key={i}>
                    <circle cx={xOf(i)} cy={yScore(sc)} r="3.5" fill={color} />
                    {knocked && (
                      <>
                        <circle
                          cx={xOf(i)}
                          cy={yScore(sc)}
                          r="7"
                          fill="none"
                          stroke={color}
                          strokeWidth="1.5"
                        />
                        <text
                          x={xOf(i)}
                          y={yScore(sc) - 12}
                          textAnchor="middle"
                          className="chart__knock"
                        >
                          🔨
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* ── ROUNDS PLOT ── */}
        <text
          x={PAD_L}
          y={ROUNDS_TOP - 8}
          className="chart__caption chart__caption--rounds"
        >
          Rounds played
        </text>
        <line
          x1={PAD_L}
          y1={roundsBottom}
          x2={W - PAD_R}
          y2={roundsBottom}
          className="chart__grid"
        />
        {roundsGrid.map((g) => (
          <text
            key={`rg-${g}`}
            x={PAD_L - 7}
            y={yRounds(g) + 4}
            className="chart__rlabel"
            textAnchor="end"
          >
            {g}
          </text>
        ))}
        {history.map((h, i) => (
          <rect
            key={`bar-${i}`}
            className="chart__bar"
            x={xOf(i) - barW / 2}
            y={yRounds(h.rounds)}
            width={barW}
            height={roundsBottom - yRounds(h.rounds)}
            rx="2"
          />
        ))}

        {/* shared X (deal) labels */}
        {history.map((h, i) => (
          <text
            key={`x-${i}`}
            x={xOf(i)}
            y={H - 8}
            className="chart__xlabel"
            textAnchor="middle"
          >
            Deal {h.deal}
          </text>
        ))}
      </svg>

      <div className="chart__legend">
        {players.map((p, pi) => (
          <span key={p.id} className="chart__legend-item">
            <span
              className="chart__swatch"
              style={{ background: COLORS[pi % COLORS.length] }}
            />
            {p.name}
          </span>
        ))}
        <span className="chart__legend-item chart__legend-item--note">
          🔨 knocked
        </span>
      </div>
    </div>
  );
}
