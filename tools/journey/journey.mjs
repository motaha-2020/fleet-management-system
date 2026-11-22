/**
 * Journey simulation (owner, 22 Nov 2026): walks the platform like real users, every role, desktop and phone,
 * the four languages, from platform setup to the driver's phone. Runs only in CI against a throw-away stack
 * (.github/workflows/journey.yml) — never against staging or production.
 *
 * Output (OUT_DIR): shots/*.png, report.json and summary.md (load times, layout problems, broken text, errors).
 * Every step is recorded as ok/failed with its reason; one failed step does not stop the run.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const OUT = process.env.OUT_DIR ?? "journey-out";
const demo = JSON.parse(fs.readFileSync(process.env.DEMO_FILE, "utf8"));
const PLATFORM = { email: process.env.PLATFORM_EMAIL, password: process.env.PLATFORM_PASSWORD };
const { messages } = await import(new URL("../../packages/i18n/dist/index.js", import.meta.url));
const ar = messages.ar;
const TUNIS = { latitude: 36.8065, longitude: 10.1815 };
const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
// A small valid JPEG-like PNG (1×1) is enough for the upload paths.
const PHOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });
const photoPath = path.join(OUT, "photo.png");
fs.writeFileSync(photoPath, PHOTO);
const report = { startedAt: new Date().toISOString(), steps: [], pages: [], findings: [] };
const finding = (severity, where, kind, detail) => report.findings.push({ severity, where, kind, detail });
let shotNo = 0;
const slug = (s) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);

const browser = await chromium.launch();

async function context(view, locale = "ar") {
  const ctx = await browser.newContext({ ...VIEWS[view], locale: locale === "fr" ? "fr-TN" : locale === "en" ? "en-GB" : "ar-TN", geolocation: TUNIS, permissions: ["geolocation"], acceptDownloads: true });
  await ctx.addInitScript((l) => { try { localStorage.setItem("fleet.locale", l); } catch {} }, locale);
  const page = await ctx.newPage();
  page.problems = [];
  page.on("console", (m) => { if (m.type() === "error") page.problems.push(`console: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => page.problems.push(`page error: ${String(e.message).slice(0, 200)}`));
  page.on("response", (r) => { if (r.status() >= 500 || (r.status() >= 400 && r.status() !== 401 && r.url().includes("/api/"))) page.problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  return { ctx, page };
}

async function shot(page, name) {
  const file = `${String(++shotNo).padStart(3, "0")}-${slug(name)}.png`;
  await page.screenshot({ path: path.join(OUT, "shots", file), fullPage: true }).catch(() => {});
  return file;
}

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    report.steps.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? null });
    console.log(`✓ ${name} (${Date.now() - t0} ms)`);
    return detail;
  } catch (e) {
    report.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e.message ?? e).slice(0, 500) });
    console.log(`✗ ${name}: ${String(e.message ?? e).slice(0, 300)}`);
    return null;
  }
}

/** Waits until the page stops showing "Loading…" (any language); returns how long that took. */
async function settle(page, t0) {
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

/** Layout and content checks on the page as it is now. */
async function audit(page, where, view, locale) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const text = document.body.innerText;
    const visible = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const scrollers = [...document.querySelectorAll(".overflow-x-auto")].filter((e) => visible(e) && e.scrollWidth > e.clientWidth + 2)
      .map((e) => ({ visible: e.clientWidth, needed: e.scrollWidth }));
    const small = [...document.querySelectorAll("main a, main button, main input:not([type=checkbox]):not([type=radio]):not(.sr-only), main select, header button, header select, header a")]
      .filter((e) => visible(e) && e.getBoundingClientRect().height < 40)
      .map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 30));
    const broken = [];
    for (const re of [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull\b/, /\b(?:m\d|common|nav|errors|auth)\.[a-zA-Z]+\b/, /Invalid Date/]) { const m = text.match(re); if (m) broken.push(m[0]); }
    const egypt = (text.match(/EGP|ج\.م|جنيه|Africa\/Cairo|01x{5,}/g) ?? []);
    const empty = !!document.querySelector("main") && (document.querySelector("main").innerText.trim().length < 40);
    return { pageOverflow: document.documentElement.scrollWidth - vw, scrollers, small, broken, egypt, empty, title: document.querySelector("h1")?.innerText ?? "" };
  });
  if (r.pageOverflow > 2) finding("high", where, "page-scrolls-sideways", `${view}/${locale}: page is ${r.pageOverflow}px wider than the screen`);
  for (const s of r.scrollers) finding(view === "desktop" ? "medium" : "low", where, "table-scrolls", `${view}/${locale}: table needs ${s.needed}px, has ${s.visible}px`);
  if (view === "mobile" && r.small.length) finding("low", where, "small-tap-targets", `${r.small.length} controls under 40px high (e.g. ${[...new Set(r.small)].slice(0, 5).join(" | ")})`);
  for (const b of r.broken) finding("high", where, "broken-text", `${view}/${locale}: "${b}" shown on screen`);
  if (r.egypt.length) finding("high", where, "egypt-leftover", `${view}/${locale}: ${[...new Set(r.egypt)].join(", ")}`);
  if (r.empty) finding("medium", where, "empty-page", `${view}/${locale}: almost nothing on screen`);
  return r;
}

