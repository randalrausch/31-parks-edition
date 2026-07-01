/**
 * "How to Play 31" — a full beginner tutorial shown on a parchment card.
 */
import Modal from "./Modal";
import "./HelpPanel.css";

export default function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} variant="modal--parchment" labelledBy="help-title">
      <div className="help">
        <h2 className="help__title" id="help-title">
          How to Play 31
        </h2>

        <p className="help__lead">
          31 is a quick, tense card game of swapping and bluffing. Each deal you try to build the
          best three-card hand you can <strong>in a single suit</strong> — as close to{" "}
          <strong>31</strong> as possible. Finish a deal with the lowest hand and you lose a token.
          Lose all your tokens and you're out; the last player holding a token wins the game.
        </p>

        <section className="help__section">
          <h3 className="help__h">Card Values</h3>
          <div className="help__values">
            <span className="help__vk">Ace</span>
            <span>11 points</span>
            <span className="help__vk">King · Queen · Jack</span>
            <span>10 points each</span>
            <span className="help__vk">2 – 10</span>
            <span>face value</span>
          </div>
        </section>

        <section className="help__section">
          <h3 className="help__h">Scoring — suit matters</h3>
          <p>
            Only cards of the <strong>same suit</strong> add together. Your score is the highest
            total you can make from one suit in your hand. The cards counting toward your score are
            outlined in gold.
          </p>
          <div className="help__example">
            <div>
              <span className="help__cards">A♠ K♠ 8♠</span> → <strong>29</strong>{" "}
              <em>(all spades: 11 + 10 + 8)</em>
            </div>
            <div>
              <span className="help__cards">A♠ K♥ 8♦</span> → <strong>11</strong>{" "}
              <em>(no shared suit — just the Ace)</em>
            </div>
          </div>
          <p className="help__fine">
            Optional house rule: three of a kind scores <strong>30½</strong>, beating everything
            except a true 31.
          </p>
        </section>

        <section className="help__section">
          <h3 className="help__h">On Your Turn</h3>
          <p>You always hold exactly three cards. On your turn, do one of:</p>
          <ul className="help__list">
            <li>
              <strong>Draw from Deck</strong> — take the top face-down card (a fresh unknown), then
              discard one card you don't want.
            </li>
            <li>
              <strong>Take Discard</strong> — pick up the face-up discard everyone can see, then
              discard one card.
            </li>
            <li>
              <strong>Knock</strong> — see below. (You can't draw after you knock.)
            </li>
          </ul>
          <p>Either way you end your turn with three cards, slowly collecting one strong suit.</p>
        </section>

        <section className="help__section">
          <h3 className="help__h">Knocking</h3>
          <p>
            Think your hand is safe? Instead of drawing, <strong>knock</strong>. Every other player
            gets <strong>one</strong> last turn, then all hands are revealed and scored. Knock too
            early and someone may overtake you; knock too late and a rival may knock first.
          </p>
          <p className="help__fine">
            Dealt exactly 31? Reveal it immediately — everyone else loses a token.
          </p>
        </section>

        <section className="help__section">
          <h3 className="help__h">Tokens, Grace &amp; Winning</h3>
          <p>
            Everyone starts with <strong>3 tokens</strong>. Each deal the lowest hand loses one. If
            the knocker ends up lowest and <em>Knock Penalty</em> is on, they lose two. With{" "}
            <em>Grace</em> on, losing your last token keeps you in for one more deal — lose again
            and you're out. The last player with a token wins.
          </p>
        </section>

        <section className="help__section">
          <h3 className="help__h">Quick Tips</h3>
          <ul className="help__list">
            <li>Commit to one suit early and feed it every turn.</li>
            <li>Watch the discard pile — it tells you what rivals are chasing.</li>
            <li>A hand in the mid-20s is often safe enough to knock.</li>
          </ul>
        </section>

        <button className="help__cta" type="button" onClick={onClose}>
          Got it — let's play
        </button>
      </div>
    </Modal>
  );
}
