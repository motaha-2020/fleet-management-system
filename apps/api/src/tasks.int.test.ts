import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@fleet/db";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;
const H = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * H).toISOString();

/**
 * Owner decisions (14 Nov 2026): customers (data only), tasks with crew lines, replacing a broken-down vehicle while
 * the task and customer stay, the driver starts/finishes with the odometer, tasks and inspections count once
 * approved, and a report of vehicles/drivers/km/fuel per customer.
 */
run("customers, tasks, crew swaps, inspections", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  let fm = "", driver = "";
  const s: Record<string, string> = {};
  const post = (path: string, token: string, body: object = {}) => h.http.post(path).set(bearer(token)).send(body);
  const get = (path: string, token: string) => h.http.get(path).set(bearer(token));

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "tasks", { approvals: "manual" });
    const inv = await post("/users", co.token, { email: `fm@${co.slug}.test`, displayName: "FM", role: "fleet_manager", branchIds: [co.hq] });
    fm = (await h.acceptInvite(`fm@${co.slug}.test`, inv.body.inviteToken, "fleet-manager-pass-1")).body.accessToken;
    const veh = async (n: string, odo: number) => {
      const id = (await post("/vehicles", co.token, vehicleBody(co.hq, { fleetNumber: n, registrationNumber: `${n} 1`, secondaryFuelType: null, secondaryTankCapacity: null }))).body.id as string;
      await post("/meter-readings", co.token, { vehicleId: id, value: odo, eventAt: at(-48), opening: true });
      return id;
    };
    s.v1 = await veh("T1", 10_000);
    s.v2 = await veh("T2", 20_000);
    s.v3 = await veh("T3", 30_000);
    const drv = async (n: string) => (await post("/drivers", co.token, { branchId: co.hq, fullName: n, username: `${n}.${h.sfx}`, licenseCategories: ["PRO3"], licenseExpiry: "2030-01-01" })).body.id as string;
    s.d1 = await drv("tdrv");
    s.d2 = await drv("tdrv2");
    await post("/assignments", co.token, { vehicleId: s.v1, driverId: s.d1, role: "primary", startsAt: at(-24) });
    const code = await post(`/drivers/${s.d1}/activation-code`, co.token);
    driver = (await h.http.post("/auth/driver/activate").send({ username: `tdrv.${h.sfx}`, code: code.body.code, deviceName: "P", platform: "android" })).body.accessToken;
  });
  afterAll(() => h.stop());

  it("customers are data only; the fleet manager makes a task for one", async () => {
    const c = await post("/customers", fm, { name: "شركة الأمل", contactName: "أحمد", phone: "+20 100 111 2222" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    s.customer = c.body.id;
    expect((await post("/customers", fm, { name: "شركة الأمل" })).status).toBe(409);
    expect((await post("/customers", driver, { name: "x y" })).status).toBe(403);

    const t = await post("/tasks", fm, { customerId: s.customer, kind: "trip", title: "توصيل بضاعة", fromPlace: "القاهرة", toPlace: "الإسكندرية", startsAt: at(-1), endsAt: at(8), crew: [{ vehicleId: s.v1, driverId: s.d1 }] });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body).toMatchObject({ status: "planned", customerName: "شركة الأمل", lines: [{ vehicleId: s.v1, driverId: s.d1 }] });
    s.task = t.body.id;
    s.line1 = t.body.lines[0].id;
    // The same vehicle cannot work two overlapping tasks.
    const clash = await post("/tasks", fm, { customerId: s.customer, kind: "period", title: "تاسك تاني", startsAt: at(2), endsAt: at(4), crew: [{ vehicleId: s.v1, driverId: s.d2 }] });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("vehicle_busy");
    const avail = await get(`/tasks/availability?from=${encodeURIComponent(at(2))}&to=${encodeURIComponent(at(4))}`, fm);
    expect(avail.body.vehicles.find((v: { id: string }) => v.id === s.v1).busy).toBe(true);
    expect(avail.body.vehicles.find((v: { id: string }) => v.id === s.v2).busy).toBe(false);
    // The driver sees their task.
    expect((await get("/tasks", driver)).body.items.map((x: { id: string }) => x.id)).toEqual([s.task]);
  });

  it("the driver starts; a breakdown alerts the fleet manager; the vehicle is replaced and the task goes on", async () => {
    const st = await post(`/tasks/${s.task}/start`, driver, { lineId: s.line1, odometer: 10_000 });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    expect(st.body.status).toBe("in_progress");
    const d = await post("/defects", co.token, { vehicleId: s.v1, description: "العربية وقفت على الطريق", severity: "high", drivable: false });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const alerts = await get("/alerts", fm);
    expect(alerts.body.items.some((a: { type: string }) => a.type === "task_breakdown")).toBe(true);

    const sw = await post(`/tasks/${s.task}/swap`, fm, { lineId: s.line1, vehicleId: s.v2, reason: "breakdown", odometer: 10_050 });
    expect(sw.status, JSON.stringify(sw.body)).toBe(200);
    expect(sw.body.customerName).toBe("شركة الأمل");
    const [old, next] = sw.body.lines;
    expect(old).toMatchObject({ vehicleId: s.v1, endReason: "breakdown", km: 50 });
    expect(next).toMatchObject({ vehicleId: s.v2, driverId: s.d1, replacesLineId: s.line1, endedAt: null });
    s.line2 = next.id;
  });

  it("finishing every line makes the task done; it counts once approved", async () => {
    expect((await post(`/tasks/${s.task}/start`, driver, { lineId: s.line2, odometer: 20_000 })).status).toBe(200);
    expect((await post(`/tasks/${s.task}/finish`, driver, { lineId: s.line2, odometer: 19_000 })).status).toBe(422);
    const f = await post(`/tasks/${s.task}/finish`, driver, { lineId: s.line2, odometer: 20_080 });
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    expect(f.body).toMatchObject({ status: "done", km: 130 });
    expect((await get(`/vehicles/${s.v2}/odometer`, co.token)).body.current.value).toBe(20_000); // pending
    const inbox = (await get("/approvals", fm)).body.items as { type: string; id: string; canDecide: boolean }[];
    expect(inbox.find((i) => i.id === s.task)).toMatchObject({ type: "task", canDecide: true });
    expect((await post(`/approvals/task/${s.task}/approve`, fm)).status).toBe(200);
    expect((await get(`/tasks/${s.task}`, fm)).body.status).toBe("approved");
    expect((await get(`/vehicles/${s.v2}/odometer`, co.token)).body.current.value).toBe(20_080);
  });

  it("the customer report shows vehicles, drivers, km per crew line", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const r = await get(`/reports/customers?from=${day}&to=${day}`, co.token);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows = r.body.rows as { customer: string; km: number | null }[];
    expect(rows.filter((x) => x.customer === "شركة الأمل").map((x) => x.km).sort()).toEqual([50, 80]);
  });

  it("the driver app works a task offline (task.line) with what the phone read from the meter photo", async () => {
    const t = await post("/tasks", fm, { customerId: s.customer, kind: "period", title: "تاسك من التطبيق", startsAt: at(-1), endsAt: at(6), crew: [{ vehicleId: s.v1, driverId: s.d1 }] });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const line = t.body.lines[0].id as string;
    const g = (await post("/sync/grant", driver)).body.grant as { grantId: string };
    let seq = (await post("/sync/grant", driver)).body.lastAppliedSeq as number;
    const ev = (payload: Record<string, unknown>, type = "task.line") => ({ eventId: newId(), type, payload, deviceSeq: ++seq, deviceTime: new Date().toISOString(), grantId: g.grantId, elapsedMs: 1_000 });
    const start = ev({ taskId: t.body.id, lineId: line, action: "start", odometer: 10_100, ocrValue: 10_100 });
    const finish = ev({ taskId: t.body.id, lineId: line, action: "finish", odometer: 10_160, ocrValue: 10_166 });
    const insp = ev({ vehicleId: s.v1, items: [{ code: "tires", ok: true }] }, "inspection.create");
    const r = await post("/sync/events", driver, { events: [start, finish, insp] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(["accepted", "accepted", "accepted"]);
    const after = await get(`/tasks/${t.body.id}`, fm);
    expect(after.body).toMatchObject({ status: "done", km: 60 });
    // The reading id is the event id (the meter photo follows as an upload), and the approver sees the phone disagreed.
    const odo = await get(`/vehicles/${s.v1}/odometer`, co.token);
    expect(odo.body.readings.find((x: { id: string }) => x.id === finish.eventId)).toMatchObject({ value: 10_160, ocrValue: 10_166, approvalStatus: "pending" });
    expect((await get("/inspections", fm)).body.items.some((x: { id: string }) => x.id === insp.eventId)).toBe(true);
  });

  it("inspections: a checklist, failed critical items alert, counted once approved", async () => {
    const i = await post("/inspections", driver, { vehicleId: s.v1, odometer: 10_060, items: [{ code: "tires", ok: true }, { code: "brakes", ok: false, note: "صوت عالي" }] });
    expect(i.status, JSON.stringify(i.body)).toBe(201);
    expect(i.body).toMatchObject({ status: "pending", failed: 1 });
    expect((await post("/inspections", driver, { vehicleId: s.v1, items: [{ code: "nope", ok: true }] })).status).toBe(422);
    expect((await get("/alerts", fm)).body.items.some((a: { type: string }) => a.type === "inspection_failed")).toBe(true);
    expect((await post(`/approvals/inspection/${i.body.id}/approve`, fm)).status).toBe(200);
    const due = await get("/inspections/due", fm);
    const v1 = due.body.items.find((x: { vehicleId: string }) => x.vehicleId === s.v1);
    expect(v1).toMatchObject({ overdue: false, everyDays: 7 });
    expect(due.body.items.find((x: { vehicleId: string }) => x.vehicleId === s.v3).lastAt).toBeNull();
  });
});
