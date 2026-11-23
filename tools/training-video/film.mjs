/**
 * Films the training video: a slow, narrated walk through every role on a throw-away stack in CI
 * (.github/workflows/training-video.yml) — never against staging or production.
 *
 * Each recording is captured with the Chrome screencast (high-quality JPEG frames with timestamps), not
 * Playwright's built-in video, so text stays sharp. Every beat of script.ar.mjs runs its actions while its voice
 * plays, then waits for the voice to end. Long waits are marked as cuts and removed by assemble.mjs.
 * Every check() is shown live on screen (overlay.js) and written to live-test.json / live-test.md.
 *
 * Needs: OUT_DIR with audio/index.json (tts.py), DEMO_FILE (apps/api/dist/cli/demo.js output), PLATFORM_EMAIL /
 * PLATFORM_PASSWORD. Writes OUT_DIR/timeline.json, guide-shots/*.png, live-test.{json,md}; frames to FRAMES_DIR.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, ar, messages, TUNIS, settle, login as quickLogin, apiLogin, apiCall, alertText } from "../journey/lib.mjs";
import { CHAPTERS } from "./script.ar.mjs";

const OUT = path.resolve(process.env.OUT_DIR ?? "training-out");
const FRAMES = path.resolve(process.env.FRAMES_DIR ?? path.join(OUT, "frames"));
const SHOTS = path.join(OUT, "guide-shots");
const AUDIO = JSON.parse(fs.readFileSync(path.join(OUT, "audio", "index.json"), "utf8"));
const demo = JSON.parse(fs.readFileSync(process.env.DEMO_FILE, "utf8"));
const PLATFORM = { email: process.env.PLATFORM_EMAIL, password: process.env.PLATFORM_PASSWORD };
const OVERLAY = fileURLToPath(new URL("./overlay.js", import.meta.url));
const GAP = 450; // ms of quiet after each beat's voice
const X = ar.driverApp;
const stamp = Date.now().toString(36);
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(FRAMES, { recursive: true });

const PARTS = Object.fromEntries(CHAPTERS.flatMap((c) => c.parts.map((p) => [p.key, { ...p, chapter: c.id }])));
const timeline = { startedAt: new Date().toISOString(), recordings: [], checks: [], errors: [], shots: {} };
const HUD = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();

const VIEW = {
  // 1440×810 laid out, drawn at 4/3 → 1920×1080 frames.
  desktop: { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3, max: { maxWidth: 1920, maxHeight: 1080 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, max: { maxWidth: 780, maxHeight: 1688 } },
};

async function open(kind, { locale = "ar", theme = "light" } = {}) {
  const { max, ...view } = VIEW[kind];
  const ctx = await browser.newContext({ ...view, locale: "ar-TN", timezoneId: "Africa/Tunis", geolocation: TUNIS, permissions: ["geolocation"], acceptDownloads: true });
  await ctx.addInitScript(([l, th, hud, phone]) => {
    try {
      // Language and theme only on the first page of the context, so switching them on camera sticks.
      if (!sessionStorage.getItem("__tv_boot")) { localStorage.setItem("fleet.locale", l); if (th) localStorage.setItem("fleet.theme", th); sessionStorage.setItem("__tv_boot", "1"); }
    } catch { /* storage blocked */ }
    window.__tvInit = { hud, phone };
  }, [locale, theme, HUD, kind === "phone"]);
  await ctx.addInitScript({ path: OVERLAY });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => timeline.errors.push(`page error (${kind}): ${String(e.message).slice(0, 200)}`));
  return { ctx, page };
}

