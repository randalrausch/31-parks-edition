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
