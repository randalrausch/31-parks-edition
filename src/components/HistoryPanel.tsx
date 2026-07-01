/**
 * "History of 31" — a deep, fun tour through the game's five-century past:
 * medieval origins, its dozens of names, the German "swimming" tradition that
 * became Grace, frontier Scat, rule variations worldwide, and a pile of trivia.
 */
import Modal from "./Modal";
import "./HistoryPanel.css";

const NAMES = [
  "Trente-et-Un",
  "Trentuno",
  "Treinta y Una",
  "Scat",
  "Schwimmen",
  "Schnautz",
  "Schnauz",
  "Knack",
  "Blitz",
  "Cad",
  "Cadillac",
  "Whammy",
  "Ride the Bus",
  "Thirty-One",
  "Nabbe",
  "Big Tunny",
];

const VARIATIONS = [
  [
    "Scat (USA)",
    "The common American name. Lose three chips and you're out — and players often say you've gone “out the window.”",
  ],
  [
    "Schwimmen (Germany/Austria)",
    "Played with a 32-card deck. Lose your last chip and you're “swimming”; lose again and you “drown.” The direct ancestor of Grace.",
  ],
  [
    "Schnauz / Knack (Switzerland)",
    "Hitting exactly 31 — a “Schnauz” — can be declared instantly, ending the hand and beating everyone.",
  ],
  [
    "Three of a kind = 30½",
    "A near-universal house rule: a matching trio ranks just below 31 and above any 30. Toggle it on at setup.",
  ],
  [
    "Blitz / Knack penalty",
    "Knock and finish lowest and many tables make you pay double — the price of a bluff that didn't hold.",
  ],
  [
    "29 & other targets",
    "Some regions play to 29 or count Aces as 1, shifting the whole strategy.",
  ],
  [
    "Ride the Bus",
    "A campus drinking variant where the last player left must “ride the bus” through a penalty round.",
  ],
];

const TRIVIA = [
  "The earliest known mention is a 1440 sermon by the friar (later saint) Bernardino of Siena, who lumped “trentuno” in with the dice and card games he wanted banished from the public square.",
  "François Rabelais listed “trente-et-un” among the hundreds of games his giant Gargantua plays in the 1530s — putting it in print alongside chess and backgammon.",
  "Because Ace = 11 and the court cards = 10, the only way to reach a perfect 31 is an Ace plus two tens/faces of one suit. That elegant ceiling is almost certainly where the target number came from.",
  "“Knocking” to signal you're standing pat likely comes from tavern play — a literal rap on the table — and the gesture survives in dozens of card games today.",
  "In German, declaring you're “swimming” (ich schwimme!) after losing your last chip is half the fun — opponents know you're one bad hand from drowning.",
  "Scat was a favorite in 19th-century American saloons and riverboats, where chips might be coins, matchsticks, or rounds of the next drink.",
  "It's one of the rare card games that survived five centuries with no governing body and no official rulebook — passed down entirely by family and tavern “house rules.”",
  "Card historians group 31 with “draw-and-discard” games, the same family that later produced Gin Rummy — but 31 is older, faster, and more brutal.",
];

export default function HistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} variant="modal--history" labelledBy="hist-title">
      <div className="hist">
        <h2 className="hist__title" id="hist-title">
          History of 31
        </h2>
        <p className="hist__sub">Five centuries of the world's most portable card game</p>

        <section className="hist__section">
          <h3 className="hist__h">Medieval Origins</h3>
          <p>
            The first written trace of a game called <em>Trente-et-Un</em> — French for “thirty-one”
            — appears in a <em>1440</em> sermon by Saint Bernardino of Siena, who condemned it
            alongside dice and other “games of fortune.” That a preacher bothered to name it tells
            you it was already popular. Through the 1400s and 1500s it spread across Italy (
            <em>Trentuno</em>), Spain (<em>Treinta y Una</em>), France, Germany, and England, making
            it one of the oldest card games still played essentially unchanged today.
          </p>
        </section>

        <section className="hist__section">
          <h3 className="hist__h">A Game of Many Names</h3>
          <p>Five hundred years of travel left 31 with a small army of aliases:</p>
          <div className="hist__tags">
            {NAMES.map((n) => (
              <span className="hist__tag" key={n}>
                {n}
              </span>
            ))}
          </div>
        </section>

        <section className="hist__section">
          <h3 className="hist__h">Swimming, Drowning &amp; Grace</h3>
          <p>
            In Germany and Austria the game is <em>Schwimmen</em> — “swimming.” Lose your last chip
            and you don't leave the table; you're left <em>swimming</em>, kept afloat for one final
            hand. Survive and you play on; fail and you <em>drown</em>. That centuries-old idea is
            exactly the <strong>Grace</strong> rule in this edition — we simply traded the rising
            water for a candle burning down to its last light.
          </p>
        </section>

        <section className="hist__section">
          <h3 className="hist__h">Scat &amp; the American Frontier</h3>
          <p>
            Carried across the Atlantic by settlers, 31 became <em>Scat</em> — a saloon and
            riverboat staple where the “chips” might be coins, matchsticks, or the next round of
            drinks. Fast to deal and merciless to the unlucky, it was the kind of game you could
            finish three times while the stew was still cooking.
          </p>
        </section>

        <section className="hist__section">
          <h3 className="hist__h">How You Win</h3>
          <p>
            Build the highest total you can in a <em>single suit</em>. Aces are 11, face cards are
            10, everything else is its pip value. Mixed suits don't add together — a hand of
            <em> A♠ K♠ 8♠</em> scores 29, while <em>A♠ K♥ 8♦</em> scores only 11. Reach a perfect{" "}
            <strong>31</strong> and you can reveal it on the spot. Each deal, the lowest hand loses
            a token; the last player holding a token wins the game.
          </p>
        </section>

        <section className="hist__section">
          <h3 className="hist__h">Variations Around the World</h3>
          <ul className="hist__list">
            {VARIATIONS.map(([name, desc]) => (
              <li key={name}>
                <strong>{name}:</strong> {desc}
              </li>
            ))}
          </ul>
        </section>

        <section className="hist__section">
          <h3 className="hist__h">Fun Facts &amp; Trivia</h3>
          <ul className="hist__list hist__list--trivia">
            {TRIVIA.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>

        <section className="hist__section">
          <h3 className="hist__h">Why It Endures</h3>
          <p>
            No app, no rulebook, no governing body ever kept 31 alive — just the fact that it
            teaches you to read a hand in seconds and dares you to knock before someone beats you.
            It's the perfect campfire game: quick to learn, agonizing to master, and over fast
            enough to play “just one more.”
          </p>
        </section>

        <button className="hist__cta" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
