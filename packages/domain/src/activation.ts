/**
 * Driver activation codes (SEC-005). Unambiguous alphabet: no 0/O, 1/I/L.
 * Generation takes random bytes from the caller (domain stays pure).
 */
export const ACTIVATION_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function formatActivationCode(random: Uint8Array, length: number): string {
  const n = ACTIVATION_ALPHABET.length;
  const limit = 256 - (256 % n); // rejection sampling: avoid modulo bias
  let out = "";
  for (const byte of random) {
    if (out.length === length) break;
    if (byte < limit) out += ACTIVATION_ALPHABET[byte % n];
  }
  if (out.length < length) throw new RangeError("not enough random bytes (pass ~2x length)");
  return out;
}

/** Accept user input with spaces/dashes/lowercase/Arabic digits. */
export function normalizeActivationCode(input: string): string {
  return input.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\s-]/g, "").toUpperCase();
}
