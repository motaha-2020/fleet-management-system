/**
 * Helpers shared by the journey simulation (journey.mjs) and the training video (tools/training-video/film.mjs).
 * Both run only in CI against a throw-away stack.
 */
export const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
export const { messages } = await import(new URL("../../packages/i18n/dist/index.js", import.meta.url));
export const ar = messages.ar;
export const TUNIS = { latitude: 36.8065, longitude: 10.1815 };
export const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
/** A 1×1 PNG, used as the meter / receipt photo. */
export const PHOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** Waits until the page stops showing "Loading…" (any language); returns how long that took. */
export async function settle(page, t0 = Date.now()) {
  const loading = Object.values(messages).map((m) => m.common.loading);
  await page.waitForLoadState("domcontentloaded");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    if (text.trim() && !loading.some((l) => text.includes(l))) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  return Date.now() - t0;
}

/** Office sign-in through the login form. */
export async function login(page, email, password, locale = "ar") {
  const m = messages[locale];
  await page.goto(`${BASE}/login`);
  await page.getByLabel(m.auth.email).fill(email);
  await page.getByLabel(m.auth.password, { exact: true }).fill(password);
  await page.getByRole("button", { name: m.auth.login, exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  await settle(page, Date.now());
}

/** The side-menu links this role can see (desktop). */
export const menu = (page) => page.$$eval("aside nav a[href]", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);

export async function apiLogin(email, password) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const b = await r.json();
  if (!b.accessToken) throw new Error(`api login ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  return b.accessToken;
}

export async function apiCall(token, method, p, body) {
  const r = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const b = await r.json().catch(() => null);
  if (r.status >= 300) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  return b;
}

export const alertText = (page) => page.locator("[role=alert]").allInnerTexts().then((x) => x.join(" | ")).catch(() => "");