// ------------------------------------------------------------------ recording
/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
async function record(page, key) {
  const part = PARTS[key];
  if (!part || part.type !== "rec") throw new Error(`no recording part ${key}`);
  const dir = path.join(FRAMES, key);
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const rec = { key, chapter: part.chapter, kind: part.kind, dir, frames: [], beats: [], cuts: [], cutMs: 0, page, startAt: Date.now() };
  let n = 0;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `${String(n++).padStart(6, "0")}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(data, "base64"));
    rec.frames.push({ file, t: metadata.timestamp ? metadata.timestamp * 1000 : Date.now() });
    if (n === 1) { const s = jpegSize(Buffer.from(data, "base64")); console.log(`  [${key}] first frame ${s ? `${s.w}×${s.h} px` : "?"} (${metadata.deviceWidth}×${metadata.deviceHeight} css)`); }
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  // Every 2nd frame: at most 30 a second, the video's rate.
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 2, ...VIEW[part.kind].max });
  await sleep(300);
  rec.stop = async () => {
    await sleep(400);
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.detach().catch(() => {});
    rec.endAt = Date.now();
    const want = part.beats.map((b) => b.id), got = rec.beats.map((b) => b.id);
    if (want.join() !== got.join()) timeline.errors.push(`${key}: beats ${got.join(",")} differ from the script ${want.join(",")}`);
    const { page: _p, stop: _s, ...plain } = rec;
    timeline.recordings.push(plain);
    console.log(`  [${key}] ${rec.frames.length} frames, ${((rec.endAt - rec.startAt) / 1000).toFixed(0)} s, ${rec.cuts.length} cuts`);
  };
  return rec;
}

/** One narrated beat: the actions run while the voice plays; then wait until the voice has finished. */
async function beat(rec, id, fn) {
  const audio = AUDIO[id];
  if (!audio) throw new Error(`no voice for ${id}`);
  const b = { id, start: Date.now() };
  rec.beats.push(b);
  const cut0 = rec.cutMs;
  try {
    if (fn) await fn();
    console.log(`✓ ${id}`);
  } catch (e) {
    b.error = String(e.message ?? e).slice(0, 300);
    timeline.errors.push(`${id}: ${b.error}`);
    console.log(`✗ ${id}: ${b.error}`);
  }
  const active = Date.now() - b.start - (rec.cutMs - cut0);
  const need = audio.duration * 1000 + GAP;
  if (active < need) await sleep(need - active);
  b.end = Date.now();
  await rec.page.evaluate(() => window.__tv?.clear()).catch(() => {});
}

/** Runs a long wait; everything after the first `keep` ms of it is cut from the video. */
async function cut(rec, fn, keep = 1800) {
  const s = Date.now();
  const r = await fn();
  const e = Date.now();
  if (e - s > keep + 1500) {
    const c = { start: s + keep, end: e - 700 };
    rec.cuts.push(c);
    rec.cutMs += c.end - c.start;
  }
  return r;
}

// ------------------------------------------------------------------ presenter actions
async function inView(loc) {
  const ok = await loc.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 70 && r.bottom <= innerHeight - 10; }).catch(() => true);
  if (!ok) {
    await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })).catch(() => {});
    await sleep(900);
  }
}
async function point(page, loc, { label, ms = 650 } = {}) {
  await loc.waitFor({ state: "visible", timeout: 10_000 });
  await inView(loc);
  const box = await loc.boundingBox();
  if (!box) throw new Error("element not on screen");
  await page.evaluate(([x, y, t]) => window.__tv?.move(x, y, t), [box.x + box.width / 2, box.y + box.height / 2, ms]);
  await sleep(ms + 60);
  if (label) await page.evaluate(([b, t]) => window.__tv?.ring(b, t), [box, label]);
  return box;
}
async function click(page, loc, opts = {}) {
  const box = await point(page, loc, opts);
  await page.evaluate(([x, y]) => window.__tv?.tap(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
  await loc.click();
  await sleep(300);
}
async function type(page, loc, text, { delay = 40 } = {}) {
  await click(page, loc);
  await loc.fill("");
  await loc.pressSequentially(text, { delay });
  await sleep(150);
}
async function ring(page, loc, label, hold = 0) {
  await loc.waitFor({ state: "visible", timeout: 10_000 });
  await inView(loc);
  const box = await loc.boundingBox();
  if (!box) throw new Error("element not on screen");
  await page.evaluate(([b, t]) => window.__tv?.ring(b, t), [box, label ?? ""]);
  if (hold) await sleep(hold);
}
const toast = (page, text) => page.evaluate((t) => window.__tv?.toast(t), text).catch(() => {});
const untoast = (page) => page.evaluate(() => window.__tv?.untoast()).catch(() => {});
const clearRing = (page) => page.evaluate(() => window.__tv?.clear()).catch(() => {});
async function scrollBy(page, px) {
  await page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), px);
  await sleep(900);
}
async function top(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(500);
}

/** First visible of several candidates. */
async function first(page, selectors) {
  for (const s of selectors) {
    const loc = typeof s === "string" ? page.locator(s).first() : s;
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return page.locator("main h1").first();
}
const mainContent = (page) => first(page, ["main table", "main ul", "main form", "main section", "main .grid"]);

/** Goes to a page the way a person does: through the side menu when the link is there. */
async function nav(page, href) {
  const link = page.locator(`aside nav a[href="${href}"]`).first();
  if (await link.isVisible().catch(() => false)) {
    await click(page, link, { ms: 550 });
    await page.waitForURL((u) => u.pathname === href, { timeout: 15_000 }).catch(() => {});
  } else {
    await page.goto(BASE + href);
  }
  await settle(page);
}
async function show(page, href, label) {
  await nav(page, href);
  await ring(page, await mainContent(page), label);
}

async function check(page, name, ok, detail = "") {
  HUD.push({ name, ok: !!ok });
  timeline.checks.push({ name, ok: !!ok, detail: String(detail ?? "").slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 120)}` : ""}`);
  await page.evaluate(([n, o]) => window.__tv?.check(n, o), [name, !!ok]).catch(() => {});
}

/** A clean screenshot for the written guide (presenter layer hidden). */
async function snap(page, key) {
  await page.screenshot({ path: path.join(SHOTS, `${key}.png`), style: "#__tv-host{display:none!important}" }).catch((e) => timeline.errors.push(`snap ${key}: ${e.message}`));
  timeline.shots[key] = `${key}.png`;
}

/** A believable meter photo showing the number the driver types. */
async function meterPhoto(value) {
  const p = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const digits = String(value).padStart(6, "0").split("").map((d) => `<b>${d}</b>`).join("");
  await p.setContent(`<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,#3a3f46,#111418)">
    <div style="padding:34px 40px;border-radius:28px;background:#0b0d10;box-shadow:inset 0 0 30px #000,0 0 0 10px #2a2f36">
    <div style="font:600 22px sans-serif;color:#8fa3b5;text-align:center;margin-bottom:12px">km</div>
    <div style="display:flex;gap:8px">${digits}</div></div>
    <style>b{display:block;width:62px;height:92px;line-height:92px;text-align:center;font:700 64px monospace;color:#f2f2f2;background:linear-gradient(#1d2228,#2e353d 50%,#1d2228);border-radius:8px}</style></body>`);
  const file = path.join(OUT, `meter-${value}.jpg`);
  await p.screenshot({ path: file, type: "jpeg", quality: 90 });
  await p.close();
  return file;
}

