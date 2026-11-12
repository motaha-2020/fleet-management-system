import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DEFAULTS } from "@fleet/config";
import { CONFIG } from "../infra/tokens.js";
import type { AppConfig } from "../config.js";
import { validation } from "../infra/errors.js";

/** Passwords seen in almost every breach list; refused even when the online check is off or unreachable. */
const COMMON = new Set([
  "123456789012", "1234567890123", "password1234", "password12345", "passwordpassword", "qwertyuiop12", "qwertyuiopasdf", "abcdefghijkl", "abc123456789",
  "111111111111", "000000000000", "123123123123", "iloveyou1234", "welcome12345", "letmein12345", "administrator", "admin1234567", "changeme1234",
  "p@ssw0rd1234", "passw0rd1234", "football1234", "baseball1234", "superman1234", "trustno11234", "1q2w3e4r5t6y", "1qaz2wsx3edc", "zaq12wsxcde3",
  "qazwsxedcrfv", "asdfghjkl123", "q1w2e3r4t5y6", "princess1234", "sunshine1234", "monkey123456", "dragon123456", "master123456", "shadow123456",
]);

/**
 * D-SEC-PWD: at least 12 characters, not a known breached password, no forced periodic change.
 * The breached check uses the Have I Been Pwned range API (k-anonymity: only 5 hex chars of the SHA-1 leave the server).
 * If the service is unreachable the check is skipped and logged (fail open — sign-up must not depend on it).
 */
@Injectable()
export class PasswordPolicy {
  private readonly log = new Logger("password-policy");
  /** Replaceable in tests. */
  fetchRange: (prefix: string) => Promise<string> = async (prefix) => {
    const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { "add-padding": "true" }, signal: AbortSignal.timeout(3_000) });
    if (!r.ok) throw new Error(`HIBP ${r.status}`);
    return r.text();
  };

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async assertAcceptable(password: string) {
    if (password.length < DEFAULTS.PASSWORD_MIN_LENGTH) throw validation({ password: `min ${DEFAULTS.PASSWORD_MIN_LENGTH} characters` });
    const lower = password.toLowerCase();
    if (COMMON.has(lower) || /^(.)\1+$/.test(password)) throw validation({ password: "too_common" });
    if (this.config.breachedPasswordCheck && (await this.breached(password))) throw validation({ password: "breached" });
  }

  private async breached(password: string): Promise<boolean> {
    const sha = createHash("sha1").update(password).digest("hex").toUpperCase();
    try {
      const body = await this.fetchRange(sha.slice(0, 5));
      return body.split("\n").some((line) => {
        const [suffix, count] = line.trim().split(":");
        return suffix === sha.slice(5) && Number(count) > 0;
      });
    } catch (e) {
      this.log.warn(`breached-password check skipped: ${(e as Error).message}`);
      return false;
    }
  }
}