async function visit(page, url, role, view, locale) {
  page.problems.length = 0;
  const t0 = Date.now();
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  const ms = await settle(page, t0);
  const where = `${role} ${url}`;
  const a = await audit(page, where, view, locale);
  const file = await shot(page, `${role}-${view}-${locale}-${url}`);
  const problems = [...new Set(page.problems)];
  for (const p of problems) finding(p.startsWith("HTTP 5") || p.startsWith("page error") ? "high" : "medium", where, "error", `${view}/${locale}: ${p}`);
  if (ms > 4000) finding("medium", where, "slow", `${view}/${locale}: ${ms} ms until content`);
  report.pages.push({ role, url, view, locale, ms, title: a.title, shot: file, overflow: a.pageOverflow, tables: a.scrollers.length, problems: problems.length });
  return a;
}

async function login(page, email, password, locale = "ar") {
  const m = messages[locale];
  await page.goto(`${BASE}/login`);
  await page.getByLabel(m.auth.email).fill(email);
  await page.getByLabel(m.auth.password, { exact: true }).fill(password);
  await page.getByRole("button", { name: m.auth.login, exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  await settle(page, Date.now());
}

/** The side-menu links this role can see (desktop). */
async function menu(page) {
  return page.$$eval("aside nav a[href]", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
}

async function apiLogin(email, password) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const b = await r.json();
  if (!b.accessToken) throw new Error(`api login ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  return b.accessToken;
}
async function apiCall(token, method, p, body) {
  const r = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const b = await r.json().catch(() => null);
  if (r.status >= 300) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  return b;
}

const alertText = (page) => page.locator("[role=alert]").allInnerTexts().then((x) => x.join(" | ")).catch(() => "");
const byRole = (role) => demo.users.find((u) => u.role === role);

/** Every page of the role's menu, desktop and phone (Arabic); extra languages on desktop for a few key pages. */
async function tour(label, user, { locales = [], keyPages = [] } = {}) {
  let links = [];
  await step(`${label}: sign in and visit every page (desktop)`, async () => {
    const { ctx, page } = await context("desktop");
    await login(page, user.email, user.password);
    links = await menu(page);
    report.menus = { ...(report.menus ?? {}), [label]: links };
    for (const href of links) await visit(page, href, label, "desktop", "ar");
    await ctx.close();
    return `${links.length} pages`;
  });
  await step(`${label}: every page on a phone`, async () => {
    const { ctx, page } = await context("mobile");
    await login(page, user.email, user.password);
    await page.locator("[data-testid=open-menu]").click();
    await page.waitForTimeout(400);
    await shot(page, `${label}-mobile-menu-open`);
    await page.keyboard.press("Escape");
    for (const href of links) await visit(page, href, label, "mobile", "ar");
    await ctx.close();
  });
  for (const locale of locales) {
    await step(`${label}: key pages in ${locale}`, async () => {
      const { ctx, page } = await context("desktop", locale);
      await login(page, user.email, user.password, locale);
      for (const href of keyPages.filter((h) => links.includes(h))) await visit(page, href, label, "desktop", locale);
      await ctx.close();
    });
  }
  return links;
}

// ============================================================ 1. Public pages and wrong inputs
await step("public: login, signup, forgot password, driver login (desktop + phone)", async () => {
  for (const view of ["desktop", "mobile"]) {
    const { ctx, page } = await context(view);
    for (const u of ["/login", "/signup", "/forgot-password", "/driver/login"]) await visit(page, u, "public", view, "ar");
    await ctx.close();
  }
});
await step("public: wrong password shows a clear message", async () => {
  const { ctx, page } = await context("mobile");
  await page.goto(`${BASE}/login`);
  await page.getByLabel(ar.auth.email).fill(byRole("company_admin").email);
  await page.getByLabel(ar.auth.password, { exact: true }).fill("wrong-password-123");
  await page.getByRole("button", { name: ar.auth.login, exact: true }).click();
  await page.waitForTimeout(1500);
  const msg = await alertText(page);
  await shot(page, "public-wrong-password");
  await ctx.close();
  if (!msg) throw new Error("no error message shown");
  return msg;
});

// ============================================================ 2. Platform setup: a new Tunisian company from the UI
const fresh = { name: "شركة الزيتونة للخدمات", slug: `zitouna-${Date.now().toString(36)}`, adminName: "إيناس الحمروني", adminEmail: `admin.${Date.now().toString(36)}@journey.fleet.test`, password: `Journey-${Math.random().toString(36).slice(2)}A1` };
let platformLinks = [];
await step("platform admin: tour of the platform pages", async () => {
  platformLinks = await tour("platform", PLATFORM);
});
let invite = null;
await step("platform admin: create a Tunisian company from the form", async () => {
  const { ctx, page } = await context("desktop");
  await login(page, PLATFORM.email, PLATFORM.password);
  await page.goto(`${BASE}/platform/tenants`);
  await settle(page, Date.now());
  await page.getByRole("button", { name: ar.tenants.add }).click();
  await page.getByLabel(ar.tenants.name).fill(fresh.name);
  await page.getByLabel(ar.tenants.slug).fill(fresh.slug);
  await page.getByLabel(ar.tenants.country).selectOption("TN");
  await page.getByLabel(ar.tenants.adminName).fill(fresh.adminName);
  await page.getByLabel(ar.tenants.adminEmail).fill(fresh.adminEmail);
  await shot(page, "platform-new-company-form");
  await page.getByRole("button", { name: ar.common.save, exact: true }).click();
  const code = page.locator("code", { hasText: "accept-invite" });
  await code.waitFor({ timeout: 15_000 });
  invite = (await code.innerText()).trim().replace(/^https?:\/\/[^/]+/, "");
  await shot(page, "platform-company-created-invite");
  await ctx.close();
  return invite;
});

let freshAdmin = null;
await step("new company admin: accept the invite and set a password", async () => {
  if (!invite) throw new Error("no invite link");
  const { ctx, page } = await context("desktop");
  for (let i = 0; i < 30; i++) {
    await page.goto(BASE + invite);
    await page.getByLabel(ar.auth.newPassword).fill(fresh.password);
    await page.getByRole("button", { name: ar.auth.activate }).click();
    await page.waitForTimeout(1500);
    if (!page.url().includes("accept-invite")) break;
    const msg = await alertText(page);
    if (i === 0) await shot(page, "invite-first-try");
    if (!/provision|تهيئ|جار/i.test(msg) && i > 3) throw new Error(`still on invite page: ${msg}`);
    await page.waitForTimeout(2000);
  }
  await settle(page, Date.now());
  await shot(page, "new-admin-first-screen");
  freshAdmin = { email: fresh.adminEmail, password: fresh.password };
  const first = new URL(page.url()).pathname;
  await ctx.close();
  return `first screen: ${first}`;
});

// ============================================================ 3. The new company admin sets the company up from scratch
await step("new company admin: first-run setup (profile, branch, vehicle, driver, user)", async () => {
  if (!freshAdmin) throw new Error("no admin");
  const { ctx, page } = await context("desktop");
  await login(page, freshAdmin.email, freshAdmin.password);
  const results = [];
  const tryForm = async (name, url, addLabel, fill) => {
    try {
      await page.goto(BASE + url);
      await settle(page, Date.now());
      if (addLabel) await page.getByRole("button", { name: addLabel }).first().click();
      await fill();
      await shot(page, `setup-${name}-filled`);
      await page.getByRole("button", { name: ar.common.save, exact: true }).first().click();
      await page.waitForTimeout(1500);
      const msg = await alertText(page);
      await shot(page, `setup-${name}-after-save`);
      results.push(`${name}: ${msg || "saved"}`);
    } catch (e) { results.push(`${name}: FAILED ${String(e.message).slice(0, 160)}`); }
  };
  await tryForm("company-profile", "/company", null, async () => {
    await page.getByLabel(ar.company.name).fill(fresh.name);
  });
  await tryForm("branch", "/branches", ar.branches.add, async () => {
    await page.getByLabel(ar.branches.code).fill("SOU");
    await page.getByLabel(ar.branches.name).fill("فرع سوسة");
  });
  await tryForm("vehicle", "/vehicles", ar.vehicles.add, async () => {
    await page.getByLabel(ar.vehicles.fleetNumber).fill("Z-001");
    await page.getByLabel(ar.vehicles.registrationNumber).fill("245 تونس 1234");
    await page.getByLabel(ar.vehicles.make).fill("Peugeot");
    await page.getByLabel(ar.vehicles.model).fill("Partner");
    await page.getByLabel(ar.vehicles.year).fill("2022");
  });
  await tryForm("driver", "/drivers", ar.drivers.add, async () => {
    await page.getByLabel(ar.drivers.fullName).fill("ياسين الكافي");
    await page.getByLabel(ar.drivers.username).fill(`yassine.${Date.now().toString(36)}`);
    await page.getByLabel(/B — /).first().check().catch(() => {});
  });
  await tryForm("user", "/users", ar.users.invite, async () => {
    await page.getByLabel(ar.users.name).fill("لطفي الدريدي");
    await page.getByLabel(ar.users.email).fill(`fm.${Date.now().toString(36)}@journey.fleet.test`);
  });
  await ctx.close();
  for (const r of results) if (r.includes("FAILED")) finding("high", "new company setup", "setup-step-failed", r);
  return results.join(" || ");
});

// ============================================================ 4. Every role of the demo company (30 days of data)
const keyPages = ["/dashboard", "/vehicles", "/fuel", "/costs", "/approvals", "/tasks", "/reports"];
const admin = byRole("company_admin");
await tour("company_admin", admin, { locales: ["tn", "fr", "en"], keyPages });
const fms = demo.users.filter((u) => u.role === "fleet_manager");
await tour("fleet_manager", fms[0]);
await tour("finance_reviewer", byRole("finance_reviewer"));
await tour("custom_shift_supervisor", byRole("custom"));

// What a role must not reach: the page should say so, not break.
await step("finance reviewer: opening a page outside the role (/users)", async () => {
  const { ctx, page } = await context("desktop");
  const u = byRole("finance_reviewer");
  await login(page, u.email, u.password);
  await visit(page, "/users", "finance_reviewer-forbidden", "desktop", "ar");
  const text = await page.locator("main").innerText();
  await ctx.close();
  return text.slice(0, 160);
});

// ============================================================ 5. Driver on the phone (web version), then the fleet manager approves
await step("driver (phone): sign in with a code, record odometer and fuel", async () => {
  const adminToken = await apiLogin(admin.email, admin.password);
  const d = demo.drivers[0];
  const code = (await apiCall(adminToken, "POST", `/drivers/${d.driverId}/activation-code`, { purpose: "web" })).code;
  const { ctx, page } = await context("mobile");
  await visit(page, "/driver/login", "driver", "mobile", "ar");
  await page.getByLabel(ar.driverWeb.code).fill("000000");
  await page.getByLabel(ar.driverWeb.username).fill(d.username);
  await page.getByRole("button", { name: ar.auth.login, exact: true }).click();
  await page.waitForTimeout(1500);
  await shot(page, "driver-wrong-code");
  const wrongMsg = await alertText(page);
  await page.getByLabel(ar.driverWeb.code).fill(code);
  await page.getByRole("button", { name: ar.auth.login, exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/driver", { timeout: 15_000 });
  await settle(page, Date.now());
  await audit(page, "driver /driver home", "mobile", "ar");
  await shot(page, "driver-home");
  const X = ar.driverApp;
  // Odometer reading with photo and GPS.
  await page.getByRole("button", { name: X.recordOdometer }).first().click();
  await shot(page, "driver-odometer-form");
  const last = await page.locator("p b").first().innerText().catch(() => "0");
  await page.locator("input[type=file]").first().setInputFiles(photoPath);
  await page.getByLabel(X.confirmOdometer).fill(String(Number(last.replace(/\D/g, "") || 0) + 35));
  await page.getByRole("button", { name: X.submit }).click();
  await page.waitForTimeout(2500);
  await shot(page, "driver-odometer-sent");
  const odoMsg = await page.locator("body").innerText();
  // Fuel entry, card payment.
  await page.getByRole("button", { name: X.recordFuel }).first().click();
  await page.getByLabel(X.quantity).fill("30");
  await page.getByLabel(X.amount).fill("75.750");
  await page.getByLabel(X.odometer).fill(String(Number(last.replace(/\D/g, "") || 0) + 40));
  await page.getByRole("button", { name: X.card }).click();
  await shot(page, "driver-fuel-form");
  await page.getByRole("button", { name: X.submit }).click();
  await page.waitForTimeout(2500);
  await shot(page, "driver-fuel-sent");
  const fuelErr = await alertText(page);
  await ctx.close();
  if (fuelErr) finding("high", "driver fuel entry", "driver-step-failed", fuelErr);
  return `wrong code → "${wrongMsg}" | odometer: ${odoMsg.includes(X.savedPendingApproval) ? "saved" : "check screenshot"} | fuel: ${fuelErr || "saved"}`;
});

await step("fleet manager: approve the driver's newest record from the inbox", async () => {
  const fm = fms[0];
  const { ctx, page } = await context("desktop");
  await login(page, fm.email, fm.password);
  await visit(page, "/approvals", "fleet_manager-inbox", "desktop", "ar");
  const before = await page.getByRole("button", { name: ar.approvals.approve, exact: true }).count();
  if (!before) throw new Error("nothing to approve");
  await page.getByRole("button", { name: ar.approvals.approve, exact: true }).first().click();
  await page.waitForTimeout(1500);
  const after = await page.getByRole("button", { name: ar.approvals.approve, exact: true }).count();
  await shot(page, "fleet-manager-after-approve");
  await ctx.close();
  return `${before} → ${after} waiting`;
});

await step("fleet manager (phone): approvals inbox", async () => {
  const fm = fms[0];
  const { ctx, page } = await context("mobile");
  await login(page, fm.email, fm.password);
  await visit(page, "/approvals", "fleet_manager-inbox", "mobile", "ar");
  await ctx.close();
});

await browser.close();

// ============================================================ Report
report.finishedAt = new Date().toISOString();
report.demo = { company: demo.company, pendingApprovals: demo.pendingApprovals, refusedByRules: demo.refused };
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
const order = { high: 0, medium: 1, low: 2 };
const grouped = new Map();
for (const f of report.findings) {
  const k = `${f.severity}|${f.kind}|${f.where}`;
  grouped.set(k, [...(grouped.get(k) ?? []), f.detail]);
}
const lines = [];
lines.push(`# Journey simulation — ${report.startedAt}`, "");
lines.push(`Steps: ${report.steps.filter((s) => s.ok).length}/${report.steps.length} ok · pages visited: ${report.pages.length} · findings: ${report.findings.length}`, "");
lines.push("## Steps", "", "| | Step | ms | Detail |", "|---|---|---|---|");
for (const s of report.steps) lines.push(`| ${s.ok ? "✅" : "❌"} | ${s.name} | ${s.ms} | ${(s.ok ? s.detail ?? "" : s.error).toString().replace(/\|/g, "/").slice(0, 300)} |`);
lines.push("", "## Findings", "", "| Severity | Kind | Where | Detail |", "|---|---|---|---|");
for (const [k, details] of [...grouped].sort((a, b) => order[a[0].split("|")[0]] - order[b[0].split("|")[0]])) {
  const [sev, kind, where] = k.split("|");
  lines.push(`| ${sev} | ${kind} | ${where} | ${[...new Set(details)].slice(0, 3).join("; ").replace(/\|/g, "/").slice(0, 300)} |`);
}
lines.push("", "## Pages (slowest first)", "", "| Role | Page | View | Lang | ms | Sideways px | Wide tables | Errors | Shot |", "|---|---|---|---|---|---|---|---|---|");
for (const p of [...report.pages].sort((a, b) => b.ms - a.ms)) lines.push(`| ${p.role} | ${p.url} | ${p.view} | ${p.locale} | ${p.ms} | ${p.overflow} | ${p.tables} | ${p.problems} | ${p.shot} |`);
lines.push("", "## Demo data refused by the rules", "", ...(demo.refused?.length ? demo.refused.map((r) => `- ${r}`) : ["- none"]));
fs.writeFileSync(path.join(OUT, "summary.md"), lines.join("\n"));
console.log(`\nDone: ${report.steps.filter((s) => s.ok).length}/${report.steps.length} steps ok, ${report.findings.length} findings.`);