const byRole = (role) => demo.users.find((u) => u.role === role);
const admin = byRole("company_admin");
const fm = demo.users.find((u) => u.role === "fleet_manager");
const finance = byRole("finance_reviewer");
const fresh = { name: "شركة الزيتونة للخدمات", slug: `zitouna-${stamp}`, adminName: "إيناس الحمروني", adminEmail: `ines.${stamp}@zitouna.fleet.test`, password: `Zitouna-${Math.random().toString(36).slice(2)}A1` };
let invite = null;

// ================================================================== 1. Platform admin
{
  const { ctx, page } = await open("desktop");
  await page.goto(`${BASE}/login`);
  await settle(page);
  const rec = await record(page, "c1");
  await beat(rec, "c1.login", async () => {
    await type(page, page.getByLabel(ar.auth.email), PLATFORM.email);
    await type(page, page.getByLabel(ar.auth.password, { exact: true }), PLATFORM.password, { delay: 20 });
    await click(page, page.getByRole("button", { name: ar.auth.login, exact: true }));
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
    await settle(page);
  });
  await beat(rec, "c1.loginNote", async () => {
    await ring(page, await first(page, ["[data-testid=my-account]", "header"]), "مدير المنصة");
  });
  await beat(rec, "c1.tenants", async () => {
    await show(page, "/platform/tenants", "كل الشركات وحالة كل شركة");
    await snap(page, "platform-tenants");
  });
  await beat(rec, "c1.add", async () => {
    await click(page, page.getByRole("button", { name: ar.tenants.add }));
    await type(page, page.getByLabel(ar.tenants.name), fresh.name);
    await type(page, page.getByLabel(ar.tenants.slug), fresh.slug);
  });
  await beat(rec, "c1.country", async () => {
    const sel = page.getByLabel(ar.tenants.country);
    await point(page, sel, { label: "تونس: الدينار، توقيت تونس، الوثائق التونسية" });
    await sel.selectOption("TN");
  });
  await beat(rec, "c1.admin", async () => {
    await type(page, page.getByLabel(ar.tenants.adminName), fresh.adminName);
    await type(page, page.getByLabel(ar.tenants.adminEmail), fresh.adminEmail);
    await snap(page, "platform-new-company");
    await click(page, page.getByRole("button", { name: ar.common.save, exact: true }));
  });
  await beat(rec, "c1.invite", async () => {
    const code = page.locator("code", { hasText: "accept-invite" });
    await code.waitFor({ timeout: 20_000 });
    invite = (await code.innerText()).trim().replace(/^https?:\/\/[^/]+/, "");
    await ring(page, code, "رابط الدعوة لمدير الشركة");
    await check(page, "فتح شركة جديدة ورابط الدعوة", !!invite);
  });
  await beat(rec, "c1.prices", async () => {
    await show(page, "/platform/fuel-prices", "الأسعار الرسمية لكل دولة");
  });
  await beat(rec, "c1.more", async () => {
    await point(page, page.locator('aside nav a[href="/platform/ops"]').first(), { label: "المراقبة والنسخ الاحتياطي" });
  });
  await rec.stop();
  await ctx.close();
}

