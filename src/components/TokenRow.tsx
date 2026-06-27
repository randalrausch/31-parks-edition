/**
 * The public token display — three coins (filled = remaining lives) plus an
 * optional Grace candle. Tokens are public knowledge; hand scores are not.
 */
import "./TokenRow.css";

export function TokenRow({ lives, grace }: { lives: number; grace: boolean }) {
  return (
    <span
      className="tokens"
      aria-label={`${lives} tokens${grace ? ", on grace" : ""}`}
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <span
          key={i}
          className={`tokens__coin${i < lives ? "" : " tokens__coin--spent"}`}
        />
      ))}
      {grace && <span className="tokens__grace">🕯</span>}
    </span>
  );
}
