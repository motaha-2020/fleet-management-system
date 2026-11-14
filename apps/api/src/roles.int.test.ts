import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RBAC_MATRIX } from "@fleet/config";
import { Harness, bearer } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

/** Owner decisions (14 Nov 2026): the company admin edits role permissions, makes roles, and some things are locked. */
run("company roles & permissions", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  let fm = "";
  let fmMembership = "";
  let fin = "";

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "roles");
    const a = await h.http.post("/users").set(bearer(co.token)).send({ email: `fm@${co.slug}.test`, displayName: "FM", role: "fleet_manager", branchIds: [co.hq] });
    fmMembership = a.body.user.membershipId;
    fm = (await h.acceptInvite(`fm@${co.slug}.test`, a.body.inviteToken, "fleet-manager-pass")).body.accessToken;
    const b = await h.http.post("/users").set(bearer(co.token)).send({ email: `fin@${co.slug}.test`, displayName: "Fin", role: "finance_reviewer" });
    fin = (await h.acceptInvite(`fin@${co.slug}.test`, b.body.inviteToken, "finance-pass-123")).body.accessToken;
  });
  afterAll(() => h.stop());

  it("lists the fixed roles, the editable ones and the permission groups", async () => {
    const r = await h.http.get("/roles").set(bearer(co.token));
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: { id: string }) => x.id)).toEqual(["company_admin", "fleet_manager", "finance_reviewer", "driver"]);
    expect(r.body.items.find((x: { id: string }) => x.id === "company_admin")).toMatchObject({ locked: true });
    expect(r.body.items.find((x: { id: string }) => x.id === "fleet_manager")).toMatchObject({ locked: false, customized: false, members: 1 });
    const grouped = r.body.groups.flatMap((g: { actions: string[] }) => g.actions);
    expect(grouped).not.toContain("user.manage");
    expect(grouped).not.toContain("role.manage");
    expect(grouped).not.toContain("tenant.manage");
  });

  it("only the company admin manages roles; the admin and driver roles cannot change", async () => {
    expect((await h.http.get("/roles").set(bearer(fm))).status).toBe(403);
    expect((await h.http.get("/roles").set(bearer(fin))).status).toBe(403);
    expect((await h.http.patch("/roles/company_admin").set(bearer(co.token)).send({ permissions: {} })).status).toBe(409);
    expect((await h.http.patch("/roles/driver").set(bearer(co.token)).send({ permissions: {} })).status).toBe(409);
    expect((await h.http.patch("/roles/fleet_manager").set(bearer(co.token)).send({ nameAr: "اسم آخر" })).status).toBe(422);
  });

  it("finance sees and exports, approves financial corrections, and no longer edits (default)", async () => {
    const me = (await h.http.get("/me").set(bearer(fin))).body;
    expect(me.permissions).toEqual(RBAC_MATRIX.finance_reviewer);
    expect(me.permissions["cost.write"]).toBeUndefined();
    expect((await h.http.get("/costs").set(bearer(fin))).status).toBe(200);
    expect((await h.http.post("/costs").set(bearer(fin)).send({})).status).toBe(403);
    expect((await h.http.get("/reports/costs/export").set(bearer(fin))).status).not.toBe(403);
  });

  it("a change to a built-in role applies to its people at once, and can be reset", async () => {
    expect((await h.http.get("/vehicles").set(bearer(fm))).status).toBe(200);
    const fmPerms = { ...RBAC_MATRIX.fleet_manager } as Record<string, string>;
    delete fmPerms["vehicle.read"];
    const r = await h.http.patch("/roles/fleet_manager").set(bearer(co.token)).send({ permissions: { ...fmPerms, "user.manage": "all" } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ customized: true });
    expect(r.body.permissions["user.manage"]).toBeUndefined(); // admin-only: dropped
    expect((await h.http.get("/vehicles").set(bearer(fm))).status).toBe(403);
    expect((await h.http.get("/me").set(bearer(fm))).body.permissions["vehicle.read"]).toBeUndefined();
    const back = await h.http.post("/roles/fleet_manager/reset").set(bearer(co.token));
    expect(back.body).toMatchObject({ customized: false });
    expect((await h.http.get("/vehicles").set(bearer(fm))).status).toBe(200);
  });

  it("a custom role: named by the company, branches per role, switched off ends its access", async () => {
    const made = await h.http.post("/roles").set(bearer(co.token)).send({ nameAr: "مشرف الحركة", nameEn: "Dispatcher", permissions: { "vehicle.read": "branches", "fuel.read": "branches" } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect((await h.http.post("/roles").set(bearer(co.token)).send({ nameAr: "مشرف الحركة", nameEn: "Other" })).status).toBe(409);
    expect((await h.http.post("/roles").set(bearer(co.token)).send({ nameAr: "مدير الشركة", nameEn: "Boss" })).status).toBe(409);

    // The fleet manager also gets the custom role (a second membership, its own branches) and switches to it.
    const add = await h.http.post("/users").set(bearer(co.token)).send({ email: `fm@${co.slug}.test`, displayName: "FM", role: "custom", roleId: made.body.id, branchIds: [co.hq] });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body.user).toMatchObject({ role: "custom", roleId: made.body.id, roleName: { ar: "مشرف الحركة", en: "Dispatcher" }, branchIds: [co.hq] });
    const me = (await h.http.get("/me").set(bearer(fm))).body;
    const ms = me.memberships.find((m: { role: string }) => m.role === "custom");
    expect(ms.roleName).toEqual({ ar: "مشرف الحركة", en: "Dispatcher" });
    const sw = await h.http.post("/auth/switch-role").set(bearer(fm)).send({ membershipId: ms.id });
    expect(sw.status).toBe(200);
    const dispatcher = sw.body.accessToken as string;
    expect(sw.body.user.permissions).toEqual({ "vehicle.read": "branches", "fuel.read": "branches" });
    expect((await h.http.get("/vehicles").set(bearer(dispatcher))).status).toBe(200);
    expect((await h.http.get("/drivers").set(bearer(dispatcher))).status).toBe(403);

    // Unknown or switched-off roles cannot be given; switching a role off ends what it allowed.
    expect((await h.http.post("/users").set(bearer(co.token)).send({ email: `x@${co.slug}.test`, displayName: "X", role: "custom" })).status).toBe(422);
    expect((await h.http.patch(`/roles/${made.body.id}`).set(bearer(co.token)).send({ status: "inactive" })).status).toBe(200);
    expect((await h.http.get("/vehicles").set(bearer(dispatcher))).status).toBe(403);
    expect((await h.http.post("/users").set(bearer(co.token)).send({ email: `y@${co.slug}.test`, displayName: "Y", role: "custom", roleId: made.body.id })).status).toBe(422);
    expect(fmMembership).toBeTruthy();
  });
});
