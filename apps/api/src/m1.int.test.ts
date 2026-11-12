import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

run("Fleet API — M1 foundation (integration)", () => {
  const h = new Harness(ADMIN!);
  let platform = "";
  let co: Awaited<ReturnType<Harness["company"]>>;
  let other: Awaited<ReturnType<Harness["company"]>>;
  const s: Record<string, string> = {};
  const as = (t: string | undefined) => bearer(t);

  beforeAll(async () => {
    await h.start();
    platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "m1a");
    other = await h.company(platform, "m1b");
  });
  afterAll(() => h.stop());

  // ---------------------------------------------------------------- E03 branches
  it("company admin creates branches with time zone and weekend (US-E03-01)", async () => {
    const r = await h.http.post("/branches").set(as(co.token)).send({ code: "alx", name: "الإسكندرية", timezone: "Africa/Cairo", weekendDays: [5, 6] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: "ALX", timezone: "Africa/Cairo", weekendDays: [5, 6], status: "active" });
    s.alx = r.body.id;
    expect((await h.http.post("/branches").set(as(co.token)).send({ code: "ALX", name: "Dup" })).status).toBe(409);
    expect((await h.http.post("/branches").set(as(co.token)).send({ code: "X1", name: "Bad tz", timezone: "Mars/Olympus" })).status).toBe(422);
    const u = await h.http.patch(`/branches/${s.alx}`).set(as(co.token)).send({ name: "فرع الإسكندرية" });
    expect(u.body.name).toBe("فرع الإسكندرية");
  });

  // ---------------------------------------------------------------- E02-03 users
  it("invites a branch-scoped fleet manager who only sees their branch (US-E02-03)", async () => {
    const noBranch = await h.http.post("/users").set(as(co.token)).send({ email: `fm@${co.slug}.test`, displayName: "Fleet Manager", role: "fleet_manager" });
    expect(noBranch.status).toBe(422);
    const r = await h.http.post("/users").set(as(co.token)).send({ email: `fm@${co.slug}.test`, displayName: "Fleet Manager", role: "fleet_manager", branchIds: [s.alx] });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ role: "fleet_manager", branchIds: [s.alx], invitePending: true, mfaEnabled: false });
    s.fmMembership = r.body.user.membershipId;
    // Fleet manager is not an MFA-mandatory role → session right away
    const a = await h.http.post("/auth/accept-invite").send({ token: r.body.inviteToken, password: "fleet-manager-pass" });
    expect(a.status).toBe(200);
    expect(a.body.accessToken).toBeTruthy();
    s.fm = a.body.accessToken;
    expect((await h.http.get("/branches").set(as(s.fm))).body.items.map((b: { id: string }) => b.id)).toEqual([s.alx]);

    // vehicles in two branches; the manager sees only ALX
    const hqV = await h.http.post("/vehicles").set(as(co.token)).send(vehicleBody(co.hq, { fleetNumber: "HQ-1", registrationNumber: "ق ه ر 1" }));
    const alxV = await h.http.post("/vehicles").set(as(s.fm)).send(vehicleBody(s.alx!, { fleetNumber: "ALX-1", registrationNumber: "س ك ن 1" }));
    expect(alxV.status).toBe(201);
    s.hqVehicle = hqV.body.id;
    s.alxVehicle = alxV.body.id;
    expect((await h.http.post("/vehicles").set(as(s.fm)).send(vehicleBody(co.hq, { fleetNumber: "X-9", registrationNumber: "X 9" }))).status).toBe(403);
    expect((await h.http.get("/vehicles").set(as(s.fm))).body.items.map((v: { id: string }) => v.id)).toEqual([s.alxVehicle]);
    expect((await h.http.get(`/vehicles/${s.hqVehicle}`).set(as(s.fm))).status).toBe(404);
    expect((await h.http.get("/users").set(as(s.fm))).status).toBe(403);
  });

  it("guards the last admin and self-demotion; deactivation revokes access immediately (SEC-006)", async () => {
    const users = (await h.http.get("/users").set(as(co.token))).body.items;
    const me = users.find((u: { email: string }) => u.email === co.email);
    expect((await h.http.patch(`/users/${me.membershipId}`).set(as(co.token)).send({ active: false })).status).toBe(409);
    const off = await h.http.patch(`/users/${s.fmMembership}`).set(as(co.token)).send({ active: false });
    expect(off.body.active).toBe(false);
    expect((await h.http.get("/vehicles").set(as(s.fm))).status).toBe(401);
    await h.http.patch(`/users/${s.fmMembership}`).set(as(co.token)).send({ active: true });
    s.fm = (await h.login(`fm@${co.slug}.test`, "fleet-manager-pass")).body.accessToken;
  });

  it("switches active role; switching into an MFA role needs a code (SEC-002)", async () => {
    const r = await h.http.post("/users").set(as(co.token)).send({ email: `fm@${co.slug}.test`, displayName: "Fleet Manager", role: "viewer" });
    expect(r.status).toBe(201);
    expect(r.body.inviteToken).toBeNull(); // already has a password: role is just added
    const me = await h.http.get("/me").set(as(s.fm));
    expect(me.body.memberships.map((m: { role: string }) => m.role).sort()).toEqual(["fleet_manager", "viewer"]);
    const viewer = me.body.memberships.find((m: { role: string }) => m.role === "viewer");
    const sw = await h.http.post("/auth/switch-role").set(as(s.fm)).send({ membershipId: viewer.id });
    expect(sw.status).toBe(200);
    expect(sw.body.user.role).toBe("viewer");
    expect((await h.http.post("/vehicles").set(as(sw.body.accessToken)).send(vehicleBody(s.alx!, { fleetNumber: "V-1", registrationNumber: "V 1" }))).status).toBe(403);
    // Someone else's membership cannot be used
    const adminMs = (await h.http.get("/me").set(as(co.token))).body.currentMembershipId;
    expect((await h.http.post("/auth/switch-role").set(as(s.fm)).send({ membershipId: adminMs })).status).toBe(403);
  });

  // ---------------------------------------------------------------- E04 vendors
  it("deactivated vendors disappear from pickers but stay in history (US-E04-01)", async () => {
    const v = await h.http.post("/vendors").set(as(co.token)).send({ name: "ورشة النصر", type: "workshop", phone: "01000000000" });
    expect(v.status).toBe(201);
    const fmV = await h.http.post("/vendors").set(as(s.fm)).send({ name: "محطة ALX", type: "fuel_provider", branchIds: [s.alx] });
    expect(fmV.status).toBe(201);
    expect((await h.http.post("/vendors").set(as(s.fm)).send({ name: "Everywhere", type: "other" })).status).toBe(403);
    expect((await h.http.patch(`/vendors/${v.body.id}`).set(as(s.fm)).send({ phone: "0123" })).status).toBe(403); // company-wide vendor
    await h.http.patch(`/vendors/${v.body.id}`).set(as(co.token)).send({ status: "inactive" });
    const active = await h.http.get("/vendors").set(as(co.token));
    expect(active.body.items.map((x: { name: string }) => x.name)).toEqual(["محطة ALX"]);
    const all = await h.http.get("/vendors?includeInactive=true").set(as(co.token));
    expect(all.body.items).toHaveLength(2);
  });

  // ---------------------------------------------------------------- E05 vehicles
  it("edits with uniqueness, lifecycle transitions, transfer history and disposal (US-E05-02..04)", async () => {
    const dup = await h.http.patch(`/vehicles/${s.alxVehicle}`).set(as(co.token)).send({ registrationNumber: "ق ه ر ١" });
    expect(dup.status).toBe(409);
    const ok = await h.http.patch(`/vehicles/${s.alxVehicle}`).set(as(co.token)).send({ model: "Hiace 2" });
    expect(ok.body.model).toBe("Hiace 2");

    expect((await h.http.post(`/vehicles/${s.hqVehicle}/status`).set(as(co.token)).send({ status: "inactive" })).body.status).toBe("inactive");
    expect((await h.http.post(`/vehicles/${s.hqVehicle}/status`).set(as(co.token)).send({ status: "active" })).body.status).toBe("active");

    // Fleet manager of ALX cannot pull an HQ vehicle, nor push to HQ
    expect((await h.http.post(`/vehicles/${s.alxVehicle}/transfer`).set(as(s.fm)).send({ toBranchId: co.hq })).status).toBe(403);
    const t = await h.http.post(`/vehicles/${s.hqVehicle}/transfer`).set(as(co.token)).send({ toBranchId: s.alx, reason: "إعادة توزيع" });
    expect(t.body.branchId).toBe(s.alx);
    const hist = await h.http.get(`/vehicles/${s.hqVehicle}/branch-history`).set(as(co.token));
    expect(hist.body.items[0]).toMatchObject({ fromBranchId: co.hq, toBranchId: s.alx, reason: "إعادة توزيع" });

    // Fleet manager may transfer but not dispose (PRD §5.3 "نقل فقط")
    expect((await h.http.post(`/vehicles/${s.hqVehicle}/dispose`).set(as(s.fm)).send({ date: "2026-01-01", reason: "sold", finalOdometer: 1 })).status).toBe(403);
    expect((await h.http.post(`/vehicles/${s.hqVehicle}/dispose`).set(as(co.token)).send({ date: "2999-01-01", reason: "sold", finalOdometer: 1 })).status).toBe(422);
    const d = await h.http.post(`/vehicles/${s.hqVehicle}/dispose`).set(as(co.token)).send({ date: "2026-01-01", reason: "sold", finalOdometer: 154000, saleValueMinor: 45000000 });
    expect(d.body).toMatchObject({ status: "disposed", disposal: { date: "2026-01-01", reason: "sold", finalOdometer: 154000, saleValueMinor: 45000000 } });
    expect((await h.http.patch(`/vehicles/${s.hqVehicle}`).set(as(co.token)).send({ model: "X" })).status).toBe(409);
    expect((await h.http.post(`/vehicles/${s.hqVehicle}/status`).set(as(co.token)).send({ status: "active" })).status).toBe(409);
    // Plate is free again after disposal (VEH-002 among non-disposed)
    expect((await h.http.post("/vehicles").set(as(co.token)).send(vehicleBody(co.hq, { fleetNumber: "HQ-1", registrationNumber: "ق ه ر 1" }))).status).toBe(201);
  });

  // ---------------------------------------------------------------- E06 drivers
  it("national ID is validated, encrypted at rest, masked, and revealed only with audit (US-E06-04)", async () => {
    const bad = await h.http.post("/drivers").set(as(co.token)).send({ branchId: s.alx, fullName: "Bad Id", username: `bad.${h.sfx}`, nationalId: "12345678901234" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.nationalId).toBe("invalid_national_id");
    const r = await h.http.post("/drivers").set(as(s.fm)).send({
      branchId: s.alx, fullName: "محمود سعيد", username: `mahmoud.${h.sfx}`, nationalId: "٢٩٠٠١٠١١٢٣٤٥١٥", employeeRef: "E-77",
      licenseNumber: "L-123", licenseCategories: ["PRO3"], licenseExpiry: "2030-01-01",
    });
    expect(r.status).toBe(201);
    expect(r.body.nationalIdMasked).toBe("2***********15");
    expect(r.body.eligibility).toEqual({ status: "eligible", reasons: [] });
    s.driver = r.body.id;
    expect(JSON.stringify(r.body)).not.toContain("29001011234515");

    const dupId = await h.http.post("/drivers").set(as(co.token)).send({ branchId: co.hq, fullName: "Clone", username: `clone.${h.sfx}`, nationalId: "29001011234515" });
    expect(dupId.status).toBe(409);
    expect(dupId.body.error.fields.nationalId).toBe("duplicate");

    const c = h.tenantDb(co.slug);
    await c.connect();
    const raw = await c.query("SELECT national_id_enc, national_id_mask FROM drivers WHERE id=$1", [s.driver]);
    const audit = await c.query("SELECT after::text FROM audit_log WHERE entity_id=$1", [s.driver]);
    await c.end();
    expect(raw.rows[0].national_id_enc).not.toContain("29001011234515");
    expect(audit.rows.map((a) => a.after).join()).not.toContain("29001011234515");

    expect((await h.http.post(`/drivers/${s.driver}/reveal`).set(as(s.fm))).status).toBe(403);
    const rev = await h.http.post(`/drivers/${s.driver}/reveal`).set(as(co.token));
    expect(rev.body.nationalId).toBe("29001011234515");
    const log = await h.http.get(`/audit?entityId=${s.driver}&action=driver.sensitive_revealed`).set(as(co.token));
    expect(log.body.items).toHaveLength(1);
    expect(log.body.items[0].after).toEqual({ field: "nationalId" });
  });

  it("employment status is separate from login; suspension restricts, termination ends access (US-E06-01/02)", async () => {
    const code = await h.http.post(`/drivers/${s.driver}/activation-code`).set(as(s.fm));
    const act = await h.http.post("/auth/driver/activate").send({ username: `mahmoud.${h.sfx}`, code: code.body.code, deviceName: "P", platform: "android" });
    s.driverToken = act.body.accessToken;
    const sus = await h.http.patch(`/drivers/${s.driver}`).set(as(s.fm)).send({ employmentStatus: "suspended" });
    expect(sus.body.eligibility).toEqual({ status: "restricted", reasons: ["employment_suspended"] });
    expect(sus.body.status).toBe("active"); // can still log in
    expect((await h.http.get("/vehicles").set(as(s.driverToken))).status).toBe(200);

    const off = await h.http.post(`/drivers/${s.driver}/account`).set(as(s.fm)).send({ active: false });
    expect(off.body.status).toBe("inactive");
    expect((await h.http.get("/vehicles").set(as(s.driverToken))).status).toBe(401);
    expect((await h.http.post(`/drivers/${s.driver}/activation-code`).set(as(s.fm))).status).toBe(409);
    const back = await h.http.post(`/drivers/${s.driver}/account`).set(as(s.fm)).send({ active: true });
    expect(back.body.status).toBe("active");
    const term = await h.http.patch(`/drivers/${s.driver}`).set(as(s.fm)).send({ employmentStatus: "terminated" });
    expect(term.body).toMatchObject({ employmentStatus: "terminated", status: "inactive" });
    expect((await h.http.get(`/drivers/${s.driver}`).set(as(co.token))).status).toBe(200); // history stays
    await h.http.patch(`/drivers/${s.driver}`).set(as(co.token)).send({ employmentStatus: "active" });
    await h.http.post(`/drivers/${s.driver}/account`).set(as(co.token)).send({ active: true });
  });

  // ---------------------------------------------------------------- E11 documents
  it("document types: country rules cannot be relaxed; custom types allowed (US-E03-02, US-E11-01)", async () => {
    const types = await h.http.get("/document-types").set(as(co.token));
    expect(types.body.items.find((t: { code: string }) => t.code === "EG_VEH_LICENSE")).toMatchObject({ mandatory: true, countryMandatory: true });
    expect((await h.http.patch("/document-types/EG_VEH_LICENSE").set(as(co.token)).send({ mandatory: false })).status).toBe(422);
    const tight = await h.http.patch("/document-types/EG_VEH_INS_COMPREHENSIVE").set(as(co.token)).send({ mandatory: true });
    expect(tight.body).toMatchObject({ mandatory: true, countryMandatory: false });
    const custom = await h.http.post("/document-types").set(as(co.token)).send({ code: "gps_cert", entityType: "vehicle", nameAr: "شهادة GPS", nameEn: "GPS certificate", hasExpiry: false, risk: "R1" });
    expect(custom.body).toMatchObject({ code: "C_GPS_CERT", source: "company", hasExpiry: false });
    // Sensitive types are hidden from roles without view-sensitive (DRV-007)
    const fmTypes = (await h.http.get("/document-types").set(as(s.fm))).body.items.map((t: { code: string }) => t.code);
    expect(fmTypes).not.toContain("EG_DRV_DRUG_TEST");
    expect(fmTypes).toContain("EG_DRV_LICENSE");
  });

  it("upload: size/type checks, maker≠checker, validity vs verification, supersede, audited download (US-E11-02..04)", async () => {
    const noExpiry = await h.http.post("/documents").set(as(s.fm)).send({ entityType: "vehicle", entityId: s.alxVehicle, typeCode: "EG_VEH_LICENSE", number: "123" });
    expect(noExpiry.status).toBe(422);
    const listBefore = await h.http.get(`/documents?entityType=vehicle&entityId=${s.alxVehicle}`).set(as(s.fm));
    expect(listBefore.body.missingMandatory).toEqual(expect.arrayContaining(["EG_VEH_LICENSE", "EG_VEH_INS_MANDATORY", "EG_VEH_INSPECTION", "EG_VEH_INS_COMPREHENSIVE"]));

    const doc = await h.http.post("/documents").set(as(s.fm)).send({ entityType: "vehicle", entityId: s.alxVehicle, typeCode: "EG_VEH_LICENSE", number: "R-1", issueDate: "2025-11-01", expiryDate: "2026-11-11" });
    expect(doc.status).toBe(201);
    expect(doc.body).toMatchObject({ status: "draft", version: 1, validity: "expired" });
    const id = doc.body.id;

    const exe = await h.http.post(`/documents/${id}/file`).set(as(s.fm)).set("content-type", "application/pdf").send(Buffer.from("MZ not a pdf"));
    expect(exe.status).toBe(415);
    const big = await h.http.post(`/documents/${id}/file`).set(as(s.fm)).set("content-type", "application/pdf").send(Buffer.concat([PDF, Buffer.alloc(12 * 1024 * 1024)]));
    expect(big.status).toBe(413);
    expect((await h.http.post(`/documents/${id}/submit`).set(as(s.fm))).status).toBe(422); // no file yet
    const up = await h.http.post(`/documents/${id}/file`).set(as(s.fm)).set("content-type", "image/png").set("x-file-name", encodeURIComponent("رخصة.pdf")).send(PDF);
    expect(up.status).toBe(200);
    expect(up.body.file).toMatchObject({ mime: "application/pdf", name: "رخصة.pdf", size: PDF.length }); // type from bytes, not header
    expect((await h.http.post(`/documents/${id}/submit`).set(as(s.fm))).body.status).toBe("pending");

    // Maker ≠ Checker: the fleet manager who uploaded cannot verify
    const self = await h.http.post(`/documents/${id}/verify`).set(as(s.fm));
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("maker_checker");
    const v = await h.http.post(`/documents/${id}/verify`).set(as(co.token));
    expect(v.body).toMatchObject({ status: "verified", validity: "expired" }); // two separate states (US-E11-03)

    // New version supersedes the old one once verified (US-E11-04)
    const v2 = await h.http.post("/documents").set(as(s.fm)).send({ entityType: "vehicle", entityId: s.alxVehicle, typeCode: "EG_VEH_LICENSE", number: "R-2", issueDate: "2026-11-10", expiryDate: "2029-11-10" });
    expect(v2.body.version).toBe(2);
    await h.http.post(`/documents/${v2.body.id}/file`).set(as(s.fm)).set("content-type", "image/png").send(PNG);
    await h.http.post(`/documents/${v2.body.id}/submit`).set(as(s.fm));
    await h.http.post(`/documents/${v2.body.id}/verify`).set(as(co.token));
    const current = await h.http.get(`/documents?entityType=vehicle&entityId=${s.alxVehicle}`).set(as(s.fm));
    expect(current.body.items.map((d: { version: number; status: string; validity: string }) => [d.version, d.status, d.validity])).toEqual([[2, "verified", "valid"]]);
    expect(current.body.missingMandatory).not.toContain("EG_VEH_LICENSE");
    const history = await h.http.get(`/documents?entityType=vehicle&entityId=${s.alxVehicle}&includeHistory=true`).set(as(s.fm));
    expect(history.body.items.find((d: { version: number }) => d.version === 1)).toMatchObject({ status: "superseded", supersededBy: v2.body.id });

    // Download returns the original bytes (decrypted) and is audited
    const dl = await h.http.get(`/documents/${id}/file`).set(as(s.fm)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/pdf");
    expect((dl.body as Buffer).equals(PDF)).toBe(true);
    const audit = await h.http.get(`/audit?entityId=${id}&action=document.downloaded`).set(as(co.token));
    expect(audit.body.items).toHaveLength(1);
    // Stored file is encrypted
    const { readdir, readFile } = await import("node:fs/promises");
    const dir = `${h.config().storage.driver === "fs" ? (h.config().storage as { dir: string }).dir : ""}/t/${co.tenantId}/documents/${id}`;
    const stored = await readFile(`${dir}/${(await readdir(dir))[0]}`);
    expect(stored.includes(PDF.subarray(0, 8))).toBe(false);
    s.licenseDoc = v2.body.id;
  });

  it("drivers see documents by type visibility; view ≠ download (US-E11-05)", async () => {
    // Driver in ALX: license type is "view" for drivers
    const dDocs = await h.http.get(`/documents?entityType=vehicle&entityId=${s.alxVehicle}`).set(as(await driverToken()));
    expect(dDocs.status).toBe(200);
    expect(dDocs.body.items.map((d: { typeCode: string; canDownload: boolean }) => [d.typeCode, d.canDownload])).toEqual([["EG_VEH_LICENSE", false]]);
    expect((await h.http.get(`/documents/${s.licenseDoc}/file`).set(as(await driverToken()))).status).toBe(403);
    // After the company allows download, it works and is audited
    await h.http.patch("/document-types/EG_VEH_LICENSE").set(as(co.token)).send({ driverVisibility: "download" });
    expect((await h.http.get(`/documents/${s.licenseDoc}/file`).set(as(await driverToken()))).status).toBe(200);
    // A vehicle in another branch is not visible to the driver
    expect((await h.http.get(`/documents?entityType=vehicle&entityId=${s.hqVehicle}`).set(as(await driverToken()))).status).toBe(404);
  });

  async function driverToken() {
    if (s.driverToken2) return s.driverToken2;
    const code = await h.http.post(`/drivers/${s.driver}/activation-code`).set(as(co.token));
    const act = await h.http.post("/auth/driver/activate").send({ username: `mahmoud.${h.sfx}`, code: code.body.code, deviceName: "P2", platform: "android" });
    s.driverToken2 = act.body.accessToken;
    return s.driverToken2!;
  }

  it("cross-tenant: another company cannot read or verify these documents (US-E01-02)", async () => {
    expect((await h.http.get(`/documents?entityType=vehicle&entityId=${s.alxVehicle}`).set(as(other.token))).status).toBe(404);
    expect((await h.http.get(`/documents/${s.licenseDoc}/file`).set(as(other.token))).status).toBe(404);
    expect((await h.http.post(`/documents/${s.licenseDoc}/verify`).set(as(other.token))).status).toBe(404);
  });

  // ---------------------------------------------------------------- audit + suspend
  it("audit log: fleet manager sees only their branches; entries are immutable (RPT-007)", async () => {
    const fmLog = await h.http.get("/audit?limit=200").set(as(s.fm));
    const adminLog = await h.http.get("/audit?limit=200").set(as(co.token));
    expect(fmLog.body.items.length).toBeGreaterThan(0);
    expect(adminLog.body.items.length).toBeGreaterThan(fmLog.body.items.length);
    expect(fmLog.body.items.some((e: { action: string }) => e.action === "user.invited")).toBe(false);
    expect(adminLog.body.items[0].actorName).toBeTruthy();
    const page = await h.http.get("/audit?limit=2").set(as(co.token));
    const next = await h.http.get(`/audit?limit=2&before=${page.body.nextBefore}`).set(as(co.token));
    expect(next.body.items[0].id).toBeLessThan(page.body.items[1].id);
  });

  it("suspended tenant is read-only (US-E01-03)", async () => {
    const sus = await h.http.post(`/platform/tenants/${co.tenantId}/suspend`).set(as(platform));
    expect(sus.body.status).toBe("suspended");
    expect((await h.http.get("/vehicles").set(as(co.token))).status).toBe(200);
    const w = await h.http.post("/branches").set(as(co.token)).send({ code: "NEW", name: "New" });
    expect(w.status).toBe(403);
    expect(w.body.error.code).toBe("tenant_suspended");
    expect((await h.http.post(`/platform/tenants/${co.tenantId}/reactivate`).set(as(platform))).body.status).toBe("active");
    expect((await h.http.post("/branches").set(as(co.token)).send({ code: "NEW", name: "New" })).status).toBe(201);
  });

  it("company admin can reset a colleague's MFA, not their own", async () => {
    const r = await h.http.post("/users").set(as(co.token)).send({ email: `admin2@${co.slug}.test`, displayName: "Second Admin", role: "company_admin" });
    const a = await h.acceptInvite(`admin2@${co.slug}.test`, r.body.inviteToken, "second-admin-pass");
    expect(a.body.user.mfaEnabled).toBe(true);
    const reset = await h.http.post(`/users/${r.body.user.membershipId}/reset-mfa`).set(as(co.token));
    expect(reset.body.mfaEnabled).toBe(false);
    const again = await h.http.post("/auth/login").send({ email: `admin2@${co.slug}.test`, password: "second-admin-pass" });
    expect(again.body.mfa).toBe("enroll");
    const self = (await h.http.get("/me").set(as(co.token))).body.currentMembershipId;
    expect((await h.http.post(`/users/${self}/reset-mfa`).set(as(co.token))).status).toBe(409);
  });

  it("switching into an MFA role requires enrolment and then a valid code (SEC-002 + SEC-004)", async () => {
    const r = await h.http.post("/users").set(as(co.token)).send({ email: `fm@${co.slug}.test`, displayName: "Fleet Manager", role: "company_admin" });
    expect(r.status).toBe(201);
    const fmLogin = await h.login(`fm@${co.slug}.test`, "fleet-manager-pass", co.slug); // first membership = fleet manager, no MFA yet
    const target = r.body.user.membershipId;
    const noMfa = await h.http.post("/auth/switch-role").set(as(fmLogin.body.accessToken)).send({ membershipId: target });
    expect(noMfa.body.error.code).toBe("mfa_enrollment_required");
    // Enrol by turning MFA on through a login of the admin role, then switching needs a code
    const step1 = await h.http.post("/auth/login").send({ email: `fm@${co.slug}.test`, password: "fleet-manager-pass" });
    expect(step1.body.mfa).toBeUndefined(); // fleet manager session: MFA not required for that role
    await h.controlPool.query("UPDATE memberships SET created_at = created_at - interval '1 day' WHERE id = $1", [target]);
    const asAdmin = await h.login(`fm@${co.slug}.test`, "fleet-manager-pass"); // now picks the admin membership → enrols
    expect(asAdmin.body.user.role).toBe("company_admin");
    const fmMembership = asAdmin.body.user.memberships.find((m: { role: string }) => m.role === "fleet_manager").id;
    const toFm = await h.http.post("/auth/switch-role").set(as(asAdmin.body.accessToken)).send({ membershipId: fmMembership });
    expect(toFm.body.user.role).toBe("fleet_manager");
    const back = await h.http.post("/auth/switch-role").set(as(toFm.body.accessToken)).send({ membershipId: target });
    expect(back.body.error.code).toBe("mfa_required");
    const wrong = await h.http.post("/auth/switch-role").set(as(toFm.body.accessToken)).send({ membershipId: target, code: "000000" });
    expect(wrong.status).toBe(401);
    const ok = await h.http.post("/auth/switch-role").set(as(toFm.body.accessToken)).send({ membershipId: target, code: await h.code(`fm@${co.slug}.test`) });
    expect(ok.body.user.role).toBe("company_admin");
  });
});
