import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@fleet/db";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

run("Fleet API — M2 core ledgers (integration)", () => {
  const h = new Harness(ADMIN!);
  let platform = "";
  let co: Awaited<ReturnType<Harness["company"]>>;
  const s: Record<string, string> = {};
  const tk: Record<string, string> = {};
  const as = bearer;
  const post = (path: string, token: string | undefined, body?: object) => h.http.post(path).set(as(token)).send(body ?? {});
  const get = (path: string, token: string | undefined) => h.http.get(path).set(as(token));

  const driver = async (name: string, cats: string[]) => {
    const r = await post("/drivers", co.token, { branchId: co.hq, fullName: name, username: `${name}.${h.sfx}`, licenseCategories: cats, licenseExpiry: "2030-01-01" });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const deviceToken = async (driverId: string, name: string) => {
    const code = await post(`/drivers/${driverId}/activation-code`, co.token);
    return (await h.http.post("/auth/driver/activate").send({ username: `${name}.${h.sfx}`, code: code.body.code, deviceName: "P", platform: "android" })).body.accessToken as string;
  };
  const fuel = (token: string | undefined, body: Record<string, unknown>) => post("/fuel-entries", token, { payment: "card", isFull: true, fuelType: "PET92", ...body });

  beforeAll(async () => {
    await h.start();
    platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "m2");
    for (const role of ["fleet_manager", "finance_reviewer"] as const) {
      const email = `${role}@${co.slug}.test`;
      const r = await post("/users", co.token, { email, displayName: role, role, branchIds: role === "fleet_manager" ? [co.hq] : [] });
      tk[role] = (await h.acceptInvite(email, r.body.inviteToken, `${role}-password-123`)).body.accessToken;
    }
    const v = async (fleet: string, over: Record<string, unknown> = {}) => (await post("/vehicles", co.token, vehicleBody(co.hq, { fleetNumber: fleet, registrationNumber: `${fleet} 1`, primaryTankCapacity: 60, ...over }))).body.id as string;
    s.v1 = await v("V1");
    s.v2 = await v("V2", { secondaryFuelType: null, secondaryTankCapacity: null });
    s.v3 = await v("V3", { secondaryFuelType: null, secondaryTankCapacity: null });
    s.d1 = await driver("ali", ["PRO3"]);
    s.d2 = await driver("omar", ["PRO3"]);
    s.d3 = await driver("samy", ["PRIVATE"]);
  });
  afterAll(() => h.stop());

  // ---------------------------------------------------------------- E07
  it("US-E07-01: one primary per vehicle, secondary allowed, license category blocks without override", async () => {
    const a1 = await post("/assignments", co.token, { vehicleId: s.v1, driverId: s.d1, role: "primary", startsAt: "2026-10-01T06:00:00Z" });
    expect(a1.status).toBe(201);
    s.a1 = a1.body.id;
    const clash = await post("/assignments", co.token, { vehicleId: s.v1, driverId: s.d2, role: "primary" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.fields.vehicleId).toBe(`vehicle_primary:${s.a1}`);
    expect((await post("/assignments", co.token, { vehicleId: s.v1, driverId: s.d2, role: "secondary" })).status).toBe(201);
    const lic = await post("/assignments", co.token, { vehicleId: s.v2, driverId: s.d3, role: "primary" });
    expect(lic.status).toBe(422);
    expect(lic.body.error.fields.driverId).toBe("license_category");
    await post(`/vehicles/${s.v2}/status`, co.token, { status: "inactive" });
    expect((await post("/assignments", co.token, { vehicleId: s.v2, driverId: s.d2, role: "primary" })).body.error.fields.vehicleId).toBe("vehicle_not_active");
    await post(`/vehicles/${s.v2}/status`, co.token, { status: "active" });
    // The fleet manager cannot start an assignment in the past (backdate permission)
    expect((await post("/assignments", tk.fleet_manager, { vehicleId: s.v2, driverId: s.d2, role: "primary", startsAt: "2026-01-01T00:00:00Z" })).status).toBe(403);
    // ASN-003: a driver is primary on one vehicle at a time
    expect((await post("/assignments", co.token, { vehicleId: s.v2, driverId: s.d1, role: "primary" })).body.error.fields.driverId).toMatch(/^driver_primary:/);
  });

  it("drivers see only the vehicles they are assigned to", async () => {
    tk.d1 = await deviceToken(s.d1!, "ali");
    tk.d3 = await deviceToken(s.d3!, "samy");
    expect((await get("/vehicles", tk.d1)).body.items.map((v: { id: string }) => v.id)).toEqual([s.v1]);
    expect((await get("/vehicles", tk.d3)).body.items).toEqual([]);
    expect((await get(`/vehicles/${s.v2}`, tk.d1)).status).toBe(404);
  });

  // ---------------------------------------------------------------- E08
  it("US-E08-02..04: conflicts are kept but flagged, big jumps are warnings, close readings corroborate", async () => {
    const r = (value: number, eventAt: string, opening = false) => post("/meter-readings", co.token, { vehicleId: s.v2, value, eventAt, opening });
    expect((await r(50_000, "2026-10-01T08:00:00Z", true)).body).toMatchObject({ status: "valid", sourceType: "opening" });
    const conflict = await r(49_800, "2026-10-03T08:00:00Z");
    expect(conflict.status).toBe(201);
    expect(conflict.body).toMatchObject({ status: "conflict", reasons: ["below_previous"] });
    s.conflictReading = conflict.body.id;
    expect((await r(51_800, "2026-10-02T08:00:00Z")).body).toMatchObject({ status: "warning", reasons: ["daily_distance"] });
    const hist = await get(`/vehicles/${s.v2}/odometer`, co.token);
    expect(hist.body.current).toMatchObject({ value: 51_800 }); // conflict excluded
    expect(hist.body.readings).toHaveLength(3);
  });

  it("US-E08-05: meter replacement continues total distance without a conflict", async () => {
    await post("/meter-readings", co.token, { vehicleId: s.v3, value: 179_900, eventAt: "2026-10-05T08:00:00Z", opening: true });
    const rep = await post("/meter-replacements", co.token, { vehicleId: s.v3, eventAt: "2026-10-06T08:00:00Z", oldFinal: 180_000, newStart: 0, reason: "عطل في العداد" });
    expect(rep.status).toBe(201);
    const after = await post("/meter-readings", co.token, { vehicleId: s.v3, value: 500, eventAt: "2026-10-07T08:00:00Z" });
    expect(after.body).toMatchObject({ status: "valid", cumulative: 180_500 });
    expect((await get(`/vehicles/${s.v3}/odometer`, co.token)).body.current).toMatchObject({ value: 500, cumulative: 180_500 });
  });

  // ---------------------------------------------------------------- E07 handover / custody
  it("US-E07-03/04: handover to an authorized driver moves custody; unassigned receivers are refused; gaps are explicit", async () => {
    const bad = await post("/handovers", co.token, { vehicleId: s.v1, toDriverId: s.d3, odometer: 20_000 });
    expect(bad.body.error.fields.toDriverId).toBe("not_assigned");
    // d1 hands the car to d2 (secondary) with an odometer reading
    const ho = await post("/handovers", tk.d1, { vehicleId: s.v1, toDriverId: s.d2, odometer: 20_000 });
    expect(ho.status).toBe(201);
    expect(ho.body).toMatchObject({ fromDriverId: s.d1, toDriverId: s.d2, readingStatus: "valid" });
    // d1 is no longer the custodian
    expect((await post("/handovers", tk.d1, { vehicleId: s.v1, toDriverId: s.d2, odometer: 20_010 })).status).toBe(403);
    const custody = await get(`/vehicles/${s.v1}/custody?from=2026-09-30T00:00:00Z`, co.token);
    expect(custody.body.items.map((x: { driverId: string | null; source: string }) => [x.driverId, x.source])).toEqual([[null, "gap"], [s.d1, "assignment"], [s.d2, "handover"]]);
    expect((await get(`/vehicles/${s.v1}/odometer`, co.token)).body.readings[0]).toMatchObject({ sourceType: "handover", value: 20_000 });
  });

  // ---------------------------------------------------------------- E09
  it("Worked Example E1 through the API: Full-to-Full = 10.0 L/100km Reliable; purchased 110 L; one cost per entry", async () => {
    await post("/assignments", co.token, { vehicleId: s.v2, driverId: s.d2, role: "primary", startsAt: "2026-10-09T00:00:00Z" });
    // v2 continues from the readings above (51,800 on Oct 2)
    const e1 = await fuel(co.token, { vehicleId: s.v2, driverId: s.d2, eventAt: "2026-10-10T08:00:00Z", odometer: 60_000, quantity: 50, amountMinor: 75_000 });
    const e2 = await fuel(co.token, { vehicleId: s.v2, driverId: s.d2, eventAt: "2026-10-11T08:00:00Z", odometer: 60_300, quantity: 20, amountMinor: 30_000, isFull: false });
    const e3 = await fuel(co.token, { vehicleId: s.v2, driverId: s.d2, eventAt: "2026-10-12T08:00:00Z", odometer: 60_600, quantity: 40, amountMinor: 60_000 });
    for (const e of [e1, e2, e3]) expect(e.body).toMatchObject({ status: "accepted", flags: [] });
    const stats = await get(`/vehicles/${s.v2}/fuel-stats?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z`, co.token);
    expect(stats.body.consumption).toEqual([{ fuelType: "PET92", value: 10, quality: "reliable" }]);
    expect(stats.body.purchased[0]).toMatchObject({ fuelType: "PET92", quantity: 110, unit: "L", grossMinor: 165_000 });
    const costs = await get(`/costs?vehicleId=${s.v2}`, co.token);
    expect(costs.body.items.filter((c: { category: string }) => c.category === "fuel").map((c: { reportedMinor: number }) => c.reportedMinor).sort()).toEqual([30_000, 60_000, 75_000]);
    s.e2 = e2.body.id;
  });

  it("Worked Example E5: retrying the same entry id returns the same record, once", async () => {
    const id = newId();
    const body = { id, vehicleId: s.v2, driverId: s.d2, eventAt: "2026-10-13T08:00:00Z", odometer: 60_900, quantity: 30, amountMinor: 45_000, isFull: false };
    const first = await fuel(co.token, body);
    const again = await fuel(co.token, body);
    const third = await fuel(co.token, body);
    expect(first.status).toBe(201);
    expect([again.status, third.status]).toEqual([200, 200]);
    expect(again.body).toEqual(first.body);
    expect((await get(`/fuel-entries?vehicleId=${s.v2}`, co.token)).body.items.filter((e: { id: string }) => e.id === id)).toHaveLength(1);
    expect((await get(`/costs?vehicleId=${s.v2}`, co.token)).body.items.filter((c: { sourceId: string }) => c.sourceId === id)).toHaveLength(1);
  });

  it("US-E09-02/03: over-tank and possible duplicates are saved, flagged, and kept out of costs", async () => {
    const tank = await fuel(co.token, { vehicleId: s.v3, eventAt: "2026-10-08T08:00:00Z", odometer: 700, quantity: 64, amountMinor: 96_000 });
    expect(tank.status).toBe(201);
    expect(tank.body).toMatchObject({ status: "under_review", flags: ["tank_exceeded"] });
    expect((await fuel(co.token, { vehicleId: s.v3, eventAt: "2026-10-08T08:00:00Z", odometer: 700, quantity: 63, amountMinor: 1, receiptRef: "R-1" })).body.flags).toEqual([]);
    const dup = await fuel(co.token, { vehicleId: s.v3, eventAt: "2026-10-08T08:20:00Z", odometer: 701, quantity: 64, amountMinor: 96_000 });
    expect(dup.body.flags).toEqual(expect.arrayContaining(["possible_duplicate"]));
    const costs = (await get(`/costs?vehicleId=${s.v3}`, co.token)).body.items.map((c: { sourceId: string }) => c.sourceId);
    expect(costs).not.toContain(tank.body.id);
    expect(costs).not.toContain(dup.body.id);
    s.tank = tank.body.id;
    s.dup = dup.body.id;
  });

  it("US-E09-06 + GEN-004: the recorder cannot accept; a reviewer accepts or voids with a reason", async () => {
    const self = await post(`/fuel-entries/${s.tank}/accept`, co.token);
    expect(self.body.error.code).toBe("maker_checker");
    const ok = await post(`/fuel-entries/${s.tank}/accept`, tk.fleet_manager);
    expect(ok.body.status).toBe("accepted");
    expect((await get(`/costs?vehicleId=${s.v3}`, co.token)).body.items.map((c: { sourceId: string }) => c.sourceId)).toContain(s.tank);
    expect((await post(`/fuel-entries/${s.dup}/void`, tk.fleet_manager, {})).status).toBe(422);
    const v = await post(`/fuel-entries/${s.dup}/void`, tk.fleet_manager, { reason: "تكرار نفس الإيصال" });
    expect(v.body).toMatchObject({ status: "voided", voidReason: "تكرار نفس الإيصال" });
    expect((await get(`/fuel-entries/${s.dup}`, co.token)).status).toBe(200); // still visible
    // voiding an accepted entry voids its cost (out of costs and cycles)
    await post(`/fuel-entries/${s.tank}/void`, tk.finance_reviewer, { reason: "خطأ إدخال" });
    expect((await get(`/costs?vehicleId=${s.v3}`, co.token)).body.items.map((c: { sourceId: string }) => c.sourceId)).not.toContain(s.tank);
  });

  it("US-E09-01/05: driver cash entry needs its receipt; no assignment → under review; assignment later re-attributes (US-E07-02)", async () => {
    // d3 (no assignment) records on v3 in his branch: allowed, flagged
    const e = await fuel(tk.d3, { vehicleId: s.v3, odometer: 800, quantity: 20, amountMinor: 30_000, payment: "cash" });
    expect(e.status).toBe(201);
    expect(e.body.flags.sort()).toEqual(["missing_receipt", "no_assignment"]);
    expect((await h.http.post(`/fuel-entries/${e.body.id}/receipt`).set(as(tk.d3)).set("content-type", "image/png").send(Buffer.from("not an image"))).status).toBe(415);
    const withReceipt = await h.http.post(`/fuel-entries/${e.body.id}/receipt`).set(as(tk.d3)).set("content-type", "image/png").send(PNG);
    expect(withReceipt.body).toMatchObject({ hasReceipt: true, flags: ["no_assignment"], status: "under_review" });
    // The license mismatch keeps d3 off v3 as primary; give him a secondary-capable vehicle? v3 needs PRO3 → use company admin to fix the driver license, then backdate an assignment over the entry
    await h.http.patch(`/drivers/${s.d3}`).set(as(co.token)).send({ licenseCategories: ["PRIVATE", "PRO3"] });
    const a = await post("/assignments", co.token, { vehicleId: s.v3, driverId: s.d3, role: "primary", startsAt: new Date(Date.now() - 60 * 60_000).toISOString() });
    expect(a.status).toBe(201);
    const after = await get(`/fuel-entries/${e.body.id}`, co.token);
    expect(after.body).toMatchObject({ status: "accepted", flags: [] });
    expect((await get(`/costs?vehicleId=${s.v3}`, co.token)).body.items.map((c: { sourceId: string }) => c.sourceId)).toContain(e.body.id);
    // Drivers only see their own entries
    expect((await get("/fuel-entries", tk.d3)).body.items.map((x: { id: string }) => x.id)).toEqual([e.body.id]);
    s.driverEntry = e.body.id;
  });

  it("US-E09-04/09: wrong fuel type is a warning; CNG uses the gas tank capacity", async () => {
    expect((await fuel(co.token, { vehicleId: s.v1, driverId: s.d2, odometer: 20_100, fuelType: "DSL", quantity: 30, amountMinor: 40_000 })).body.flags).toEqual(["fuel_type_mismatch"]);
    const cngOk = await fuel(co.token, { vehicleId: s.v1, driverId: s.d2, odometer: 20_150, fuelType: "CNG", quantity: 15.5, amountMinor: 10_000 });
    expect(cngOk.body).toMatchObject({ unit: "m3", flags: [] });
    expect((await fuel(co.token, { vehicleId: s.v1, driverId: s.d2, odometer: 20_200, fuelType: "CNG", quantity: 16, amountMinor: 10_000 })).body.flags).toEqual(["tank_exceeded"]);
  });

  it("US-E09-10: official price ±2%, evaluated at the event time, prices are append-only", async () => {
    expect((await post("/platform/fuel-prices", co.token, { countryCode: "EG", fuelType: "PET95", priceMinor: 1_700, effectiveFrom: "2026-01-01T00:00:00Z" })).status).toBe(403);
    await post("/platform/fuel-prices", platform, { countryCode: "EG", fuelType: "PET95", priceMinor: 1_700, effectiveFrom: "2026-01-01T00:00:00Z" });
    await post("/platform/fuel-prices", platform, { countryCode: "EG", fuelType: "PET95", priceMinor: 1_900, effectiveFrom: "2026-10-20T00:00:00Z" });
    await h.http.patch(`/vehicles/${s.v1}`).set(as(co.token)).send({ secondaryFuelType: "PET95", secondaryTankCapacity: 60 });
    // Before the change: 17.00 is the reference — 17.30 (+1.8%) passes, 19.00 (+11.8%) is flagged
    const before = await fuel(co.token, { vehicleId: s.v1, driverId: s.d2, eventAt: "2026-10-15T08:00:00Z", odometer: 19_000, fuelType: "PET95", quantity: 10, amountMinor: 19_000 });
    expect(before.body).toMatchObject({ referencePriceMinor: 1_700, referenceOfficial: true });
    expect(before.body.flags).toContain("price_deviation");
    const after = await fuel(co.token, { vehicleId: s.v1, driverId: s.d2, odometer: 20_300, fuelType: "PET95", quantity: 10, amountMinor: 19_000 });
    expect(after.body.referencePriceMinor).toBe(1_900);
    expect(after.body.flags).not.toContain("price_deviation");
    const current = await get("/fuel-prices", tk.d1);
    expect(current.body.items).toEqual([expect.objectContaining({ fuelType: "PET95", priceMinor: 1_900 })]);
  });

  // ---------------------------------------------------------------- E15
  it("US-E15-01/04/05: net/tax/gross, tax treatment per category, e-invoice duplicates, no manual fuel", async () => {
    const ins = await post("/costs", tk.finance_reviewer, { category: "insurance", vehicleId: s.v2, netMinor: 100_000, taxMinor: 14_000, expenseDate: "2026-10-15" });
    expect(ins.body).toMatchObject({ netMinor: 100_000, taxMinor: 14_000, grossMinor: 114_000, reportedMinor: 100_000, currency: "EGP" });
    const fix = await post("/costs", tk.finance_reviewer, { category: "corrective", vehicleId: s.v2, netMinor: 100_000, taxMinor: 14_000, expenseDate: "2026-10-16", eInvoiceUuid: "EINV-1" });
    expect(fix.body.reportedMinor).toBe(100_000);
    const dup = await post("/costs", tk.finance_reviewer, { category: "corrective", vehicleId: s.v2, netMinor: 5_000, expenseDate: "2026-10-17", eInvoiceUuid: "EINV-1" });
    expect(dup.body.flags).toEqual(["possible_duplicate"]);
    const tolls = await post("/costs", tk.finance_reviewer, { category: "tolls", vehicleId: s.v2, netMinor: 2_500, expenseDate: "2026-10-17" });
    expect(tolls.status).toBe(201);
    expect((await post("/costs", tk.finance_reviewer, { category: "fuel", vehicleId: s.v2, netMinor: 1, expenseDate: "2026-10-17" })).body.error.fields.category).toBe("use_fuel_entries");
    s.manualCost = dup.body.id;
  });

  it("US-E15-03 + Worked Example E3: cost/km over valid distance; Unavailable without distance", async () => {
    const sum = await get("/costs/summary?from=2026-10-10&to=2026-10-31", co.token);
    const v2 = sum.body.vehicles.find((v: { vehicleId: string }) => v.vehicleId === s.v2);
    // fuel 75,000+30,000+60,000+45,000 + insurance 100,000 + corrective 100,000 + 5,000 + tolls 2,500
    expect(v2.costMinor).toBe(417_500);
    expect(v2.fuelCostMinor).toBe(210_000);
    expect(v2.distance).toEqual({ value: 9_100, quality: "reliable" }); // 51,800 (Oct 2) → 60,900 (Oct 13)
    expect(v2.costPerKm).toEqual({ value: Math.round((417_500 / 9_100) * 100) / 100, quality: "reliable" });
    const empty = await get("/costs/summary?from=2026-01-01&to=2026-01-31", co.token);
    expect(empty.body.vehicles.find((v: { vehicleId: string }) => v.vehicleId === s.v2)).toMatchObject({ costMinor: 0, distance: { value: null, quality: "unavailable" }, costPerKm: { value: null, quality: "unavailable" } });
  });

  it("GEN-006: the database refuses a second cost for the same source", async () => {
    const c = h.tenantDb(co.slug);
    await c.connect();
    const [first] = (await c.query("SELECT * FROM cost_records WHERE source_type='fuel' LIMIT 1")).rows;
    await expect(c.query(
      `INSERT INTO cost_records (id, category, vehicle_id, branch_id, net_minor, currency, tax_recoverable, expense_date, source_type, source_id, created_by)
       VALUES ($1,'fuel',$2,$3,1,'EGP',false,'2026-10-10','fuel',$4,$5)`, [newId(), first.vehicle_id, first.branch_id, first.source_id, first.created_by],
    )).rejects.toThrow(/cost_records_expense_identity/);
    await c.end();
  });

  // ---------------------------------------------------------------- E16
  it("US-E16-01/02: a financial correction waits for finance/admin approval; the original stays visible", async () => {
    // The driver asks to correct the amount of his own entry
    const req = await post("/corrections", tk.d3, { recordType: "fuel_entry", recordId: s.driverEntry, changes: { netMinor: 32_000 }, reason: "المبلغ الصحيح في الإيصال 320" });
    expect(req.status).toBe(201);
    expect(req.body).toMatchObject({ status: "pending", financial: true, changes: { netMinor: { from: 30_000, to: 32_000 } } });
    expect((await post("/corrections", tk.d3, { recordType: "fuel_entry", recordId: s.driverEntry, changes: { netMinor: 1 }, reason: "again" })).body.error.code).toBe("correction_pending");
    expect((await post("/corrections", tk.d1, { recordType: "fuel_entry", recordId: s.driverEntry, changes: { netMinor: 1 }, reason: "not mine" })).status).toBe(404);
    // Not applied yet
    expect((await get(`/fuel-entries/${s.driverEntry}`, co.token)).body.netMinor).toBe(30_000);
    // Fleet managers approve non-financial only
    const fm = await post(`/corrections/${req.body.id}/approve`, tk.fleet_manager, {});
    expect(fm.status).toBe(403);
    const ok = await post(`/corrections/${req.body.id}/approve`, tk.finance_reviewer, { note: "مطابق للإيصال" });
    expect(ok.body).toMatchObject({ status: "applied", affectedFrom: expect.any(String) });
    expect((await get(`/fuel-entries/${s.driverEntry}`, co.token)).body.netMinor).toBe(32_000);
    const cost = (await get(`/costs?vehicleId=${s.v3}`, co.token)).body.items.find((c: { sourceId: string }) => c.sourceId === s.driverEntry);
    expect(cost.netMinor).toBe(32_000);
    const history = await get(`/corrections?recordId=${s.driverEntry}`, co.token);
    expect(history.body.items[0].changes.netMinor.from).toBe(30_000);
  });

  it("US-E08-06: a conflicting reading is corrected by one person and approved by another; the original is kept as Corrected", async () => {
    const req = await post("/corrections", tk.fleet_manager, { recordType: "meter_reading", recordId: s.conflictReading, changes: { value: 51_900 }, reason: "خطأ في كتابة الرقم" });
    expect(req.body.financial).toBe(false);
    expect((await post(`/corrections/${req.body.id}/approve`, tk.fleet_manager, {})).body.error.code).toBe("maker_checker");
    expect((await post(`/corrections/${req.body.id}/approve`, tk.finance_reviewer, {})).status).toBe(403); // finance: financial only
    const ok = await post(`/corrections/${req.body.id}/approve`, co.token, {});
    expect(ok.body.status).toBe("applied");
    const odo = await get(`/vehicles/${s.v2}/odometer`, co.token);
    const old = odo.body.readings.find((r: { id: string }) => r.id === s.conflictReading);
    expect(old.status).toBe("corrected");
    expect(odo.body.readings.find((r: { id: string }) => r.id === old.correctedBy)).toMatchObject({ value: 51_900, status: "valid" });
  });

  it("corrections are rejected when the record changed in between (no lost updates)", async () => {
    const r1 = await post("/corrections", tk.finance_reviewer, { recordType: "cost_record", recordId: s.manualCost, changes: { description: "first" }, reason: "add note" });
    const c = h.tenantDb(co.slug);
    await c.connect();
    await c.query("UPDATE cost_records SET description='changed elsewhere' WHERE id=$1", [s.manualCost]);
    await c.end();
    expect((await post(`/corrections/${r1.body.id}/approve`, co.token, {})).body.error.code).toBe("stale_correction");
  });
});