// ================================================================== 2. New company admin sets the company up
{
  const { ctx, page } = await open("desktop");
  await page.goto(BASE + (invite ?? "/login"));
  await settle(page);
  const rec = await record(page, "c2");
  const saved = async (name) => {
    await click(page, page.getByRole("button", { name: ar.common.save, exact: true }).first());
    await page.waitForTimeout(1500);
    const msg = await alertText(page);
    await check(page, name, !msg || /تم|حفظ/.test(msg), msg);
  };
  await beat(rec, "c2.invite", async () => {
    await type(page, page.getByLabel(ar.auth.newPassword), fresh.password, { delay: 20 });
    await click(page, page.getByRole("button", { name: ar.auth.activate }));
  });
  await beat(rec, "c2.wait", async () => {
    await toast(page, "⏳ جاري تجهيز قاعدة بيانات الشركة…");
    const ok = await cut(rec, () => page.waitForURL((u) => !u.pathname.startsWith("/accept-invite"), { timeout: 150_000 }).then(() => true).catch(() => false));
    await untoast(page);
    await settle(page);
    await check(page, "تفعيل حساب مدير الشركة", ok, new URL(page.url()).pathname);
  });
  await beat(rec, "c2.checklist", async () => {
    if (!page.url().includes("/dashboard")) await page.goto(`${BASE}/dashboard`);
    await settle(page);
    const ob = page.locator("[data-testid=onboarding]");
    const visible = await ob.isVisible().catch(() => false);
    if (visible) await ring(page, ob, "خطوات البداية بالترتيب");
    await check(page, "قائمة خطوات البداية", visible);
    await snap(page, "admin-onboarding");
  });
  await beat(rec, "c2.company", async () => {
    await nav(page, "/company");
    await type(page, page.getByLabel(ar.company.name), fresh.name);
    const phone = page.getByLabel(/الهاتف/).first();
    if (await phone.isVisible().catch(() => false)) await type(page, phone, "+216 74 000 111");
    const address = page.getByLabel(/العنوان/).first();
    if (await address.isVisible().catch(() => false)) await type(page, address, "نهج الزيتون، صفاقس");
    await saved("حفظ ملف الشركة");
  });
  await beat(rec, "c2.branches", async () => {
    await nav(page, "/branches");
    const tz = page.getByText("Africa/Tunis").first();
    const tunis = await tz.isVisible().catch(() => false);
    if (tunis) await ring(page, tz, "توقيت تونس تلقائي", 1200);
    await check(page, "المقر الرئيسي على توقيت تونس", tunis && !(await page.locator("main").innerText()).includes("Africa/Cairo"));
    await click(page, page.getByRole("button", { name: ar.branches.add }).first());
    await type(page, page.getByLabel(ar.branches.code), "SOU");
    await type(page, page.getByLabel(ar.branches.name), "فرع سوسة");
    await saved("إضافة فرع سوسة");
  });
  await beat(rec, "c2.vehicle", async () => {
    await nav(page, "/vehicles");
    await click(page, page.getByRole("button", { name: ar.vehicles.add }).first());
    await type(page, page.getByLabel(ar.vehicles.fleetNumber), "Z-001");
    await type(page, page.getByLabel(ar.vehicles.registrationNumber), "245 تونس 1234");
    await type(page, page.getByLabel(ar.vehicles.make), "Peugeot");
    await type(page, page.getByLabel(ar.vehicles.model), "Partner");
    await type(page, page.getByLabel(ar.vehicles.year), "2022");
    const tank = page.getByLabel(new RegExp(ar.vehicles.primaryTankCapacity));
    await type(page, tank, "55");
    await ring(page, tank, "سعة الخزان باللتر");
    await page.getByLabel(ar.vehicles.requiredLicenseCategory).selectOption("B").catch(() => {});
    await snap(page, "admin-vehicle-form");
    await saved("إضافة عربية");
  });
  await beat(rec, "c2.vehicleWhy", async () => {
    await ring(page, await first(page, [page.getByText("Z-001").first(), "main table"]), "العربية الجديدة Z-001");
  });
  await beat(rec, "c2.driver", async () => {
    await nav(page, "/drivers");
    await click(page, page.getByRole("button", { name: ar.drivers.add }).first());
    await type(page, page.getByLabel(ar.drivers.fullName), "ياسين الكافي");
    await type(page, page.getByLabel(ar.drivers.username), `yassine.${stamp}`);
    await page.getByLabel(/B — /).first().check().catch(() => {});
    await saved("إضافة سائق");
  });
  await beat(rec, "c2.code", async () => {
    await click(page, page.getByRole("button", { name: ar.drivers.issueCode }).first());
    const code = page.locator("[data-testid=activation-code]");
    const text = await code.innerText({ timeout: 8000 }).catch(() => "");
    if (text) await ring(page, code, "رمز التفعيل: يُستخدم مرة واحدة");
    await check(page, "إصدار رمز تفعيل للسائق", text.trim().length >= 4);
    await snap(page, "admin-activation-code");
  });
  await beat(rec, "c2.users", async () => {
    await nav(page, "/users");
    await click(page, page.getByRole("button", { name: ar.users.invite }).first());
    await type(page, page.getByLabel(ar.users.name), "لطفي الدريدي");
    await type(page, page.getByLabel(ar.users.email), `lotfi.${stamp}@zitouna.fleet.test`);
    await page.locator("form input[type=checkbox]").first().check().catch(() => {});
    await saved("دعوة مستخدم للمكتب");
  });
  await beat(rec, "c2.roles", async () => {
    await show(page, "/roles", "الأدوار والصلاحيات");
    await snap(page, "admin-roles");
  });
  await beat(rec, "c2.scopes", async () => {
    await ring(page, await first(page, ["main select", "main table"]), "غير مسموح · فروعه · الشركة كلها");
  });
  await beat(rec, "c2.prices", async () => {
    await show(page, "/fuel-prices", "السعر الرسمي لكل نوع وقود (±2%)");
  });
  await beat(rec, "c2.policies", async () => {
    await show(page, "/policies", "حدود التنبيه");
    await snap(page, "admin-policies");
  });
  await beat(rec, "c2.done", async () => {
    await nav(page, "/dashboard");
    await ring(page, await first(page, ["[data-testid=onboarding]", "main section"]), "الشركة جاهزة");
  });
  await rec.stop();
  await ctx.close();
}

