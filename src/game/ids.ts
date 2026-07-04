/**
 * Join codes and per-seat tokens. Codes use a 32-char alphabet (no I/O/0/1) so
 * they're easy to read aloud; 32 is a power of two, so (byte % 32) is unbiased.
 * Both use cryptographic randomness.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no I/O/0/1
const CODE_LENGTH = 6; // 32^6 ≈ 1.07B — negligible collision/brute-force surface

export function makeCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let c = "";
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return c;
}

export const newToken = (): string => crypto.randomUUID();

/**
 * The public player id for a seat index — the single source of the `p<idx>`
 * convention. Player ids are NOT secret (they're sent to every viewer in the
 * redacted state); the seat *token* is the credential. Minting them in one place
 * keeps the shape from being independently hard-coded across create/join/solo.
 */
export const seatPlayerId = (idx: number): string => `p${idx}`;
