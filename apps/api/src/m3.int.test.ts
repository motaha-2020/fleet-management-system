import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { jwtVerify, importSPKI, decodeProtectedHeader } from "jose";
import { newId } from "@fleet/db";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;
const H = 3_600_000;

/** M3 / E14: Offline Grant, idempotent inbox, clock integrity, device ordering, conflict queue entries. */
run("Fleet API — M3 offline sync (integration)", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  const s: Record<string, string> = {};
  let driverToken = "";
  let seq = 0;
  const post = (path: string, token: string | undefined, body?: object) => h.http.post(path).set(bearer(token)).send(body ?? {});
  const get = (path: string, token: string | undefined) => h.http.get(path).set(bearer(token));

  type Ev = { eventId: string; type: string; payload: Record<string, unknown>; deviceSeq: number; deviceTime: string; grantId: string; elapsedMs: number | null };
  const grant = async () => {
    const r = await post("/sync/grant", driverToken);
    expect(r.status).toBe(200);
    return r.body as { grant: { grantId: string; issuedAt: string; token: string; vehicleIds: string[] }; lastAppliedSeq: number; readSet: { vehicles: { id: string }[]; odometer: { vehicleId: string; value: number }[] } };
  };
  const fuelEv = (grantId: string, over: Partial<Ev> = {}, payload: Record<string, unknown> = {}): Ev => ({
    eventId: newId(), type: "fuel.create", deviceSeq: ++seq, deviceTime: new Date().toISOString(), grantId, elapsedMs: 1_000,
    payload: { vehicleId: s.v1, odometer: 10_000 + seq * 100, fuelType: "PET92", quantity: 40, amountMinor: 60_000, isFull: true, payment: "card", ...payload },
    ...over,
  });
  const sync = (events: Ev[]) => post("/sync/events", driverToken, { events });

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "m3");
    const fm = await post("/users", co.token, { email: `fm@${co.slug}.test`, displayName: "FM", role: "fleet_manager", branchIds: [co.hq] });
    s.fm = (await h.acceptInvite(`fm@${co.slug}.test`, fm.body.inviteToken, "fleet-manager-pass-1")).body.accessToken;
    s.v1 = (await post("/vehicles", co.token, vehicleBody(co.hq, { fleetNumber: "S1", registrationNumber: "S1 1", secondaryFuelType: null, secondaryTankCapacity: null }))).body.id;
    s.v2 = (await post("/vehicles", co.token, vehicleBody(co.hq, { fleetNumber: "S2", registrationNumber: "S2 1", secondaryFuelType: null, secondaryTankCapacity: null }))).body.id;
    const d = await post("/drivers", co.token, { branchId: co.hq, fullName: "Sync Driver", username: `sync.${h.sfx}`, licenseCategories: ["PRO3"], licenseExpiry: "2030-01-01" });
    s.d1 = d.body.id;
    const a = await post("/assignments", co.token, { vehicleId: s.v1, driverId: s.d1, role: "primary", startsAt: "2026-10-01T00:00:00Z" });
    expect(a.status).toBe(201);
    s.a1 = a.body.id;
    await post("/meter-readings", co.token, { vehicleId: s.v1, value: 10_000, eventAt: "2026-10-01T08:00:00Z", opening: true });
    const code = await post(`/drivers/${s.d1}/activation-code`, co.token);
    driverToken = (await h.http.post("/auth/driver/activate").send({ username: `sync.${h.sfx}`, code: code.body.code, deviceName: "P", platform: "android" })).body.accessToken;
  });
  afterAll(() => h.stop());

  it("OFF-002: the grant is signed for this device, lists the assigned vehicles and verifies with the public key", async () => {
    const st = await grant();
    expect(st.grant.vehicleIds).toEqual([s.v1]);
    expect(st.readSet.vehicles.map((v) => v.id)).toEqual([s.v1]);
    expect(st.readSet.odometer).toEqual([expect.objectContaining({ vehicleId: s.v1, value: 10_000 })]);
    expect(st.lastAppliedSeq).toBe(0);
    const pem = (await h.http.get("/sync/public-key")).body.publicKeyPem as string;
    const { payload } = await jwtVerify(st.grant.token, await importSPKI(pem, "EdDSA"), { typ: "offline-grant+jwt" });
    expect(payload).toMatchObject({ jti: st.grant.grantId, drv: s.d1, veh: [s.v1] });
    expect(payload.exp! - payload.iat!).toBe(72 * 3600);
    expect(decodeProtectedHeader(st.grant.token).typ).toBe("offline-grant+jwt");
    // An Offline Grant is not an access token
    expect((await get("/vehicles", st.grant.token)).status).toBe(401);
    // Office staff have no device and no grant
    expect((await post("/sync/grant", co.token)).status).toBe(403);
  });

  it("US-E14-02: the same event sent 3 times creates one record, and every answer is the same", async () => {
    const st = await grant();
    const ev = fuelEv(st.grant.grantId);
    const answers = [];
    for (let i = 0; i < 3; i++) {
      const r = await sync([ev]);
      expect(r.status).toBe(200);
      answers.push(r.body.results[0]);
    }
    expect(answers[0]).toMatchObject({ eventId: ev.eventId, status: "accepted", recordId: ev.eventId });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    const list = await get(`/fuel-entries?vehicleId=${s.v1}`, co.token);
    expect(list.body.items.filter((e: { id: string }) => e.id === ev.eventId)).toHaveLength(1);
    expect((await get(`/fuel-entries/${ev.eventId}`, co.token)).body).toMatchObject({ status: "accepted", driverId: s.d1 });
  });

  it("US-E14-01: 71 h after the grant an offline entry is accepted; 73 h after, a new one is refused", async () => {
    const st = await grant();
    // The grant was really issued 72+ hours ago (the device was offline since then)
    const db = h.tenantDb(co.slug);
    await db.connect();
    await db.query("UPDATE offline_grants SET issued_at = issued_at - interval '80 hours', expires_at = expires_at - interval '80 hours' WHERE id = $1", [st.grant.grantId]);
    await db.end();
    const issued = Date.parse(st.grant.issuedAt) - 80 * H;
    // 9 h ago, between the opening reading and the entry of the test above
    const ok = fuelEv(st.grant.grantId, { deviceTime: new Date(issued + 71 * H).toISOString(), elapsedMs: 71 * H }, { odometer: 10_050 });
    const late = fuelEv(st.grant.grantId, { deviceTime: new Date(issued + 73 * H).toISOString(), elapsedMs: 73 * H });
    const r = await sync([ok, late]);
    expect(r.body.results[0]).toMatchObject({ status: "accepted", recordId: ok.eventId });
    expect(r.body.results[1]).toMatchObject({ status: "rejected", code: "grant_expired" });
    expect((await get(`/fuel-entries/${late.eventId}`, co.token)).status).toBe(404);
    // Changing the phone clock does not help: the monotonic time says 73 h
    const tricked = fuelEv(st.grant.grantId, { deviceTime: new Date(issued + 10 * H).toISOString(), elapsedMs: 73 * H });
    expect((await sync([tricked])).body.results[0]).toMatchObject({ status: "rejected", code: "grant_expired" });
  });

  it("US-E14-03: a device clock 2 h ahead is flagged, both times are kept, and the entry goes to review", async () => {
    const st = await grant();
    const issued = Date.parse(st.grant.issuedAt);
    const ev = fuelEv(st.grant.grantId, { deviceTime: new Date(issued + 60_000 + 2 * H).toISOString(), elapsedMs: 60_000 });
    const r = await sync([ev]);
    // The device time is in the future, so the record uses the estimate (grant time + monotonic elapsed)
    expect(r.body.results[0]).toMatchObject({ status: "warning", recordId: ev.eventId });
    expect(r.body.results[0].flags).toContain("clock_drift");
    const entry = (await get(`/fuel-entries/${ev.eventId}`, co.token)).body;
    expect(entry).toMatchObject({ status: "under_review" });
    expect(entry.flags).toContain("clock_drift");
    expect(Math.abs(Date.parse(entry.eventAt) - (issued + 60_000))).toBeLessThan(1_000);
    const db = h.tenantDb(co.slug);
    await db.connect();
    const row = (await db.query("SELECT device_time, server_time, estimated_time, clock_drift_ms FROM ingested_events WHERE event_id = $1", [ev.eventId])).rows[0];
    await db.end();
    expect(new Date(row.device_time).toISOString()).toBe(ev.deviceTime);
    expect(row.server_time).toBeTruthy();
    expect(Number(row.clock_drift_ms)).toBe(2 * H);
  });

  it("US-E14-04: the second event arriving first waits; the result follows device order", async () => {
    const st = await grant();
    const base = st.lastAppliedSeq;
    expect(base).toBe(seq);
    // Two readings after everything above (the last entry was recorded about a minute ahead): 10,700 then 10,750.
    // Sent in reverse order; no monotonic time (as after a reboot).
    const first: Ev = { eventId: newId(), type: "odometer.record", deviceSeq: ++seq, deviceTime: new Date(Date.now() + 2 * 60_000).toISOString(), grantId: st.grant.grantId, elapsedMs: null, payload: { vehicleId: s.v1, odometer: 10_700 } };
    const second: Ev = { eventId: newId(), type: "odometer.record", deviceSeq: ++seq, deviceTime: new Date(Date.now() + 3 * 60_000).toISOString(), grantId: st.grant.grantId, elapsedMs: null, payload: { vehicleId: s.v1, odometer: 10_750 } };
    const r1 = await sync([second]);
    expect(r1.body.results[0]).toMatchObject({ eventId: second.eventId, status: "held" });
    expect(r1.body.lastAppliedSeq).toBe(base);
    const r2 = await sync([first]);
    expect(r2.body.results[0]).toMatchObject({ eventId: first.eventId, recordId: first.eventId });
    expect(r2.body.lastAppliedSeq).toBe(second.deviceSeq);
    // Retrying the held one now returns its applied result
    const r3 = await sync([second]);
    expect(r3.body.results[0]).toMatchObject({ eventId: second.eventId, recordId: second.eventId });
    expect(r3.body.results[0].flags).toContain("time_unverified");
    const odo = (await get(`/vehicles/${s.v1}/odometer`, co.token)).body;
    expect(odo.current).toMatchObject({ value: 10_750 });
    const mine = odo.readings.filter((x: { id: string }) => x.id === first.eventId || x.id === second.eventId);
    expect(mine.map((x: { status: string }) => x.status)).toEqual(["valid", "valid"]);
  });

  it("US-E14-05: text first, then the photo in chunks that survive a dropped connection", async () => {
    const st = await grant();
    // Three cash entries recorded offline on a branch vehicle (no photo yet → missing_receipt)
    const evs = [0, 1, 2].map((i) => fuelEv(st.grant.grantId, {}, { vehicleId: s.v2, odometer: 50_000 + i * 300, quantity: 30 + i, amountMinor: (30 + i) * 1_500, payment: "cash" }));
    const texts = await sync(evs);
    expect(texts.body.results.map((r: { recordId: string }) => r.recordId)).toEqual(evs.map((e) => e.eventId));
    for (const e of evs) expect((await get(`/fuel-entries/${e.eventId}`, co.token)).body.flags).toContain("missing_receipt");

    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(Array.from({ length: 150_000 }, (_, i) => (i * 7) % 251))]);
    const sha256 = createHash("sha256").update(png).digest("hex");
    const start = (recordId: string, over: object = {}) => post("/uploads", driverToken, { recordType: "fuel_receipt", recordId, totalBytes: png.length, sha256, ...over });
    const chunk = (id: string, offset: number, bytes: Buffer) =>
      h.http.patch(`/uploads/${id}`).set(bearer(driverToken)).set("content-type", "application/octet-stream").set("upload-offset", String(offset)).send(bytes);

    // Photo before its text is refused: the device must sync the event first
    expect((await start(newId())).status).toBe(404);
    expect((await start(evs[0]!.eventId, { totalBytes: 600_000 })).status).toBe(422);

    const up = await start(evs[0]!.eventId);
    expect(up.body).toMatchObject({ receivedBytes: 0, completed: false });
    const id = up.body.uploadId as string;
    const K = 65_536;
    expect((await chunk(id, 0, png.subarray(0, K))).body.receivedBytes).toBe(K);
    // The answer was lost and the phone sends the same chunk again: nothing is stored twice
    expect((await chunk(id, 0, png.subarray(0, K))).body.receivedBytes).toBe(K);
    // The app restarts and asks where to continue
    expect((await start(evs[0]!.eventId)).body).toMatchObject({ uploadId: id, receivedBytes: K });
    // A chunk ahead of the server is refused with the offset to resume from
    const ahead = await chunk(id, 2 * K, png.subarray(2 * K, 3 * K));
    expect(ahead.status).toBe(409);
    expect(ahead.body.error.fields.uploadOffset).toBe(String(K));
    // Chunks are capped at 64 KB
    expect((await chunk(id, K, png.subarray(K, K + K + 1))).status).toBe(413);
    expect((await chunk(id, K, png.subarray(K, 2 * K))).body.receivedBytes).toBe(2 * K);
    const done = await chunk(id, 2 * K, png.subarray(2 * K));
    expect(done.body).toMatchObject({ receivedBytes: png.length, completed: true });
    const entry = (await get(`/fuel-entries/${evs[0]!.eventId}`, co.token)).body;
    expect(entry.hasReceipt).toBe(true);
    expect(entry.flags).not.toContain("missing_receipt");
    const file = await get(`/fuel-entries/${evs[0]!.eventId}/receipt`, co.token).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = [];
      res.on("data", (c: Buffer) => parts.push(c));
      res.on("end", () => cb(null, Buffer.concat(parts)));
    });
    expect(Buffer.compare(file.body as Buffer, png)).toBe(0);
    // Done is done: starting again or resending reports completion
    expect((await start(evs[0]!.eventId)).body).toMatchObject({ completed: true });

    // A damaged file (checksum differs) is refused and starts over from zero
    const bad = await start(evs[1]!.eventId, { sha256: "0".repeat(64) });
    let off = 0;
    let last;
    while (off < png.length) {
      last = await chunk(bad.body.uploadId, off, png.subarray(off, off + K));
      off += K;
    }
    expect(last!.status).toBe(422);
    expect(last!.body.error.code).toBe("checksum_mismatch");
    expect((await start(evs[1]!.eventId, { sha256: "0".repeat(64) })).body).toMatchObject({ receivedBytes: 0, completed: false });
    expect((await get(`/fuel-entries/${evs[1]!.eventId}`, co.token)).body.hasReceipt).toBe(false);
  });

  it("US-E14-06 (queue entry): an offline reading after the assignment ended is kept as a conflict, never applied", async () => {
    const st = await grant();
    // The office ends the assignment while the driver is offline
    const ended = await post(`/assignments/${s.a1}/end`, co.token, {});
    expect(ended.status).toBeLessThan(300);
    const ev: Ev = { eventId: newId(), type: "odometer.record", deviceSeq: ++seq, deviceTime: new Date(Date.now() + 4 * 60_000).toISOString(), grantId: st.grant.grantId, elapsedMs: null, payload: { vehicleId: s.v1, odometer: 10_800 } };
    const r = await sync([ev]);
    expect(r.body.results[0]).toMatchObject({ status: "conflict", code: "assignment_expired" });
    const odo = (await get(`/vehicles/${s.v1}/odometer`, co.token)).body;
    expect(odo.readings.some((x: { id: string }) => x.id === ev.eventId)).toBe(false);
    const q = await get("/sync/conflicts?status=open", s.fm);
    expect(q.status).toBe(200);
    expect(q.body.items).toEqual([expect.objectContaining({ eventId: ev.eventId, reason: "assignment_expired", status: "open", branchId: co.hq, payload: { vehicleId: s.v1, odometer: 10_800 } })]);
    // The driver cannot read the queue
    expect((await get("/sync/conflicts", driverToken)).status).toBe(403);
    s.c1 = q.body.items[0].id;
    s.e1 = ev.eventId;
  });

  it("US-E14-06: a person accepts, rejects or corrects with a reason; the decision is recorded and replayed", async () => {
    const st = await grant();
    const resolve = (id: string, body: object, token = s.fm) => post(`/sync/conflicts/${id}/resolve`, token, body);
    const odoEv = (value: number): Ev => ({ eventId: newId(), type: "odometer.record", deviceSeq: ++seq, deviceTime: new Date(Date.now() + 4.5 * 60_000).toISOString(), grantId: st.grant.grantId, elapsedMs: null, payload: { vehicleId: s.v1, odometer: value } });
    const toReject = odoEv(10_900);
    const toCorrect = odoEv(99_999); // typo on the phone
    expect((await sync([toReject, toCorrect])).body.results.map((x: { status: string }) => x.status)).toEqual(["conflict", "conflict"]);
    const open = (await get("/sync/conflicts?status=open", s.fm)).body.items as { id: string; eventId: string }[];
    const idOf = (eventId: string) => open.find((c) => c.eventId === eventId)!.id;

    // Guards: the driver cannot decide; a reason is required; "correct" needs the corrected fields
    expect((await resolve(s.c1!, { decision: "accept", reason: "ok" }, driverToken)).status).toBe(403);
    expect((await resolve(s.c1!, { decision: "accept", reason: "" })).status).toBe(422);
    expect((await resolve(s.c1!, { decision: "correct", reason: "fix it" })).status).toBe(422);

    // Accept: the reading is created as the driver's, at the event time
    const acc = await resolve(s.c1!, { decision: "accept", reason: "كان مع العربية فعلًا" });
    expect(acc.status).toBe(200);
    expect(acc.body).toMatchObject({ status: "accepted", resolutionReason: "كان مع العربية فعلًا", recordType: "meter_reading", recordId: s.e1 });
    expect((await resolve(s.c1!, { decision: "reject", reason: "again" })).status).toBe(409);

    // Reject: nothing is created, the event stays stored
    const rej = await resolve(idOf(toReject.eventId), { decision: "reject", reason: "قراءة مش منطقية" });
    expect(rej.body).toMatchObject({ status: "rejected", recordId: null });

    // Correct: the record carries the corrected value; the original payload is kept on the event
    const cor = await resolve(idOf(toCorrect.eventId), { decision: "correct", reason: "رقم غلط في الكتابة", correction: { odometer: 10_950 } });
    expect(cor.body).toMatchObject({ status: "corrected", correction: { odometer: 10_950 }, payload: { vehicleId: s.v1, odometer: 99_999 }, recordId: toCorrect.eventId });

    const readings = (await get(`/vehicles/${s.v1}/odometer`, co.token)).body.readings as { id: string; value: number }[];
    expect(readings.find((x) => x.id === s.e1)?.value).toBe(10_800);
    expect(readings.find((x) => x.id === toCorrect.eventId)?.value).toBe(10_950);
    expect(readings.some((x) => x.id === toReject.eventId)).toBe(false);

    // The phone retrying gets the final decision
    const replay = (await sync([toReject, toCorrect])).body.results;
    expect(replay[0]).toMatchObject({ status: "rejected", code: "rejected_by_reviewer" });
    expect(replay[1]).toMatchObject({ recordId: toCorrect.eventId });
    expect(["accepted", "warning"]).toContain(replay[1].status);
    expect((await get("/sync/conflicts?status=open", s.fm)).body.items).toEqual([]);
  });

  it("an event waiting more than 7 days for a missing earlier one goes to the queue as sequence_gap", async () => {
    const st = await grant();
    seq++; // this sequence number never reaches the server (lost)
    const orphan: Ev = { eventId: newId(), type: "odometer.record", deviceSeq: ++seq, deviceTime: new Date().toISOString(), grantId: st.grant.grantId, elapsedMs: null, payload: { vehicleId: s.v1, odometer: 11_000 } };
    expect((await sync([orphan])).body.results[0]).toMatchObject({ status: "held" });
    const db = h.tenantDb(co.slug);
    await db.connect();
    await db.query("UPDATE ingested_events SET server_time = server_time - interval '8 days' WHERE event_id = $1", [orphan.eventId]);
    await db.end();
    const r = await sync([orphan]);
    expect(r.body.results[0]).toMatchObject({ status: "conflict", code: "sequence_gap" });
    expect(r.body.lastAppliedSeq).toBe(orphan.deviceSeq);
    const q = (await get("/sync/conflicts?status=open", s.fm)).body.items;
    expect(q).toEqual([expect.objectContaining({ eventId: orphan.eventId, reason: "sequence_gap", branchId: co.hq })]);
  });

  it("rejects what can never apply, without blocking the events after it", async () => {
    const st = await grant();
    const bad: Ev = { eventId: newId(), type: "fuel.create", deviceSeq: ++seq, deviceTime: new Date().toISOString(), grantId: st.grant.grantId, elapsedMs: 1_000, payload: { vehicleId: s.v1 } };
    const unknownGrant = fuelEv(newId());
    const reused = { ...fuelEv(st.grant.grantId), deviceSeq: bad.deviceSeq };
    seq--; // `reused` did not consume a sequence number
    const r = await sync([bad, unknownGrant, reused]);
    expect(r.body.results[0]).toMatchObject({ status: "rejected", code: "invalid_payload" });
    expect(r.body.results[1]).toMatchObject({ status: "rejected", code: "grant_unknown" });
    expect(r.body.results[2]).toMatchObject({ status: "rejected", code: "seq_reused" });
    expect(r.body.lastAppliedSeq).toBe(unknownGrant.deviceSeq);
  });

  it("owner decision 13 Nov 2026: an odometer reading carries the meter photo, when it was taken and where", async () => {
    // S1's assignment was ended by an earlier test: this driver now holds S2.
    const held = await post("/assignments", co.token, { vehicleId: s.v2, driverId: s.d1, role: "primary", startsAt: new Date().toISOString() });
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    const st = await grant();
    const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
    const taken = at(6);
    const withPlace: Ev = { eventId: newId(), type: "odometer.record", deviceSeq: ++seq, deviceTime: at(6), grantId: st.grant.grantId, elapsedMs: null,
      payload: { vehicleId: s.v2, odometer: 51_000, photoTakenAt: taken, location: { lat: 30.04442, lng: 31.235712, accuracyM: 12 }, locationStatus: "ok" } };
    const refused: Ev = { eventId: newId(), type: "odometer.record", deviceSeq: ++seq, deviceTime: at(7), grantId: st.grant.grantId, elapsedMs: null,
      payload: { vehicleId: s.v2, odometer: 51_050, photoTakenAt: at(7), location: null, locationStatus: "denied" } };
    const r = await sync([withPlace, refused]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.results.map((x: { recordId: string }) => x.recordId), JSON.stringify(r.body.results)).toEqual([withPlace.eventId, refused.eventId]);

    // The photo follows the text through the resumable upload
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2_000, 7)]);
    const sha256 = createHash("sha256").update(png).digest("hex");
    const up = await post("/uploads", driverToken, { recordType: "odometer_photo", recordId: withPlace.eventId, totalBytes: png.length, sha256 });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const done = await h.http.patch(`/uploads/${up.body.uploadId}`).set(bearer(driverToken)).set("content-type", "application/octet-stream").set("upload-offset", "0").send(png);
    expect(done.body).toMatchObject({ completed: true });
    // One photo per reading: asking again returns the finished upload
    expect((await post("/uploads", driverToken, { recordType: "odometer_photo", recordId: withPlace.eventId, totalBytes: png.length, sha256: "0".repeat(64) })).body).toMatchObject({ completed: true });

    const readings = (await get(`/vehicles/${s.v2}/odometer`, s.fm)).body.readings as Record<string, unknown>[];
    expect(readings.find((x) => x.id === withPlace.eventId)).toMatchObject({
      value: 51_000, hasPhoto: true, photoTakenAt: taken, location: { lat: 30.04442, lng: 31.235712, accuracyM: 12 }, locationStatus: "ok",
    });
    // A refused location does not block the reading; it is recorded as refused
    expect(readings.find((x) => x.id === refused.eventId)).toMatchObject({ value: 51_050, hasPhoto: false, location: null, locationStatus: "denied" });

    const file = await h.http.get(`/meter-readings/${withPlace.eventId}/photo`).set(bearer(s.fm));
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect((await h.http.get(`/meter-readings/${refused.eventId}/photo`).set(bearer(s.fm))).status).toBe(404);
    const audit = (await get(`/audit?entityType=vehicle&entityId=${s.v2}`, co.token)).body.items.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["odometer.photo_uploaded", "odometer.photo_downloaded"]));

    // A location outside the globe is a broken client: refused, never stored
    const bad: Ev = { eventId: newId(), type: "odometer.record", deviceSeq: ++seq, deviceTime: at(8), grantId: st.grant.grantId, elapsedMs: null,
      payload: { vehicleId: s.v2, odometer: 51_100, location: { lat: 123, lng: 31, accuracyM: 5 }, locationStatus: "ok" } };
    expect((await sync([bad])).body.results[0]).toMatchObject({ status: "rejected", code: "invalid_payload" });
  });
});