// ================================================================== 3. Daily work in the demo company (30 days of data)
{
  const { ctx, page } = await open("desktop");
  await quickLogin(page, admin.email, admin.password);
  await page.goto(`${BASE}/dashboard`);
  await settle(page);
  const rec = await record(page, "c3");
  await beat(rec, "c3.dashboard", async () => {
    await ring(page, await first(page, ["main .grid", "main section"]), "ملخّص الأسطول");
    await snap(page, "ops-dashboard");
  });
  await beat(rec, "c3.charts", async () => {
    await scrollBy(page, 520);
    const chart = await first(page, ["main svg.recharts-surface", "main canvas", "main svg[viewBox]"]);
    await ring(page, chart, "الاستهلاك والتكاليف").catch(() => {});
  });
  await beat(rec, "c3.vehicles", async () => {
    await show(page, "/vehicles", "كل عربية برقمها ولوحتها وحالتها");
    await click(page, page.locator('main a[href^="/vehicles/"]').first());
    await page.waitForURL((u) => /\/vehicles\/.+/.test(u.pathname), { timeout: 15_000 });
    await settle(page);
  });
  await beat(rec, "c3.vehicleTabs", async () => {
    await ring(page, page.getByRole("tablist").first(), "تاريخ العربية كله");
  });
  await beat(rec, "c3.odometer", async () => {
    await click(page, page.getByRole("tab", { name: ar.m2.tabs.odometer }));
    await settle(page);
    await ring(page, await mainContent(page), "صورة العداد + الوقت + المكان");
    await snap(page, "ops-vehicle-odometer");
  });
  await beat(rec, "c3.fuelTab", async () => {
    await top(page);
    await click(page, page.getByRole("tab", { name: ar.m2.tabs.fuel }));
    await settle(page);
    await ring(page, await mainContent(page), "الاستهلاك من فُل لفُل");
  });
  await beat(rec, "c3.tasks", async () => {
    await show(page, "/tasks", "مهام العملاء: مشوار أو فترة");
    await snap(page, "ops-tasks");
  });
  await beat(rec, "c3.taskSwap", async () => {
    await ring(page, await first(page, ["main table tbody tr", "main li"]), "تبديل العربية أو السائق");
  });
  await beat(rec, "c3.customers", async () => { await show(page, "/customers", "العملاء"); });
  await beat(rec, "c3.fuel", async () => {
    await show(page, "/fuel", "مقارنة بالسعر الرسمي وسعة الخزان");
    await snap(page, "ops-fuel");
  });
  await beat(rec, "c3.fuelMap", async () => {
    const map = page.locator(".leaflet-container").first();
    await ring(page, map, "أماكن التعبئة · الأحمر عليه ملاحظة");
  });
  await beat(rec, "c3.costs", async () => { await show(page, "/costs", "التكاليف وتكلفة الكيلومتر"); });
  await beat(rec, "c3.budgets", async () => { await show(page, "/budgets", "تنبيه عند 80% و100%"); });
  await beat(rec, "c3.maintenance", async () => {
    await show(page, "/maintenance", "المستحق · أوامر الشغل · الأعطال");
    await snap(page, "ops-maintenance");
  });
  await beat(rec, "c3.readiness", async () => { await show(page, "/readiness", "مسموح تطلع ولا لأ"); });
  await beat(rec, "c3.documents", async () => { await show(page, "/documents", "الوثائق وتواريخ الانتهاء"); });
  await beat(rec, "c3.alerts", async () => {
    await show(page, "/alerts", "كل ما يحتاج انتباه");
    await snap(page, "ops-alerts");
  });
  await rec.stop();
  await ctx.close();
}

