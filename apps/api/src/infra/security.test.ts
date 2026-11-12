import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { rateLimiter } from "./security.js";
import { PasswordPolicy } from "../auth/password-policy.js";
import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";

const fakeRes = () => {
  const r = { code: 200, headers: {} as Record<string, string>, body: null as unknown,
    setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; } };
  return r;
};

describe("security baseline", () => {
  it("rate limits per IP: sign-in endpoints tighter than the rest, with Retry-After", () => {
    let t = 0;
    const mw = rateLimiter({ authPerMinute: 3, generalPerMinute: 5 }, () => t);
    const hit = (path: string, ip = "1.1.1.1") => {
      const res = fakeRes();
      let passed = false;
      mw({ path, ip } as Request, res as unknown as Response, () => { passed = true; });
      return { passed, res };
    };
    expect([1, 2, 3].map(() => hit("/auth/login").passed)).toEqual([true, true, true]);
    const blocked = hit("/auth/login");
    expect(blocked.passed).toBe(false);
    expect(blocked.res.code).toBe(429);
    expect(blocked.res.headers["retry-after"]).toBe("60");
    expect((blocked.res.body as { error: { code: string } }).error.code).toBe("rate_limited");
    expect(hit("/auth/login", "2.2.2.2").passed).toBe(true); // another client
    expect(hit("/vehicles").passed).toBe(true); // separate bucket
    expect(hit("/health").passed).toBe(true);
    t += 60_000;
    expect(hit("/auth/login").passed).toBe(true); // next window
  });

  it("D-SEC-PWD: length, common passwords, breached corpus via k-anonymity (only the prefix leaves)", async () => {
    const policy = new PasswordPolicy({ breachedPasswordCheck: true } as AppConfig);
    const asked: string[] = [];
    const leaked = "Tr0ub4dor&3xyz";
    const sha = createHash("sha1").update(leaked).digest("hex").toUpperCase();
    policy.fetchRange = async (prefix) => { asked.push(prefix); return `0000000000000000000000000000000000A:1\r\n${sha.slice(5)}:42\r\n`; };
    const err = async (p: string) => { try { await policy.assertAcceptable(p); return null; } catch (e) { return (e as { getResponse(): { error: { fields: Record<string, string> } } }).getResponse().error.fields.password; } };
    expect(await err("short")).toMatch(/^min 12/);
    expect(await err("password1234")).toBe("too_common");
    expect(await err("aaaaaaaaaaaaaa")).toBe("too_common");
    expect(await err(leaked)).toBe("breached");
    expect(asked).toEqual([sha.slice(0, 5)]);
    expect(await err("correct horse battery staple 9")).toBeNull();
    // Unreachable service: fail open
    policy.fetchRange = async () => { throw new Error("offline"); };
    expect(await err(leaked)).toBeNull();
  });
});
