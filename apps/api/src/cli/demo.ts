/**
 * Phase 6 (owner decision 14 Nov 2026): a demo company full of realistic fake data, made through the real API so
 * every rule applies (approvals, maker ≠ checker, scopes, overlaps). Run inside the staging api container:
 *
 *   docker compose --env-file .env -f docker-compose.yml run --rm api node dist/cli/demo.js
 *
 * Tunisian company (owner, 22 Nov 2026: amounts in the country's currency, the dinar): head office in Tunis and a
 * branch in Sfax, Tunisian fuels, licence categories, plates and phone numbers, amounts in millimes.
 *
 * It makes a temporary platform-admin "bot" (switched off at the end), creates the company, its people, vehicles,
 * drivers, customers and 30 days of activity (fuel with places, readings, defects, inspections, tasks with a
 * breakdown swap, costs, maintenance), approves most of it and rejects a few, and prints the sign-ins.
 * Every email is @demo.fleet.test (never delivered). Safe to run again: each run makes a new company.
 * DEMO_OUT=<file> also writes the sign-ins as JSON (used by the journey simulation in CI).
 */
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { controlDb, newId, randomToken, schema, sha256 } from "@fleet/db";
import { INSPECTION_ITEMS } from "@fleet/config";
import { AuthService } from "../auth/auth.service.js";

const API = (process.env.DEMO_API_URL ?? "http://api:4000").replace(/\/$/, "");
const DAY = 86_400_000;
const NOW = Date.now();
// Tunisia is UTC+1 all year.
const ago = (days: number, hour = 9) => { const d = new Date(NOW - days * DAY); d.setUTCHours(hour - 1, Math.floor(Math.random() * 50), 0, 0); return d.toISOString(); };
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const rnd = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
const near = (lat: number, lng: number) => ({ lat: Math.round((lat + (Math.random() - 0.5) * 0.08) * 1e6) / 1e6, lng: Math.round((lng + (Math.random() - 0.5) * 0.08) * 1e6) / 1e6, accuracyM: rnd(5, 40) });
const TUNIS = [36.8065, 10.1815] as const, SFAX = [34.7406, 10.7603] as const;
/** Pump prices in millimes per litre (approximate, for demo data only). */
const PRICE = { SSP: 2525, GO: 1985 } as const;
const phone = () => `+216 ${pick(["2", "5", "9"])}${rnd(1, 9)} ${rnd(100, 999)} ${rnd(100, 999)}`;
const sfx = randomBytes(2).toString("hex");
const password = () => `Demo-${randomBytes(6).toString("hex")}`;
const log = (s: string) => console.log(`[demo] ${s}`);
const problems: string[] = [];
const COMPANY = "شركة قرطاج للنقل (تجريبية)";

type Res = { status: number; body: any; cookies: string[] };
/** fetch that waits and tries again when the API says "too many requests" (staging keeps the normal limits). */
async function polite(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || attempt >= 12) return r;
    const body = await r.clone().json().catch(() => null) as { error?: { fields?: { retryAfter?: string } } } | null;
    const wait = Number(r.headers.get("retry-after") ?? body?.error?.fields?.retryAfter ?? 10);
    log(`rate limited, waiting ${wait} s`);
    await new Promise((res) => setTimeout(res, (Math.max(1, wait) + 1) * 1000));
  }
}

