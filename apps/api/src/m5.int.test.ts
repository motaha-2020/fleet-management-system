import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const at = (n: number) => new Date(Date.now() + n * DAY).toISOString();

type AlertDto = { id: string; type: string; severity: string; status: string; level: number; entityId: string; subject: string | null; ownerId: string | null; ownerFallback: boolean; resolution: string | null; params: Record<string, unknown> };

run("Fleet API — M5 control & insight (integration)", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  const s: Record<string, string> = {};
  const tk: Record<string, string> = {};
  const post = (path: string, token: string | undefined, body?: object) => h.http.post(path).set(bearer(token)).send(body ?? {});
  const get = (path: string, token: string | undefined) => h.http.get(path).set(bearer(token));
  const alerts = async (q = "", token = co.token) => (await get(`/alerts${q}`, token)).body.items as AlertDto[];
  const scan = async () => {
    const r = await post("/alerts/scan", co.token);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as { created: number; escalated: number; resolved: number; notified: number };
  };
  /** Draft → file → submit (by `by`) → verify (by company admin, maker ≠ checker). */
  const document = async (entityType: string, entityId: string, typeCode: string, expiryDate: string, by: string) => {
    const d = await post("/documents", by, { entityType, entityId, typeCode, number: `N-${expiryDate}`, issueDate: day(-400), expiryDate });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    await h.http.post(`/documents/${d.body.id}/file`).set(bearer(by)).set("content-type", "image/png").send(PNG);
    await post(`/documents/${d.body.id}/submit`, by);
    const v = await post(`/documents/${d.body.id}/verify`, by === co.token ? tk.fm : co.token);
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    return d.body.id as string;
  };

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "m5");
    s.alx = (await post("/branches", co.token, { code: "ALX", name: "الإسكندرية", timezone: "Africa/Cairo", weekendDays: [5, 6] })).body.id;
    const invite = async (email: string, role: string, branchIds: string[]) => {
      const r = await post("/users", co.token, { email, displayName: email.split("@")[0], role, branchIds });
      return { token: (await h.acceptInvite(email, r.body.inviteToken, `${role}-password-123`)).body.accessToken as string, membershipId: r.body.user.membershipId as string, identityId: r.body.user.identityId as string };
    };
    const fm = await invite(`fm@${co.slug}.test`, "fleet_manager", [co.hq]);
    tk.fm = fm.token;
    const fmAlx = await invite(`fm.alx@${co.slug}.test`, "fleet_manager", [s.alx!]);
    s.fmAlxMembership = fmAlx.membershipId;
    tk.fmAlx = fmAlx.token;
    tk.fin = (await invite(`fin@${co.slug}.test`, "finance_reviewer", [])).token;
    const veh = async (fleet: string, branchId: string) => (await post("/vehicles", co.token, vehicleBody(branchId, { fleetNumber: fleet, registrationNumber: `${fleet} 1`, secondaryFuelType: null, secondaryTankCapacity: null }))).body.id as string;
    s.v1 = await veh("A1", co.hq);
    s.v2 = await veh("A2", s.alx!);
    s.d1 = (await post("/drivers", co.token, { branchId: co.hq, fullName: "سائق التنبيهات", username: `alrt.${h.sfx}`, licenseCategories: ["PRO3"], licenseExpiry: day(10) })).body.id;
    await post("/meter-readings", co.token, { vehicleId: s.v1, value: 1_000, eventAt: at(-20), opening: true });
    expect((await post("/assignments", co.token, { vehicleId: s.v1, driverId: s.d1, role: "primary", startsAt: at(-10) })).status).toBe(201);
    const code = await post(`/drivers/${s.d1}/activation-code`, co.token);
    tk.d1 = (await h.http.post("/auth/driver/activate").send({ username: `alrt.${h.sfx}`, code: code.body.code, deviceName: "P", platform: "android" })).body.accessToken;
    const me = await get("/me", co.token);
    s.caIdentity = me.body.identityId;
  });
  afterAll(() => h.stop());

  // ---------------------------------------------------------------- E13
  it("US-E13-01 / DOC-009: expiring and expired documents raise one alert each; the scan never duplicates", async () => {
    s.docExpired = await document("vehicle", s.v1!, "EG_VEH_LICENSE", day(-2), co.token);
    s.docExpiring = await document("vehicle", s.v1!, "EG_VEH_INS_MANDATORY", day(20), co.token);
    const first = await scan();
    expect(first.created).toBeGreaterThanOrEqual(3);
    const list = await alerts(`?entityId=${s.v1}`);
    expect(list.find((a) => a.type === "doc_expired")).toMatchObject({ subject: "EG_VEH_LICENSE", severity: "high", status: "open" });
    expect(list.find((a) => a.type === "doc_expiring")).toMatchObject({ subject: "EG_VEH_INS_MANDATORY", severity: "low", level: 30 });
    // US-E06-03: the driver's license expiring in 10 days (14-day step)
    expect((await alerts(`?entityId=${s.d1}`))).toEqual([expect.objectContaining({ type: "license_expiring", level: 14, severity: "medium" })]);
    const again = await scan();
    expect(again.created).toBe(0);
    expect((await alerts(`?entityId=${s.v1}&type=doc_expired`))).toHaveLength(1);
  });

  it("US-E13-04 / NTF-001/003: the owner gets an email in Arabic and every delivery is recorded; failures are kept", async () => {
    const mine = h.mail.sent.filter((m) => m.to === `fm@${co.slug}.test`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.find((m) => m.subject.startsWith("مستند منتهٍ"))).toMatchObject({ locale: "ar" });
    expect(mine.find((m) => m.subject.startsWith("مستند منتهٍ"))!.text).toContain("A1 · A1 1");
    const log = (await get("/notifications", co.token)).body.items as { status: string; channel: string; provider: string | null }[];
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((n) => n.status === "sent" && n.provider === "test")).toBe(true);
    expect((await get("/notifications", tk.fm)).status).toBe(403);
    // A failing mail server: retried, then failed and visible
    h.mail.failNext = 100;
    s.v3 = (await post("/vehicles", co.token, vehicleBody(co.hq, { fleetNumber: "A3", registrationNumber: "A3 1", secondaryFuelType: null, secondaryTankCapacity: null }))).body.id;
    await document("vehicle", s.v3!, "EG_VEH_LICENSE", day(-1), co.token);
    for (let i = 0; i < 3; i++) await scan();
    h.mail.failNext = 0;
    const failed = (await get("/notifications?status=failed", co.token)).body.items as { attempts: number; lastError: string }[];
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]).toMatchObject({ attempts: 3, lastError: "smtp unavailable" });
  });

  it("US-E13-02 / ALR-005: a disabled branch owner falls back to the escalation owner; acknowledged ≠ resolved", async () => {
    await document("vehicle", s.v2!, "EG_VEH_LICENSE", day(-1), tk.fmAlx!);
    expect((await h.http.patch(`/users/${s.fmAlxMembership}`).set(bearer(co.token)).send({ active: false })).status).toBe(200);
    await scan();
    const a = (await alerts(`?entityId=${s.v2}&type=doc_expired`))[0]!;
    expect(a).toMatchObject({ ownerId: s.caIdentity, ownerFallback: true });
    // The HQ fleet manager does not see the ALX alert
    expect((await alerts(`?entityId=${s.v2}`, tk.fm))).toEqual([]);
    const ack = await post(`/alerts/${a.id}/status`, co.token, { status: "acknowledged" });
    expect(ack.body.status).toBe("acknowledged");
    expect(ack.body.resolvedAt).toBeNull();
    expect((await post(`/alerts/${a.id}/status`, co.token, { status: "closed" })).status).toBe(409);
    expect((await post(`/alerts/${a.id}/status`, co.token, { status: "resolved" })).body.error.fields.note).toBe("required");
    const res = await post(`/alerts/${a.id}/status`, co.token, { status: "resolved", note: "Renewal booked with the traffic unit" });
    expect(res.body).toMatchObject({ status: "resolved", resolution: "manual" });
    expect((await post(`/alerts/${a.id}/status`, co.token, { status: "closed" })).body.status).toBe("closed");
  });

  it("US-E13-03 / ALR-004: verifying a valid new version auto-resolves the expired alert, with audit", async () => {
    const before = (await alerts(`?entityId=${s.v1}&type=doc_expired`))[0]!;
    await document("vehicle", s.v1!, "EG_VEH_LICENSE", day(700), co.token);
    const r = await scan();
    expect(r.resolved).toBeGreaterThanOrEqual(1);
    const after = (await alerts(`?entityId=${s.v1}&type=doc_expired&status=all`)).find((a) => a.id === before.id)!;
    expect(after).toMatchObject({ status: "resolved", resolution: "auto" });
    const audit = await get(`/audit?entityType=alert&entityId=${before.id}`, co.token);
    expect(audit.body.items.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(["alert.created", "alert.auto_resolved"]));
  });

  it("US-E10-04 / US-E10-08 / WO-001: defect alerts the manager at once; rejection notifies the driver; visits close maintenance alerts", async () => {
    const d = await post("/defects", tk.d1, { vehicleId: s.v1, description: "Engine warning light", severity: "medium", drivable: false });
    expect(d.status).toBe(201);
    expect(h.queued).toEqual(expect.arrayContaining([{ name: "alerts.scan", data: { tenantId: co.tenantId } }]));
    await scan();
    expect((await alerts("?type=defect_reported", tk.fm))).toEqual([expect.objectContaining({ entityId: d.body.id, severity: "high" })]);
    expect((await alerts("?type=restriction_raised", tk.fm)).map((a) => a.entityId)).toContain(s.v1);
    expect((await post(`/defects/${d.body.id}/reject`, tk.fm, { reason: "Sensor fault, checked on site" })).status).toBe(200);
    const mine = await alerts("", tk.d1);
    expect(mine).toEqual([expect.objectContaining({ type: "defect_rejected", entityId: d.body.id })]);
    const g = await post("/sync/grant", tk.d1);
    expect(g.body.readSet.notices).toEqual([expect.objectContaining({ type: "defect_rejected", subject: expect.stringContaining("تم رفض بلاغك") })]);
    expect(g.body.readSet.notices[0].body).toContain("Sensor fault, checked on site");
    expect((await post(`/alerts/${mine[0]!.id}/status`, tk.d1, { status: "acknowledged" })).body.status).toBe("acknowledged");
    expect((await alerts("", tk.d1)).length).toBe(1);
    await scan();
    expect((await alerts("?type=defect_reported", tk.fm))).toEqual([]);

    // Maintenance overdue → visit → auto-resolved (US-E10-08)
    const tpl = await post("/maintenance/templates", co.token, { name: "Hiace", make: "Toyota", model: "Hiace", items: [{ code: "OIL", name: "Oil", intervalKm: 5_000 }] });
    expect(tpl.status).toBe(201);
    await post(`/vehicles/${s.v1}/maintenance/OIL/baseline`, tk.fm, { doneOn: day(-15), odometer: 0 });
    await post("/meter-readings", co.token, { vehicleId: s.v1, value: 5_600, eventAt: at(-1) });
    await scan();
    expect((await alerts(`?entityId=${s.v1}&type=maintenance_overdue`))).toEqual([expect.objectContaining({ subject: "OIL" })]);
    const v = await post("/maintenance/visits", tk.fm, { vehicleId: s.v1, type: "preventive", visitDate: day(0), odometer: 5_610, netMinor: 50_000, items: ["OIL"], complete: true });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    await scan();
    expect((await alerts(`?entityId=${s.v1}&type=maintenance_overdue`))).toEqual([]);
  });

  it("FUEL-015 / US-E09-08: monthly fuel budget with actuals, 80% / 100% alerts on the same alert", async () => {
    const month = day(0).slice(0, 7);
    expect((await post("/fuel-budgets", tk.fm, { scope: "vehicle", vehicleId: s.v1, month, amountMinor: 100_000 })).status).toBe(403);
    const b = await post("/fuel-budgets", tk.fin, { scope: "vehicle", vehicleId: s.v1, month, amountMinor: 100_000 });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    const fuel = (odometer: number, amountMinor: number) => post("/fuel-entries", co.token, { vehicleId: s.v1, odometer, fuelType: "PET92", quantity: 20, amountMinor, isFull: true, payment: "card", eventAt: new Date().toISOString() });
    expect((await fuel(5_700, 85_000)).status).toBe(201);
    let status = (await get(`/fuel-budgets?month=${month}`, tk.fm)).body.items;
    expect(status).toEqual([expect.objectContaining({ actualMinor: 85_000, amountPercent: 85, threshold: 80, varianceMinor: -15_000 })]);
    await scan();
    const a80 = (await alerts("?type=fuel_budget", tk.fin))[0]!;
    expect(a80).toMatchObject({ level: 80, severity: "medium" });
    expect((await fuel(5_800, 30_000)).status).toBe(201);
    await scan();
    const a100 = await alerts("?type=fuel_budget", tk.fin);
    expect(a100).toEqual([expect.objectContaining({ id: a80.id, level: 100, severity: "high" })]);
    status = (await get(`/fuel-budgets?month=${month}`, tk.fm)).body.items;
    expect(status[0]).toMatchObject({ actualMinor: 115_000, threshold: 100 });
  });

  // ---------------------------------------------------------------- E29
  it("US-E29-01: the custodian at the violation time is suggested; no custody → none; duplicate authority ref refused", async () => {
    const sug = await get(`/fines/suggest-driver?vehicleId=${s.v1}&at=${encodeURIComponent(at(-2))}`, tk.fm);
    expect(sug.body).toEqual({ driverId: s.d1, driverName: "سائق التنبيهات" });
    expect((await get(`/fines/suggest-driver?vehicleId=${s.v1}&at=${encodeURIComponent(at(-15))}`, tk.fm)).body.driverId).toBeNull();
    const f = await post("/fines", tk.fm, { vehicleId: s.v1, violationAt: at(-2), amountMinor: 50_000, authorityRef: "TR-1001", dueDate: day(20) });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    expect(f.body).toMatchObject({ suggestedDriverId: s.d1, driverId: null, driverConfirmedAt: null, paymentStatus: "unpaid" });
    s.fine1 = f.body.id;
    const dup = await post("/fines", tk.fm, { vehicleId: s.v1, violationAt: at(-1), amountMinor: 50_000, authorityRef: "TR-1001" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.authorityRef).toBe(`duplicate:${s.fine1}`);
    const ok = await post(`/fines/${s.fine1}/driver`, tk.fm, { driverId: s.d1 });
    expect(ok.body).toMatchObject({ driverId: s.d1 });
    expect(ok.body.driverConfirmedAt).toBeTruthy();
    expect((await post("/fines", tk.d1, { vehicleId: s.v1, violationAt: at(-1), amountMinor: 1 })).status).toBe(403);
  });

  it("US-E29-02: a fine is one cost (Fines); paying it does not add a second", async () => {
    const costs = async () => (await get(`/costs?vehicleId=${s.v1}&category=fines`, co.token)).body.items as { sourceId: string; grossMinor: number }[];
    expect(await costs()).toEqual([expect.objectContaining({ sourceId: s.fine1, grossMinor: 50_000 })]);
    expect((await post(`/fines/${s.fine1}/payment`, tk.fin, { paymentStatus: "paid" })).body.error.fields.paidOn).toBe("required");
    const paid = await post(`/fines/${s.fine1}/payment`, tk.fin, { paymentStatus: "paid", paidOn: day(0) });
    expect(paid.body).toMatchObject({ paymentStatus: "paid", paidOn: day(0) });
    expect(await costs()).toHaveLength(1);
    const voided = await post(`/fines/${s.fine1}/void`, co.token, { reason: "Issued to the wrong plate" });
    expect(voided.body.status).toBe("voided");
    expect(await costs()).toEqual([]);
  });

  it("US-E29-03 / INC-005: unpaid fines before the license renewal → one alert with the total; paying resolves it", async () => {
    // v3's vehicle license expired yesterday (see the notification test)
    const f1 = await post("/fines", co.token, { vehicleId: s.v3, violationAt: at(-3), amountMinor: 30_000, authorityRef: "TR-2001" });
    const f2 = await post("/fines", co.token, { vehicleId: s.v3, violationAt: at(-2), amountMinor: 20_000, authorityRef: "TR-2002" });
    expect([f1.status, f2.status]).toEqual([201, 201]);
    expect(f1.body.suggestedDriverId).toBeNull();
    await scan();
    await scan();
    const list = await alerts(`?entityId=${s.v3}&type=fines_before_renewal`);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ params: expect.objectContaining({ count: 2, totalMinor: 50_000 }) });
    await post(`/fines/${f1.body.id}/payment`, co.token, { paymentStatus: "paid", paidOn: day(0) });
    await post(`/fines/${f2.body.id}/payment`, co.token, { paymentStatus: "paid", paidOn: day(0) });
    await scan();
    expect(await alerts(`?entityId=${s.v3}&type=fines_before_renewal`)).toEqual([]);
  });

  // ---------------------------------------------------------------- E18
  it("US-E18-01: executive dashboard with pilot KPIs and data quality, in under 3 s", async () => {
    const t0 = Date.now();
    const r = await get(`/dashboard?from=${day(-30)}&to=${day(0)}`, co.token);
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.vehicles).toMatchObject({ total: 3, active: 3 });
    expect(r.body.vehicles.available + r.body.vehicles.restricted).toBe(3);
    expect(r.body.costs.fuelMinor).toBe(115_000);
    expect(r.body.costs.operatingMinor).toBeGreaterThanOrEqual(115_000 + 50_000);
    expect(r.body.kpis.costPerKm.quality).not.toBe("reliable"); // A2, A3 have no readings → partial coverage
    expect(r.body.kpis.dataCoverage.value).toBeLessThan(100);
    expect(r.body.kpis.documentCompliance.value).toBeGreaterThan(0);
    expect(r.body.kpis.syncSuccess).toEqual({ value: null, quality: "unavailable" });
    expect(r.body.kpis.fuelBudgetVariance.value).toBe(15);
    expect(r.body.openAlerts).toBeGreaterThan(0);
  });

  it("US-E18-02: a fleet manager's dashboard counts only their branch and matches the drill-down report", async () => {
    const d = (await get(`/dashboard?from=${day(-30)}&to=${day(0)}`, tk.fm)).body;
    expect(d.vehicles.total).toBe(2); // A1, A3 in HQ; A2 is ALX
    expect(d.fleet.byBranch.map((b: { branchId: string }) => b.branchId)).toEqual([co.hq]);
    const costs = (await get(`/reports/costs?from=${day(-30)}&to=${day(0)}`, tk.fm)).body;
    expect(costs.totals.reported).toBe(d.costs.operatingMinor);
    expect(costs.rows.every((r: { branch: string }) => r.branch !== "الإسكندرية")).toBe(true);
    expect(costs.links[0]).toMatchObject({ entityType: expect.any(String), entityId: expect.any(String) });
    expect((await get(`/dashboard?branchId=${s.alx}`, tk.fm)).body.vehicles.total).toBe(0);
  });

  it("US-E18-05: standard reports export to Excel/CSV with matching totals, audited, never outside the user's scope", async () => {
    const fuel = (await get(`/reports/fuel?from=${day(-30)}&to=${day(0)}`, co.token)).body;
    expect(fuel.rows).toHaveLength(2);
    expect(fuel.totals.amount).toBe(115_000);
    const csv = await h.http.get(`/reports/fuel/export?format=csv&from=${day(-30)}&to=${day(0)}`).set(bearer(co.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks).toString("utf8")));
    });
    expect(csv.status).toBe(200);
    const text = csv.body as string;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split("\r\n")[0]).toContain("المركبة");
    expect(text.split("\r\n")).toHaveLength(3);
    const xlsx = await h.http.get(`/reports/costs/export?from=${day(-30)}&to=${day(0)}`).set(bearer(tk.fm)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    const audit = (await get("/audit?entityType=report", co.token)).body.items as { action: string; after: { report: string; rows: number } }[];
    expect(audit.filter((a) => a.action === "report.exported").map((a) => a.after.report).sort()).toEqual(["costs", "fuel"]);
    for (const id of ["maintenance", "documents", "odometer_exceptions", "assignments", "audit", "fines"]) {
      const r = await get(`/reports/${id}?from=${day(-30)}&to=${day(30)}`, co.token);
      expect(r.status, `${id} ${JSON.stringify(r.body)}`).toBe(200);
    }
    expect((await get("/reports/documents?to=" + day(30), co.token)).body.rows.length).toBeGreaterThan(0);
    expect((await get("/reports/fuel", tk.d1)).status).toBe(403);
    expect((await get("/reports/nope", co.token)).status).toBe(404);
  });
});
