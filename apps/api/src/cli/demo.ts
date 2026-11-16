/**
 * Phase 6 (owner decision 14 Nov 2026): a demo company full of realistic fake data, made through the real API so
 * every rule applies (approvals, maker ≠ checker, scopes, overlaps). Run inside the staging api container:
 *
 *   docker compose --env-file .env -f docker-compose.yml run --rm api node dist/cli/demo.js
 *
 * It makes a temporary platform-admin "bot" (switched off at the end), creates the company, its people, vehicles,
 * drivers, customers and 30 days of activity (fuel with places, readings, defects, inspections, tasks with a
 * breakdown swap, costs, maintenance), approves most of it and rejects a few, and prints the sign-ins.
 * Every email is @demo.fleet.test (never delivered). Safe to run again: each run makes a new company.
 */
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { controlDb, newId, randomToken, schema, sha256 } from "@fleet/db";
import { INSPECTION_ITEMS } from "@fleet/config";
import { AuthService } from "../auth/auth.service.js";

const API = (process.env.DEMO_API_URL ?? "http://api:4000").replace(/\/$/, "");
const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number, hour = 9) => { const d = new Date(NOW - days * DAY); d.setUTCHours(hour - 2, Math.floor(Math.random() * 50), 0, 0); return d.toISOString(); };
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const rnd = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
const near = (lat: number, lng: number) => ({ lat: Math.round((lat + (Math.random() - 0.5) * 0.08) * 1e6) / 1e6, lng: Math.round((lng + (Math.random() - 0.5) * 0.08) * 1e6) / 1e6, accuracyM: rnd(5, 40) });
const CAIRO = [30.0444, 31.2357] as const, ALEX = [31.2001, 29.9187] as const;
const sfx = randomBytes(2).toString("hex");
const password = () => `Demo-${randomBytes(6).toString("hex")}`;
const log = (s: string) => console.log(`[demo] ${s}`);
const problems: string[] = [];

