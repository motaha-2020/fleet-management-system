import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, verifyTotp, totpStep } from "./totp.js";

describe("TOTP (RFC 6238 test vectors)", () => {
  const secret = Buffer.from("12345678901234567890"); // RFC 6238 Appendix B, SHA-1
  it("matches the published 8-digit vectors truncated to 6 digits", () => {
    // 59 s → 94287082, 1111111109 s → 07081804, 2000000000 s → 69279037
    expect(hotp(secret, totpStep(59_000))).toBe("287082");
    expect(hotp(secret, totpStep(1_111_111_109_000))).toBe("081804");
    expect(hotp(secret, totpStep(2_000_000_000_000))).toBe("279037");
  });
  it("round-trips base32", () => {
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
  it("accepts ±1 step and rejects replays", () => {
    const b32 = base32Encode(secret);
    const t = 1_111_111_109_000;
    const prev = hotp(secret, totpStep(t) - 1);
    expect(verifyTotp(b32, prev, t, null)).toBe(totpStep(t) - 1);
    expect(verifyTotp(b32, "081804", t, totpStep(t))).toBeNull(); // already used
    expect(verifyTotp(b32, "000000", t, null)).toBeNull();
    expect(verifyTotp(b32, "12345", t, null)).toBeNull();
  });
});