async function call(method: string, path: string, token: string | null, body?: unknown, cookie?: string): Promise<Res> {
  const r = await polite(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, cookies: r.headers.getSetCookie?.() ?? [] };
}
/** Must succeed; otherwise stop with the API's answer. */
async function must(method: string, path: string, token: string | null, body?: unknown, ok = [200, 201, 202]) {
  const r = await call(method, path, token, body);
  if (!ok.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body;
}
/** May fail (a rule said no): the reason is kept in the report, the run goes on. */
async function maybe(label: string, method: string, path: string, token: string | null, body?: unknown) {
  const r = await call(method, path, token, body);
  if (r.status >= 300) problems.push(`${label}: ${r.status} ${r.body?.error?.code ?? ""} ${JSON.stringify(r.body?.error?.fields ?? {})}`);
  return r.status < 300 ? r.body : null;
}

async function main() {
  const { db, pool } = controlDb(process.env.CONTROL_DATABASE_URL!);
  // ---- 1. A temporary platform admin with a trusted browser (no email code), switched off at the end.
  const botEmail = `demo-bot-${sfx}@demo.fleet.test`, botPass = password();
  const botId = newId();
  await db.insert(schema.identities).values({ id: botId, email: botEmail, displayName: "Demo bot", passwordHash: await AuthService.hashPassword(botPass), isPlatformAdmin: true });
  const trusted = randomToken(32);
  await db.insert(schema.trustedDevices).values({ id: newId(), identityId: botId, tokenHash: sha256(trusted), userAgent: "demo", expiresAt: new Date(NOW + DAY) });
  try {
    const login = await call("POST", "/auth/login", null, { email: botEmail, password: botPass }, `fleet_td=${trusted}`);
    if (login.status !== 200 || !login.body.accessToken) throw new Error(`bot login ${login.status} ${JSON.stringify(login.body)}`);
    const platform = login.body.accessToken as string;

    // ---- 2. The company.
    const slug = `demo-carthage-${sfx}`;
    const adminEmail = `admin.${sfx}@demo.fleet.test`;
    const t = await must("POST", "/platform/tenants", platform, { name: COMPANY, slug, countryCode: "TN", adminEmail, adminName: "مريم بن يوسف" });
    log(`company ${slug}: provisioning…`);
    for (let i = 0; i < 60; i++) {
      const s = await must("GET", `/platform/tenants/${t.tenant.id}`, platform);
      if (s.status === "active") break;
      if (s.status === "failed") throw new Error(`provisioning failed: ${s.failureReason}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    const pw: Record<string, string> = {};
    const people: { email: string; name: string; role: string }[] = [{ email: adminEmail, name: "مريم بن يوسف", role: "company_admin" }];
    pw[adminEmail] = password();
    const admin = (await must("POST", "/auth/accept-invite", null, { token: t.adminInviteToken, password: pw[adminEmail] })).accessToken as string;
    await must("PATCH", "/company", admin, { address: "15 نهج الحبيب بورقيبة، تونس 1001", phone: "+216 71 123 456", email: "contact@carthage-demo.test", commercialRegister: "B0123456789", taxNumber: "1234567/A/M/000" });

    // ---- 3. Branches and people.
    const branches = (await must("GET", "/branches", admin)).items as { id: string; name: string }[];
    const hq = branches[0]!.id;
    const sfx2 = (await must("POST", "/branches", admin, { code: "SFX", name: "فرع صفاقس", timezone: "Africa/Tunis" })).id as string;
    const invite = async (email: string, name: string, role: string, branchIds: string[], extra: Record<string, unknown> = {}) => {
      const r = await must("POST", "/users", admin, { email, displayName: name, role, branchIds, ...extra });
      pw[email] = password();
      people.push({ email, name, role });
      return (await must("POST", "/auth/accept-invite", null, { token: r.inviteToken, password: pw[email] })).accessToken as string;
    };
    const fmTunis = await invite(`fm.tunis.${sfx}@demo.fleet.test`, "أيمن الطرابلسي (مسؤول الحركة — تونس)", "fleet_manager", [hq]);
    const fmSfax = await invite(`fm.sfax.${sfx}@demo.fleet.test`, "سنية بن علي (مسؤولة الحركة — صفاقس)", "fleet_manager", [sfx2]);
    await invite(`finance.${sfx}@demo.fleet.test`, "هالة الشابي (المسؤولة المالية)", "finance_reviewer", []);
    const supervisor = await must("POST", "/roles", admin, { nameAr: "مشرف وردية", nameEn: "Shift supervisor", permissions: { "vehicle.read": "branches", "task.read": "branches", "fuel.read": "branches", "defect.triage": "branches" } });
    await invite(`shift.${sfx}@demo.fleet.test`, "وليد الجلاصي (مشرف وردية)", "custom", [hq], { roleId: supervisor.id });
    log("people ready");

    // ---- 4. Vehicles, drivers, assignments. Trucks run on diesel (GO) and need a C1 licence; the rest is petrol (SSP), B.
    const models = [["Isuzu", "NPR", "C1"], ["Peugeot", "Partner", "B"], ["Iveco", "Daily", "C1"], ["Toyota", "Hilux", "B"], ["Renault", "Kangoo", "B"], ["Mitsubishi", "L200", "B"], ["Hyundai", "H1", "B"], ["Citroën", "Berlingo", "B"]] as const;
    const driverNames = ["محمد الهادي بن صالح", "أنيس الماجري", "سامي العياري", "خالد الزواري", "رامي القصري", "مهدي بن عمر", "نزار الحمامي", "حمزة السويسي"];
    const fleet: { id: string; branch: string; fm: string; odo: number; driverId: string; username: string; fleetNumber: string; fuel: "SSP" | "GO"; center: readonly [number, number] }[] = [];
    for (let i = 0; i < 8; i++) {
      const [make, model, lic] = models[i]!;
      const branch = i < 5 ? hq : sfx2, fm = i < 5 ? fmTunis : fmSfax, center = i < 5 ? TUNIS : SFAX;
      const fuel = lic === "C1" ? "GO" : "SSP";
      const v = await must("POST", "/vehicles", admin, {
        branchId: branch, fleetNumber: `C-${101 + i}`, registrationNumber: `${rnd(180, 250)} تونس ${rnd(1000, 9999)}`, make, model, year: rnd(2018, 2024),
        primaryFuelType: fuel, primaryTankCapacity: lic === "C1" ? 100 : 55, meterType: "distance", requiredLicenseCategory: lic, ownershipType: "owned",
      });
      const odo = rnd(20_000, 140_000);
      await must("POST", "/meter-readings", admin, { vehicleId: v.id, value: odo, eventAt: ago(40), opening: true });
      const username = `drv${i + 1}.${sfx}`;
      const d = await must("POST", "/drivers", admin, { branchId: branch, fullName: driverNames[i], username, phone: phone(), licenseCategories: lic === "C1" ? ["B", "C1"] : ["B"], licenseExpiry: i === 6 ? new Date(NOW + 20 * DAY).toISOString().slice(0, 10) : "2029-06-30" });
      await must("POST", "/assignments", admin, { vehicleId: v.id, driverId: d.id, role: "primary", startsAt: ago(39) });
      fleet.push({ id: v.id, branch, fm, odo, driverId: d.id, username, fleetNumber: `C-${101 + i}`, fuel, center });
    }
    // Driver devices (like the phone app).
    const driverToken: Record<string, string> = {};
    for (const f of fleet) {
      const c = await must("POST", `/drivers/${f.driverId}/activation-code`, admin, { purpose: "phone" });
      driverToken[f.driverId] = (await must("POST", "/auth/driver/activate", null, { username: f.username, code: c.code, deviceName: "Demo phone", platform: "android" })).accessToken;
    }
    log("vehicles and drivers ready");

    // ---- 4b. Papers (training video, 23 Nov 2026): without its mandatory documents every vehicle is rightly
    // restricted, which is not what a running company looks like. The admin uploads the mandatory Tunisian papers and
    // the branch's fleet manager verifies them (maker ≠ checker). Two gaps on purpose, so readiness has something real
    // to show: C-106's insurance runs out in 12 days, and C-108's technical inspection is missing.
    const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    const inDays = (n: number) => new Date(NOW + n * DAY).toISOString().slice(0, 10);
    const paper = async (entityType: "vehicle" | "driver", entityId: string, typeCode: string, checker: string, expiryDate: string | null, number: string) => {
      const d = await maybe(`document ${typeCode}`, "POST", "/documents", admin, { entityType, entityId, typeCode, number, issueDate: inDays(-200), expiryDate });
      if (!d) return;
      const up = await polite(`${API}/documents/${d.id}/file`, { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/pdf", "x-file-name": `${typeCode}.pdf` }, body: PDF });
      if (!up.ok) { problems.push(`document ${typeCode} file: ${up.status}`); return; }
      if (await maybe(`submit ${typeCode}`, "POST", `/documents/${d.id}/submit`, admin)) await maybe(`verify ${typeCode}`, "POST", `/documents/${d.id}/verify`, checker);
    };
    for (const [i, f] of fleet.entries()) {
      await paper("vehicle", f.id, "TN_VEH_REGISTRATION", f.fm, null, `CG-${rnd(100000, 999999)}`);
      await paper("vehicle", f.id, "TN_VEH_INSURANCE", f.fm, f.fleetNumber === "C-106" ? inDays(12) : inDays(rnd(120, 300)), `ASS-${rnd(10000, 99999)}`);
      if (f.fleetNumber !== "C-108") await paper("vehicle", f.id, "TN_VEH_INSPECTION", f.fm, inDays(rnd(90, 330)), `VT-${rnd(10000, 99999)}`);
      await paper("vehicle", f.id, "TN_VEH_TAX", f.fm, inDays(rnd(100, 330)), `VIG-${rnd(10000, 99999)}`);
      await paper("driver", f.driverId, "TN_DRV_LICENSE", f.fm, i === 6 ? inDays(20) : "2029-06-30", `P-${rnd(1000000, 9999999)}`);
      await paper("driver", f.driverId, "TN_DRV_CIN", f.fm, null, String(rnd(10000000, 19999999)));
    }
    log("documents ready");

    // ---- 5. Thirty days of driving: odometer readings and fuel with the station's place, an inspection a week.
    for (let day = 30; day >= 1; day--) {
      for (const f of fleet) {
        const tok = driverToken[f.driverId]!;
        f.odo += rnd(60, 260);
        if (day % 3 === f.fleetNumber.length % 3) {
          const q = rnd(25, f.fleetNumber === "C-103" ? 95 : 48);
          await maybe(`fuel ${f.fleetNumber} d-${day}`, "POST", "/fuel-entries", tok, {
            vehicleId: f.id, odometer: f.odo, fuelType: f.fuel, quantity: q, amountMinor: Math.round(q * PRICE[f.fuel] * (0.97 + Math.random() * 0.06)),
            isFull: Math.random() > 0.3, payment: Math.random() > 0.25 ? "card" : "cash", eventAt: ago(day, rnd(8, 18)), location: near(...f.center), locationStatus: "ok",
          });
        } else if (day % 2 === 0) {
          await maybe(`reading ${f.fleetNumber} d-${day}`, "POST", "/meter-readings", tok, { vehicleId: f.id, value: f.odo, eventAt: ago(day, 20), photoTakenAt: ago(day, 20), location: near(...f.center), locationStatus: "ok" });
        }
        if (day % 7 === 0) {
          const items = INSPECTION_ITEMS.map((i) => ({ code: i.code, ok: Math.random() > 0.08, note: null as string | null }));
          for (const i of items) if (!i.ok) i.note = pick(["يحتاج إلى تغيير", "يوجد صوت غير عادي", "ناقص", "مكسور جزئيًا"]);
          await maybe(`inspection ${f.fleetNumber}`, "POST", "/inspections", tok, { vehicleId: f.id, odometer: f.odo, at: ago(day, 7), items });
        }
      }
    }
    // A wrong reading (typo) that the fleet manager will reject, and two defects.
    await maybe("typo reading", "POST", "/meter-readings", driverToken[fleet[1]!.driverId]!, { vehicleId: fleet[1]!.id, value: fleet[1]!.odo + 90_000, eventAt: ago(0, 8) });
    await maybe("defect 1", "POST", "/defects", driverToken[fleet[2]!.driverId]!, { vehicleId: fleet[2]!.id, description: "صوت قوي في الفرامل الأمامية", severity: "high", drivable: true });
    await maybe("defect 2", "POST", "/defects", driverToken[fleet[6]!.driverId]!, { vehicleId: fleet[6]!.id, description: "ضوء الزيت يشتعل في لوحة القيادة", severity: "medium", drivable: true });
    log("30 days of driving recorded");

    // ---- 6. Customers and tasks (one with a breakdown and a replacement vehicle).
    const customers: string[] = [];
    for (const [name, contact] of [["شركة الواحة للمواد الغذائية", "السيد هشام"], ["مصحة الياسمين", "الدكتورة نادية"], ["مصنع الساحل للبلاستيك", "المهندس وليد"], ["صيدليات النور", "السيدة ريم"]] as const) {
      customers.push((await must("POST", "/customers", fmTunis, { name, contactName: contact, phone: phone() })).id);
    }
    const doTask = async (fm: string, body: Record<string, unknown>, runs: { line: number; startDay: number; endDay?: number; swapTo?: number }[]) => {
      const task = await maybe(`task ${body.title}`, "POST", "/tasks", fm, body);
      if (!task) return null;
      for (const r of runs) {
        const line = task.lines[r.line];
        const f = fleet.find((x) => x.id === line.vehicleId)!;
        const tok = driverToken[f.driverId]!;
        await maybe(`start ${body.title}`, "POST", `/tasks/${task.id}/start`, tok, { lineId: line.id, odometer: f.odo + 5, at: ago(r.startDay, 8) });
        if (r.swapTo !== undefined) {
          const to = fleet[r.swapTo]!;
          const sw = await maybe(`swap ${body.title}`, "POST", `/tasks/${task.id}/swap`, fm, { lineId: line.id, vehicleId: to.id, reason: "breakdown", odometer: f.odo + 45, at: ago(r.startDay, 11), note: "عطب في المحرك على الطريق" });
          const next = sw?.lines.find((l: { replacesLineId: string | null }) => l.replacesLineId === line.id);
          if (next) {
            await maybe(`start replacement`, "POST", `/tasks/${task.id}/start`, fm, { lineId: next.id, odometer: to.odo + 2, at: ago(r.startDay, 12) });
            await maybe(`finish replacement`, "POST", `/tasks/${task.id}/finish`, fm, { lineId: next.id, odometer: to.odo + 140, at: ago(r.startDay, 18) });
          }
        } else if (r.endDay !== undefined) {
          await maybe(`finish ${body.title}`, "POST", `/tasks/${task.id}/finish`, tok, { lineId: line.id, odometer: f.odo + rnd(80, 320), at: ago(r.endDay, 17) });
        }
      }
      return task;
    };
    const iso = (d: number, h: number) => ago(d, h);
    await doTask(fmTunis, { customerId: customers[0], kind: "trip", title: "توصيل شحنة مواد غذائية إلى بن عروس", fromPlace: "مخازن رادس", toPlace: "المنطقة الصناعية بن عروس", startsAt: iso(-1, 7), endsAt: iso(-1, 20), crew: [{ vehicleId: fleet[0]!.id, driverId: fleet[0]!.driverId }] }, []);
    await doTask(fmTunis, { customerId: customers[1], kind: "period", title: "نقل طاقم المصحة — أسبوع", startsAt: iso(-3, 6), endsAt: iso(-9, 22), dailyStart: "07:00", dailyEnd: "19:00", crew: [{ vehicleId: fleet[1]!.id, driverId: fleet[1]!.driverId }, { vehicleId: fleet[4]!.id, driverId: fleet[4]!.driverId }] }, []);
    // Past, finished tasks (counted once approved) — these need start before end in the past; windows include them.
    const past = await doTask(fmTunis, { customerId: customers[2], kind: "trip", title: "نقل مواد أولية من ميناء رادس", fromPlace: "ميناء رادس", toPlace: "مصنع الساحل — سوسة", startsAt: iso(6, 6), endsAt: iso(6, 22), crew: [{ vehicleId: fleet[3]!.id, driverId: fleet[3]!.driverId }] }, [{ line: 0, startDay: 6, endDay: 6 }]);
    await doTask(fmTunis, { customerId: customers[3], kind: "trip", title: "توزيع أدوية على الفروع", fromPlace: "المستودع الرئيسي — المروج", toPlace: "فروع تونس الكبرى", startsAt: iso(4, 6), endsAt: iso(4, 22), crew: [{ vehicleId: fleet[4]!.id, driverId: fleet[4]!.driverId }] }, [{ line: 0, startDay: 4, swapTo: 2 }]);
    await doTask(fmSfax, { customerId: customers[0], kind: "trip", title: "شحنة إلى ميناء صفاقس", fromPlace: "المنطقة الصناعية بودريار", toPlace: "ميناء صفاقس", startsAt: iso(2, 6), endsAt: iso(2, 20), crew: [{ vehicleId: fleet[5]!.id, driverId: fleet[5]!.driverId }] }, [{ line: 0, startDay: 2, endDay: 2 }]);
    await doTask(fmSfax, { customerId: customers[1], kind: "period", title: "سيارة تحت الطلب للمصحة", startsAt: iso(1, 0), endsAt: iso(-2, 23), crew: [{ vehicleId: fleet[7]!.id, driverId: fleet[7]!.driverId }] }, [{ line: 0, startDay: 1 }]);
    log(`tasks ready${past ? "" : " (some refused, see report)"}`);

    // ---- 7. Office records: costs (fleet manager → company admin approves) and a maintenance visit. Millimes.
    for (const [cat, amount, desc] of [["tolls", 4_500, "معلوم الطريق السيارة A1"], ["insurance", 1_350_000, "تجديد التأمين"], ["licensing", 480_000, "معلوم الجولان (الفينيات)"], ["corrective", 650_000, "تبديل بلاكيت الفرامل"]] as const) {
      await maybe(`cost ${cat}`, "POST", "/costs", fmTunis, { category: cat, vehicleId: fleet[rnd(0, 4)]!.id, netMinor: amount, expenseDate: ago(rnd(2, 20)).slice(0, 10), description: desc });
    }
    await maybe("maintenance visit", "POST", "/maintenance/visits", fmTunis, { vehicleId: fleet[2]!.id, type: "corrective", visitDate: ago(1).slice(0, 10), odometer: fleet[2]!.odo + 10, netMinor: 820_000, taxMinor: 155_800, invoiceRef: "FAC-7781", notes: "تبديل بلاكيت وطنابير", items: [], complete: true });

    // ---- 8. Approvals: fleet managers approve most of their drivers' records and reject a few; the company admin
    // approves what the fleet managers recorded. Some stay pending on purpose, so the inbox has work to show.
    let approved = 0, rejected = 0;
    for (const [tok, who] of [[fmTunis, "Tunis"], [fmSfax, "Sfax"], [admin, "admin"]] as const) {
      const items = ((await must("GET", "/approvals", tok)).items as { type: string; id: string; canDecide: boolean; odometer: number | null; at: string }[]).filter((i) => i.canDecide);
      for (const i of items) {
        const recent = NOW - Date.parse(i.at) < 2 * DAY;
        if (recent && Math.random() < 0.6) continue; // leave the last two days for the demo
        const reject = i.type === "odometer" && i.odometer != null && i.odometer > 200_000 || Math.random() < 0.04;
        const r = reject
          ? await maybe(`reject ${i.type} (${who})`, "POST", `/approvals/${i.type}/${i.id}/reject`, tok, { reason: pick(["الرقم لا يطابق الصورة", "الصورة غير واضحة", "تسجيل مكرر"]) })
          : await maybe(`approve ${i.type} (${who})`, "POST", `/approvals/${i.type}/${i.id}/approve`, tok);
        if (r) reject ? rejected++ : approved++;
      }
    }
    log(`approvals: ${approved} approved, ${rejected} rejected`);

    // ---- 9. Report.
    const left = (await must("GET", "/approvals", admin)).items.length;
    if (process.env.DEMO_OUT) {
      writeFileSync(process.env.DEMO_OUT, JSON.stringify({
        company: COMPANY, slug,
        users: people.map((p) => ({ ...p, password: pw[p.email] })),
        drivers: fleet.map((f) => ({ username: f.username, driverId: f.driverId, fleetNumber: f.fleetNumber })),
        pendingApprovals: left, refused: problems,
      }, null, 2));
    }
    console.log("\n================ DEMO COMPANY READY ================");
    console.log(`Company: ${COMPANY}  code: ${slug}`);
    console.log("Sign-ins (web):");
    for (const [email, p] of Object.entries(pw)) console.log(`  ${email}  /  ${p}`);
    console.log(`Drivers (phone app / /driver): usernames drv1.${sfx} … drv8.${sfx} — issue a code from the Drivers page to sign in.`);
    console.log(`Still waiting for approval: ${left}`);
    console.log(`Refused by the rules (${problems.length}):`);
    for (const p of problems) console.log(`  - ${p}`);
    console.log("====================================================\n");
  } finally {
    await db.update(schema.identities).set({ disabledAt: new Date() }).where(eq(schema.identities.id, botId));
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`[demo] FAILED: ${(e as Error).message}`);
  process.exit(1);
});
