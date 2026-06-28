/**
 * The public token display — three coins (filled = remaining tokens) plus an
 * optional Grace candle. Tokens are public knowledge; hand scores are not.
 */
import "./TokenRow.css";

export function TokenRow({
  tokens,
  grace,
}: {
  tokens: number;
  grace: boolean;
}) {
  return (
    <span
      className="tokens"
      aria-label={`${tokens} tokens${grace ? ", on grace" : ""}`}
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <span
          key={i}
          className={`tokens__coin${i < tokens ? "" : " tokens__coin--spent"}`}
        />
      ))}
      {grace && <span className="tokens__grace">🕯</span>}
    </span>
  );
}
