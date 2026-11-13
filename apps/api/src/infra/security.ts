import type { NextFunction, Request, Response } from "express";

/** Baseline HTTP security headers for a JSON API (OWASP ASVS V14). */
export function securityHeaders(production: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cross-origin-resource-policy", "same-site");
    res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    if (production) res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (!res.getHeader("cache-control")) res.setHeader("cache-control", "no-store");
    next();
  };
}

/** Sign-in and recovery endpoints get the tighter limit (credential stuffing, code guessing). */
const AUTH_PATHS = [/^\/auth\/(login|mfa|mfa\/resend|forgot-password|reset-password|accept-invite|driver\/activate|refresh)$/];

/**
 * Per-IP fixed-window rate limit (one API instance in the Pilot; a shared store comes with horizontal scaling).
 * Over the limit → 429 with Retry-After, in the ApiError shape.
 */
export function rateLimiter(limits: { authPerMinute: number; generalPerMinute: number }, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = now();
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health") return next();
    const t = now();
    if (t - lastSweep > 60_000) {
      for (const [k, w] of windows) if (t - w.start >= 60_000) windows.delete(k);
      lastSweep = t;
    }
    const auth = AUTH_PATHS.some((r) => r.test(req.path));
    const limit = auth ? limits.authPerMinute : limits.generalPerMinute;
    const key = `${auth ? "a" : "g"}|${req.ip}`;
    let w = windows.get(key);
    if (!w || t - w.start >= 60_000) { w = { start: t, count: 0 }; windows.set(key, w); }
    w.count++;
    res.setHeader("x-ratelimit-limit", String(limit));
    res.setHeader("x-ratelimit-remaining", String(Math.max(0, limit - w.count)));
    if (w.count > limit) {
      const retry = Math.ceil((w.start + 60_000 - t) / 1000);
      res.setHeader("retry-after", String(retry));
      res.status(429).json({ error: { code: "rate_limited", message: "Too many requests; try again shortly", fields: { retryAfter: String(retry) } } });
      return;
    }
    next();
  };
}