// ================================================================== 4. Driver on the phone (web version)
let adminToken = null;
try { adminToken = await apiLogin(admin.email, admin.password); } catch (e) { timeline.errors.push(`admin api login: ${e.message}`); }
const driverCode = async (d) => (await apiCall(adminToken, "POST", `/drivers/${d.driverId}/activation-code`, { purpose: "web" })).code;
{
  const d = demo.drivers[0];
  const code = await driverCode(d).catch((e) => { timeline.errors.push(`driver code: ${e.message}`); return ""; });
  const { ctx, page } = await open("phone");
  await page.goto(`${BASE}/login`);
  await settle(page);
  const rec = await record(page, "c4");
  let last = 0;
  await beat(rec, "c4.apk", async () => {
    await ring(page, page.getByTestId("download-app"), "تطبيق أندرويد", 2200);
    await click(page, page.getByTestId("driver-web-login"));
    await page.waitForURL((u) => u.pathname.startsWith("/driver/login"), { timeout: 15_000 });
    await settle(page);
  });
  await beat(rec, "c4.wrong", async () => {
    await type(page, page.getByLabel(ar.driverWeb.username), d.username);
    await type(page, page.getByLabel(ar.driverWeb.code), "000000", { delay: 90 });
    await click(page, page.getByRole("button", { name: ar.auth.login, exact: true }));
    await page.waitForTimeout(1500);
    const msg = await alertText(page);
    if (msg) await ring(page, page.locator("[role=alert]").first(), "رسالة واضحة");
    await check(page, "رمز خاطئ ← رسالة واضحة", !!msg, msg);
  });
  await beat(rec, "c4.login", async () => {
    await type(page, page.getByLabel(ar.driverWeb.code), code, { delay: 90 });
    await click(page, page.getByRole("button", { name: ar.auth.login, exact: true }));
    const ok = await page.waitForURL((u) => u.pathname === "/driver", { timeout: 15_000 }).then(() => true).catch(() => false);
    await settle(page);
    await check(page, "دخول السائق برمز التفعيل", ok);
  });
  await beat(rec, "c4.home", async () => {
    await ring(page, page.locator("main section").first(), "العربية المتسلّمة وآخر قراءة");
    await snap(page, "driver-home");
  });
  await beat(rec, "c4.odo", async () => {
    await click(page, page.getByRole("button", { name: X.recordOdometer }).first());
    last = Number((await page.locator("p b").first().innerText().catch(() => "0")).replace(/\D/g, "") || 0);
    const photo = await meterPhoto(last + 35);
    const input = page.locator("input[type=file]").first();
    await input.setInputFiles(photo);
    await sleep(600);
    await ring(page, await first(page, ["main form img", "main form"]), "صورة العداد + الوقت + الموقع");
  });
  await beat(rec, "c4.odoSend", async () => {
    await type(page, page.getByLabel(X.confirmOdometer), String(last + 35), { delay: 90 });
    await snap(page, "driver-odometer");
    await click(page, page.getByRole("button", { name: X.submit }));
    await page.waitForTimeout(2500);
    await check(page, "قراءة العداد بالصورة والموقع", (await page.locator("body").innerText()).includes(X.savedPendingApproval));
  });
  await beat(rec, "c4.fuel", async () => {
    await click(page, page.getByRole("button", { name: X.recordFuel }).first());
    await type(page, page.getByLabel(X.quantity), "30");
    await type(page, page.getByLabel(X.amount), "75.750");
    await type(page, page.getByLabel(X.odometer), String(last + 40));
    await click(page, page.getByRole("button", { name: X.card }));
    await snap(page, "driver-fuel");
  });
  await beat(rec, "c4.fuelSend", async () => {
    await click(page, page.getByRole("button", { name: X.submit }));
    await page.waitForTimeout(2500);
    const err = await alertText(page);
    await check(page, "تعبئة وقود بالدينار", !err, err);
  });
  await beat(rec, "c4.inspect", async () => {
    await click(page, page.getByRole("button", { name: X.inspection }).first());
    await settle(page);
    await ring(page, page.locator("main form > div").first(), "سليم · فيه مشكلة");
    await scrollBy(page, 450);
    await scrollBy(page, 450);
    await snap(page, "driver-inspection");
  });
  await beat(rec, "c4.inspectSend", async () => {
    await click(page, page.getByRole("button", { name: X.submit }));
    await page.waitForTimeout(2500);
    await check(page, "إرسال فحص المركبة", (await page.locator("body").innerText()).includes(X.savedPendingApproval));
  });
  await beat(rec, "c4.defect", async () => {
    await click(page, page.getByRole("button", { name: ar.m4.driver.report }).first());
    await type(page, page.getByLabel(ar.m4.driver.description), "صوت غريب في الفرامل الأمامية");
    const sev = page.getByLabel(ar.m4.driver.severity);
    await point(page, sev, { label: "الخطورة" });
    await sev.selectOption("high");
    await ring(page, page.getByLabel(ar.m4.driver.drivable), "ينفع يسوق ولا لأ؟");
    await snap(page, "driver-defect");
  });
  await beat(rec, "c4.defectSend", async () => {
    await click(page, page.getByRole("button", { name: X.submit }));
    await page.waitForTimeout(2500);
    const err = await alertText(page);
    await check(page, "بلاغ عطل", !err && (await page.locator("[role=status]").count()) > 0, err);
  });
  await beat(rec, "c4.tasks", async () => {
    await click(page, page.getByTestId("driver-web-tasks"));
    await settle(page);
    await ring(page, page.locator("main").first(), "مهامي");
    await sleep(1500);
    await click(page, page.getByRole("button", { name: X.back }).first());
  });
  await rec.stop();
  await ctx.close();
}
{
  const d = demo.drivers[1];
  const code = await driverCode(d).catch(() => "");
  const T = messages.tn;
  const { ctx, page } = await open("phone", { locale: "tn", theme: "dark" });
  await page.goto(`${BASE}/driver/login`);
  await page.getByLabel(T.driverWeb.username).fill(d.username);
  await page.getByLabel(T.driverWeb.code).fill(code);
  await page.getByRole("button", { name: T.auth.login, exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/driver", { timeout: 15_000 }).catch(() => {});
  await settle(page);
  const rec = await record(page, "c4b");
  await beat(rec, "c4.tn", async () => {
    await ring(page, page.locator("header select").first(), "تونسي", 1600);
    await ring(page, page.locator("main section").first(), "الوضع الليلي");
    await snap(page, "driver-home-tn-dark");
  });
  await rec.stop();
  await ctx.close();
}

// ================================================================== 5. Fleet manager decides
{
  const { ctx, page } = await open("desktop");
  await quickLogin(page, fm.email, fm.password);
  await page.goto(`${BASE}/approvals`);
  await settle(page);
  const rec = await record(page, "c5");
  const approveBtn = () => page.getByRole("button", { name: ar.approvals.approve, exact: true });
  await beat(rec, "c5.inbox", async () => {
    await ring(page, await mainContent(page), "كل اللي مستني مصادقة");
    await snap(page, "fm-approvals");
  });
  await beat(rec, "c5.why", async () => {
    await ring(page, await first(page, [page.getByText(ar.approvals.intro).first(), "main h1"]), "لا يُحتسب قبل المصادقة");
  });
  await beat(rec, "c5.detail", async () => {
    const item = approveBtn().first().locator("xpath=ancestor::*[self::article or self::li or self::tr or self::section][1]");
    await ring(page, (await item.isVisible().catch(() => false)) ? item : approveBtn().first(), "الصورة · الخريطة · مين سجّل");
  });
  await beat(rec, "c5.approve", async () => {
    const before = await approveBtn().count();
    await click(page, approveBtn().first());
    await page.waitForTimeout(1500);
    const after = await approveBtn().count();
    await check(page, "المصادقة على عنصر", before > 0 && after === before - 1, `${before} → ${after}`);
  });
  await beat(rec, "c5.reject", async () => {
    const before = await approveBtn().count();
    await click(page, page.getByRole("button", { name: ar.approvals.reject, exact: true }).first());
    await type(page, page.getByLabel(ar.approvals.reason).first(), "الرقم لا يطابق الصورة");
    await click(page, page.getByRole("button", { name: ar.approvals.confirmReject }).first());
    await page.waitForTimeout(1500);
    const after = await approveBtn().count();
    await check(page, "الرفض مع ذكر السبب", before > 0 && after === before - 1, `${before} → ${after}`);
  });
  await beat(rec, "c5.rule", async () => {
    await toast(page, "اللي سجّل حاجة ميقدرش يصادق عليها بنفسه");
  });
  await beat(rec, "c5.settings", async () => {
    await untoast(page);
    const s = page.getByText(ar.approvals.settings).first();
    if (await s.isVisible().catch(() => false)) await ring(page, s, "يحتاج مصادقة · تلقائي");
    else await toast(page, "إعداد المصادقة التلقائية عند مدير الشركة");
  });
  await untoast(page);
  await rec.stop();
  await ctx.close();
}
{
  const { ctx, page } = await open("phone");
  await quickLogin(page, fm.email, fm.password);
  await page.goto(`${BASE}/approvals`);
  await settle(page);
  const rec = await record(page, "c5b");
  await beat(rec, "c5.phone", async () => {
    await scrollBy(page, 380);
    const btn = page.getByRole("button", { name: ar.approvals.approve, exact: true }).first();
    if (await btn.isVisible().catch(() => false)) await ring(page, btn, "مصادقة من الموقع");
  });
  await rec.stop();
  await ctx.close();
}

// ================================================================== 6. Finance
{
  const { ctx, page } = await open("desktop");
  await quickLogin(page, finance.email, finance.password);
  await page.goto(`${BASE}/reports`);
  await settle(page);
  const rec = await record(page, "c6");
  await beat(rec, "c6.reports", async () => {
    await ring(page, await first(page, ["main select", "main form"]), "تسع تقارير");
  });
  await beat(rec, "c6.run", async () => {
    await click(page, page.getByRole("button", { name: ar.m5.reports.run }));
    await settle(page);
    await ring(page, await first(page, ["main table", "main section"]), "النتيجة");
  });
  await beat(rec, "c6.excel", async () => {
    const btn = page.getByRole("button", { name: ar.m5.reports.xlsx });
    const box = await point(page, btn, { label: "تصدير Excel" });
    await page.evaluate(([x, y]) => window.__tv?.tap(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20_000 }), btn.click()]);
    const name = dl.suggestedFilename();
    await toast(page, `⬇ ${name}`);
    await check(page, "تصدير التقرير لإكسل", /\.xlsx$/i.test(name), name);
    await snap(page, "finance-reports");
    await sleep(1200);
    await untoast(page);
  });
  await beat(rec, "c6.fines", async () => { await show(page, "/fines", "المخالفات والسائق المقترح"); });
  await beat(rec, "c6.denied", async () => {
    await page.goto(`${BASE}/users`);
    const denied = page.locator("[data-testid=access-denied]");
    const shown = await denied.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    if (shown) await ring(page, denied, "مالوش صلاحية");
    await check(page, "منع صفحة خارج الصلاحية", shown);
  });
  await rec.stop();
  await ctx.close();
}