type Res = { status: number; body: any; cookies: string[] };
async function call(method: string, path: string, token: string | null, body?: unknown, cookie?: string): Promise<Res> {
  const r = await fetch(`${API}${path}`, {
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
    const slug = `demo-nile-${sfx}`;
    const adminEmail = `admin.${sfx}@demo.fleet.test`;
    const t = await must("POST", "/platform/tenants", platform, { name: "شركة النيل للنقل (تجريبية)", slug, countryCode: "EG", adminEmail, adminName: "منى عبد الله" });
    log(`company ${slug}: provisioning…`);
    for (let i = 0; i < 60; i++) {
      const s = await must("GET", `/platform/tenants/${t.tenant.id}`, platform);
      if (s.status === "active") break;
      if (s.status === "failed") throw new Error(`provisioning failed: ${s.failureReason}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    const pw: Record<string, string> = {};
    pw[adminEmail] = password();
    const admin = (await must("POST", "/auth/accept-invite", null, { token: t.adminInviteToken, password: pw[adminEmail] })).accessToken as string;
    await must("PATCH", "/company", admin, { address: "12 شارع التحرير، الدقي، الجيزة", phone: "+20 2 3333 4444", email: "info@nile-demo.test", commercialRegister: "123456", taxNumber: "300-111-222" });

    // ---- 3. Branches and people.
    const branches = (await must("GET", "/branches", admin)).items as { id: string; name: string }[];
    const hq = branches[0]!.id;
    const alx = (await must("POST", "/branches", admin, { code: "ALX", name: "فرع الإسكندرية", timezone: "Africa/Cairo" })).id as string;
    const invite = async (email: string, name: string, role: string, branchIds: string[]) => {
      const r = await must("POST", "/users", admin, { email, displayName: name, role, branchIds });
      pw[email] = password();
      return (await must("POST", "/auth/accept-invite", null, { token: r.inviteToken, password: pw[email] })).accessToken as string;
    };
    const fmCairo = await invite(`fm.cairo.${sfx}@demo.fleet.test`, "كريم حسن (مدير حركة القاهرة)", "fleet_manager", [hq]);
    const fmAlex = await invite(`fm.alex.${sfx}@demo.fleet.test`, "سارة يوسف (مدير حركة الإسكندرية)", "fleet_manager", [alx]);
    await invite(`finance.${sfx}@demo.fleet.test`, "أحمد سمير (المدير المالي)", "finance_reviewer", []);
    const dispatcher = await must("POST", "/roles", admin, { nameAr: "مشرف وردية", nameEn: "Shift supervisor", permissions: { "vehicle.read": "branches", "task.read": "branches", "fuel.read": "branches", "defect.triage": "branches" } });
    await must("POST", "/users", admin, { email: `shift.${sfx}@demo.fleet.test`, displayName: "مصطفى علي (مشرف وردية)", role: "custom", roleId: dispatcher.id, branchIds: [hq] });
    log("people ready");

    // ---- 4. Vehicles, drivers, assignments.
    const models = [["Toyota", "Hiace", "PRO3"], ["Hyundai", "H1", "PRO3"], ["Isuzu", "NPR", "PRO2"], ["Mitsubishi", "L200", "PRIVATE"], ["Nissan", "Sunny", "PRIVATE"], ["Toyota", "Hilux", "PRIVATE"], ["Kia", "K2700", "PRO3"], ["Chevrolet", "N300", "PRO3"]] as const;
    const driverNames = ["محمد إبراهيم", "علي حسن", "محمود سعيد", "عمرو خالد", "حسام فتحي", "ياسر نبيل", "طارق عادل", "شريف منصور"];
    const fleet: { id: string; branch: string; fm: string; odo: number; driverId: string; username: string; fleetNumber: string; center: readonly [number, number] }[] = [];
    for (let i = 0; i < 8; i++) {
      const [make, model, lic] = models[i]!;
      const branch = i < 5 ? hq : alx, fm = i < 5 ? fmCairo : fmAlex, center = i < 5 ? CAIRO : ALEX;
      const v = await must("POST", "/vehicles", admin, {
        branchId: branch, fleetNumber: `N-${101 + i}`, registrationNumber: `${pick(["أ ب ج", "س ص ع", "ر ق ل", "م ن هـ"])} ${rnd(1000, 9999)}`, make, model, year: rnd(2018, 2024),
        primaryFuelType: lic === "PRO2" ? "DSL" : "PET92", primaryTankCapacity: lic === "PRO2" ? 140 : 60, meterType: "distance", requiredLicenseCategory: lic, ownershipType: "owned",
      });
      const odo = rnd(20_000, 140_000);
      await must("POST", "/meter-readings", admin, { vehicleId: v.id, value: odo, eventAt: ago(40), opening: true });
      const username = `drv${i + 1}.${sfx}`;
      const d = await must("POST", "/drivers", admin, { branchId: branch, fullName: driverNames[i], username, phone: `+20 10${rnd(10_000_000, 99_999_999)}`, licenseCategories: lic === "PRIVATE" ? ["PRIVATE"] : ["PRO3", "PRO2", "PRIVATE"], licenseExpiry: i === 6 ? new Date(NOW + 20 * DAY).toISOString().slice(0, 10) : "2029-06-30" });
      await must("POST", "/assignments", admin, { vehicleId: v.id, driverId: d.id, role: "primary", startsAt: ago(39) });
      fleet.push({ id: v.id, branch, fm, odo, driverId: d.id, username, fleetNumber: `N-${101 + i}`, center });
    }
    // Driver devices (like the phone app).
    const driverToken: Record<string, string> = {};
    for (const f of fleet) {
      const c = await must("POST", `/drivers/${f.driverId}/activation-code`, admin, { purpose: "phone" });
      driverToken[f.driverId] = (await must("POST", "/auth/driver/activate", null, { username: f.username, code: c.code, deviceName: "Demo phone", platform: "android" })).accessToken;
    }
    log("vehicles and drivers ready");

    // ---- 5. Thirty days of driving: odometer readings and fuel with the station's place, an inspection a week.
    for (let day = 30; day >= 1; day--) {
      for (const f of fleet) {
        const tok = driverToken[f.driverId]!;
        f.odo += rnd(60, 260);
        if (day % 3 === f.fleetNumber.length % 3) {
          const q = rnd(30, f.fleetNumber === "N-103" ? 110 : 52);
          await maybe(`fuel ${f.fleetNumber} d-${day}`, "POST", "/fuel-entries", tok, {
            vehicleId: f.id, odometer: f.odo, fuelType: f.fleetNumber === "N-103" ? "DSL" : "PET92", quantity: q, amountMinor: Math.round(q * 1775 * (0.97 + Math.random() * 0.06)),
            isFull: Math.random() > 0.3, payment: Math.random() > 0.25 ? "card" : "cash", eventAt: ago(day, rnd(8, 18)), location: near(...f.center), locationStatus: "ok",
          });
        } else if (day % 2 === 0) {
          await maybe(`reading ${f.fleetNumber} d-${day}`, "POST", "/meter-readings", tok, { vehicleId: f.id, value: f.odo, eventAt: ago(day, 20), photoTakenAt: ago(day, 20), location: near(...f.center), locationStatus: "ok" });
        }
        if (day % 7 === 0) {
          const items = INSPECTION_ITEMS.map((i) => ({ code: i.code, ok: Math.random() > 0.08, note: null as string | null }));
          for (const i of items) if (!i.ok) i.note = pick(["محتاج تغيير", "فيه صوت", "ناقص", "مكسور جزئيًا"]);
          await maybe(`inspection ${f.fleetNumber}`, "POST", "/inspections", tok, { vehicleId: f.id, odometer: f.odo, at: ago(day, 7), items });
        }
      }
    }
    // A wrong reading (typo) that the fleet manager will reject, and two defects.
    await maybe("typo reading", "POST", "/meter-readings", driverToken[fleet[1]!.driverId]!, { vehicleId: fleet[1]!.id, value: fleet[1]!.odo + 90_000, eventAt: ago(0, 8) });
    await maybe("defect 1", "POST", "/defects", driverToken[fleet[2]!.driverId]!, { vehicleId: fleet[2]!.id, description: "صوت عالي في الفرامل الأمامية", severity: "high", drivable: true });
    await maybe("defect 2", "POST", "/defects", driverToken[fleet[6]!.driverId]!, { vehicleId: fleet[6]!.id, description: "لمبة الزيت بتنور", severity: "medium", drivable: true });
    log("30 days of driving recorded");

    // ---- 6. Customers and tasks (one with a breakdown and a replacement vehicle).
    const customers: string[] = [];
    for (const [name, contact] of [["شركة الأمل للأغذية", "أ. هاني"], ["مستشفى الرحمة", "د. نادية"], ["مصنع الدلتا للبلاستيك", "م. وليد"], ["سلسلة صيدليات الشفاء", "أ. ريهام"]] as const) {
      customers.push((await must("POST", "/customers", fmCairo, { name, contactName: contact, phone: `+20 11${rnd(10_000_000, 99_999_999)}` })).id);
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
          const sw = await maybe(`swap ${body.title}`, "POST", `/tasks/${task.id}/swap`, fm, { lineId: line.id, vehicleId: to.id, reason: "breakdown", odometer: f.odo + 45, at: ago(r.startDay, 11), note: "عطل في الموتور على الطريق" });
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
    await doTask(fmCairo, { customerId: customers[0], kind: "trip", title: "توصيل شحنة أغذية للعاشر من رمضان", fromPlace: "مخازن الجيزة", toPlace: "العاشر من رمضان", startsAt: iso(-1, 7), endsAt: iso(-1, 20), crew: [{ vehicleId: fleet[0]!.id, driverId: fleet[0]!.driverId }] }, []);
    await doTask(fmCairo, { customerId: customers[1], kind: "period", title: "نقل طاقم المستشفى — أسبوع", startsAt: iso(-3, 6), endsAt: iso(-9, 22), dailyStart: "07:00", dailyEnd: "19:00", crew: [{ vehicleId: fleet[1]!.id, driverId: fleet[1]!.driverId }, { vehicleId: fleet[6]!.id, driverId: fleet[6]!.driverId }] }, []);
    // Past, finished tasks (counted once approved) — these need start before end in the past; windows include them.
    const past = await doTask(fmCairo, { customerId: customers[2], kind: "trip", title: "نقل خامات من المنطقة الحرة", fromPlace: "المنطقة الحرة — مدينة نصر", toPlace: "مصنع الدلتا — 6 أكتوبر", startsAt: iso(6, 6), endsAt: iso(6, 22), crew: [{ vehicleId: fleet[3]!.id, driverId: fleet[3]!.driverId }] }, [{ line: 0, startDay: 6, endDay: 6 }]);
    await doTask(fmCairo, { customerId: customers[3], kind: "trip", title: "توزيع أدوية على الفروع", fromPlace: "المخزن الرئيسي — المعادي", toPlace: "فروع شرق القاهرة", startsAt: iso(4, 6), endsAt: iso(4, 22), crew: [{ vehicleId: fleet[4]!.id, driverId: fleet[4]!.driverId }] }, [{ line: 0, startDay: 4, swapTo: 2 }]);
    await doTask(fmAlex, { customerId: customers[0], kind: "trip", title: "شحنة للميناء", fromPlace: "برج العرب", toPlace: "ميناء الإسكندرية", startsAt: iso(2, 6), endsAt: iso(2, 20), crew: [{ vehicleId: fleet[5]!.id, driverId: fleet[5]!.driverId }] }, [{ line: 0, startDay: 2, endDay: 2 }]);
    await doTask(fmAlex, { customerId: customers[1], kind: "period", title: "عربية تحت الطلب للمستشفى", startsAt: iso(1, 0), endsAt: iso(-2, 23), crew: [{ vehicleId: fleet[7]!.id, driverId: fleet[7]!.driverId }] }, [{ line: 0, startDay: 1 }]);
    log(`tasks ready${past ? "" : " (some refused, see report)"}`);

    // ---- 7. Office records: costs (fleet manager → company admin approves) and a maintenance visit.
    for (const [cat, amount, desc] of [["tolls", 25_00, "كارتة طريق السويس"], ["insurance", 4_500_00, "تجديد التأمين"], ["licensing", 1_200_00, "تجديد الرخصة"], ["corrective", 2_350_00, "تغيير تيل فرامل"]] as const) {
      await maybe(`cost ${cat}`, "POST", "/costs", fmCairo, { category: cat, vehicleId: fleet[rnd(0, 4)]!.id, netMinor: amount, expenseDate: ago(rnd(2, 20)).slice(0, 10), description: desc });
    }
    await maybe("maintenance visit", "POST", "/maintenance/visits", fmCairo, { vehicleId: fleet[2]!.id, type: "corrective", visitDate: ago(1).slice(0, 10), odometer: fleet[2]!.odo + 10, netMinor: 3_800_00, taxMinor: 532_00, invoiceRef: "INV-7781", notes: "تغيير تيل وطنابير", items: [], complete: true });

    // ---- 8. Approvals: fleet managers approve most of their drivers' records and reject a few; the company admin
    // approves what the fleet managers recorded. Some stay pending on purpose, so the inbox has work to show.
    let approved = 0, rejected = 0;
    for (const [tok, who] of [[fmCairo, "Cairo"], [fmAlex, "Alex"], [admin, "admin"]] as const) {
      const items = ((await must("GET", "/approvals", tok)).items as { type: string; id: string; canDecide: boolean; odometer: number | null; at: string }[]).filter((i) => i.canDecide);
      for (const i of items) {
        const recent = NOW - Date.parse(i.at) < 2 * DAY;
        if (recent && Math.random() < 0.6) continue; // leave the last two days for the demo
        const reject = i.type === "odometer" && i.odometer != null && i.odometer > 200_000 || Math.random() < 0.04;
        const r = reject
          ? await maybe(`reject ${i.type} (${who})`, "POST", `/approvals/${i.type}/${i.id}/reject`, tok, { reason: pick(["الرقم مش مطابق للصورة", "الصورة مش واضحة", "مكرر"]) })
          : await maybe(`approve ${i.type} (${who})`, "POST", `/approvals/${i.type}/${i.id}/approve`, tok);
        if (r) reject ? rejected++ : approved++;
      }
    }
    log(`approvals: ${approved} approved, ${rejected} rejected`);

    // ---- 9. Report.
    const left = (await must("GET", "/approvals", admin)).items.length;
    console.log("\n================ DEMO COMPANY READY ================");
    console.log(`Company: شركة النيل للنقل (تجريبية)  code: ${slug}`);
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
