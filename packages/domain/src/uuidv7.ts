/**
 * UUIDv7 (RFC 9562): time-ordered IDs that devices can generate offline.
 * Pure: the caller supplies the clock reading and 10 random bytes.
 */
export function uuidv7(unixMs: number, random: Uint8Array): string {
  if (!Number.isInteger(unixMs) || unixMs < 0 || unixMs > 0xffff_ffff_ffff) {
    throw new RangeError("unixMs must be a 48-bit non-negative integer");
  }
  if (random.length < 10) throw new RangeError("need at least 10 random bytes");
  const b = new Uint8Array(16);
  let t = unixMs;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = 0x70 | (random[0]! & 0x0f);
  b[7] = random[1]!;
  b[8] = 0x80 | (random[2]! & 0x3f);
  for (let i = 9; i < 16; i++) b[i] = random[i - 6]!;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