// ================================================================== 7. Security and control
{
  const { ctx, page } = await open("desktop", { theme: null });
  await page.goto(`${BASE}/login`);
  await settle(page);
  const rec = await record(page, "c7");
  await beat(rec, "c7.wrong", async () => {
    await type(page, page.getByLabel(ar.auth.email), admin.email);
    await type(page, page.getByLabel(ar.auth.password, { exact: true }), "wrong-password-123", { delay: 25 });
    await click(page, page.getByRole("button", { name: ar.auth.login, exact: true }));
    await page.waitForTimeout(1500);
    const msg = await alertText(page);
    if (msg) await ring(page, page.locator("[role=alert]").first(), "رسالة واضحة");
    await check(page, "كلمة سر خاطئة ← رسالة واضحة", !!msg, msg);
  });
  await beat(rec, "c7.audit", async () => {
    await type(page, page.getByLabel(ar.auth.password, { exact: true }), admin.password, { delay: 15 });
    await click(page, page.getByRole("button", { name: ar.auth.login, exact: true }));
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
    await settle(page);
    await nav(page, "/audit");
    await ring(page, await mainContent(page), "مين عمل إيه وإمتى");
    const text = await page.locator("main").innerText();
    await check(page, "سجل المراجعة بكلام مفهوم", !/\b[a-z]+(?:Minor|Id)\b|\bnull\b/.test(text));
    await snap(page, "security-audit");
  });
  const picker = () => page.locator('header select:has(option[value="fr"])').first();
  await beat(rec, "c7.lang", async () => {
    await point(page, picker(), { label: "اللغة" });
    await picker().selectOption("tn");
    await sleep(700);
    await clearRing(page);
  });
  await beat(rec, "c7.lang2", async () => {
    await picker().selectOption("fr");
    await sleep(2200);
    await picker().selectOption("en");
    await sleep(2200);
    await picker().selectOption("ar");
  });
  await beat(rec, "c7.theme", async () => {
    const toggle = page.getByTestId("theme-toggle");
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await click(page, toggle, { label: "الوضع الليلي" });
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    await sleep(1200);
    await page.reload();
    await settle(page);
    const kept = await page.evaluate(() => document.documentElement.dataset.theme);
    await check(page, "الوضع الليلي يتبدّل ويتحفظ", before !== after && kept === after, `${before} → ${after} → ${kept}`);
  });
  await rec.stop();
  await ctx.close();
}

await browser.close();

// ================================================================== Results
timeline.finishedAt = new Date().toISOString();
const passed = timeline.checks.filter((c) => c.ok).length;
const result = { passed, total: timeline.checks.length, failed: timeline.checks.filter((c) => !c.ok), errors: timeline.errors };
fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify(timeline, null, 1));
fs.writeFileSync(path.join(OUT, "live-test.json"), JSON.stringify({ ...result, checks: timeline.checks }, null, 2));
const md = ["# الاختبار الحي — نتيجة تصوير الفيديو التدريبي", "", `${timeline.startedAt} · نجح ${passed} من ${timeline.checks.length}`, "", "| | الفحص | التفاصيل |", "|---|---|---|"];
for (const c of timeline.checks) md.push(`| ${c.ok ? "✅" : "❌"} | ${c.name} | ${c.detail.replace(/\|/g, "/")} |`);
md.push("", "## Errors", "", ...(timeline.errors.length ? timeline.errors.map((e) => `- ${e}`) : ["- none"]));
fs.writeFileSync(path.join(OUT, "live-test.md"), md.join("\n"));
console.log(`\nFilmed ${timeline.recordings.length} recordings · checks ${passed}/${timeline.checks.length} · ${timeline.errors.length} errors`);
