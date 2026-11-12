import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIONS, RBAC_MATRIX, ROLES, type Action, type Role } from "@fleet/config";
import { newId } from "@fleet/db";
import { Harness, bearer } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

/**
 * US-E02-04: every cell of the RBAC matrix (PRD §5.3, packages/config) is checked through the real API.
 * Each action has a probe request on a route that @Requires it. Denied → 403 from the guard (before any
 * validation or lookup). Allowed → anything but 403 (200/201, or 404/422 because the probe uses a random
 * id or an empty body). Adding an action without a probe fails the test.
 */
const missing = () => newId();
const PROBES: Record<Action, { method: "get" | "post"; path: () => string; body?: object }> = {
  "tenant.manage": { method: "get", path: () => "/platform/tenants" },
  "user.manage": { method: "get", path: () => "/users" },
  "branch.read": { method: "get", path: () => "/branches" },
  "branch.write": { method: "post", path: () => "/branches", body: {} },
  "vendor.read": { method: "get", path: () => "/vendors" },
  "vendor.write": { method: "post", path: () => "/vendors", body: {} },
  "vehicle.read": { method: "get", path: () => "/vehicles" },
  "vehicle.write": { method: "post", path: () => "/vehicles", body: {} },
  "vehicle.transfer": { method: "post", path: () => `/vehicles/${missing()}/transfer`, body: {} },
  "vehicle.dispose": { method: "post", path: () => `/vehicles/${missing()}/dispose`, body: {} },
  "driver.read": { method: "get", path: () => "/drivers" },
  "driver.write": { method: "post", path: () => "/drivers", body: {} },
  "driver.issue_activation": { method: "post", path: () => `/drivers/${missing()}/activation-code` },
  "driver.view_sensitive": { method: "post", path: () => `/drivers/${missing()}/reveal` },
  "document_type.manage": { method: "post", path: () => "/document-types", body: {} },
  "document.read": { method: "get", path: () => "/document-types" },
  "document.upload": { method: "post", path: () => "/documents", body: {} },
  "document.verify": { method: "post", path: () => `/documents/${missing()}/verify` },
  "document.download": { method: "get", path: () => `/documents/${missing()}/file` },
  "audit.read": { method: "get", path: () => "/audit" },
  "assignment.read": { method: "get", path: () => "/assignments" },
  "assignment.write": { method: "post", path: () => "/assignments", body: {} },
  "assignment.backdate": { method: "post", path: () => `/assignments/${missing()}/backdate`, body: {} },
  "handover.create": { method: "post", path: () => "/handovers", body: {} },
  "odometer.read": { method: "get", path: () => `/vehicles/${missing()}/odometer` },
  "odometer.write": { method: "post", path: () => "/meter-readings", body: {} },
  "odometer.replace": { method: "post", path: () => "/meter-replacements", body: {} },
  "fuel.read": { method: "get", path: () => "/fuel-entries" },
  "fuel.create": { method: "post", path: () => "/fuel-entries", body: {} },
  "fuel.review": { method: "post", path: () => `/fuel-entries/${missing()}/accept` },
  "cost.read": { method: "get", path: () => "/costs" },
  "cost.write": { method: "post", path: () => "/costs", body: {} },
  "correction.request": { method: "post", path: () => "/corrections", body: {} },
  "correction.approve": { method: "post", path: () => `/corrections/${missing()}/approve`, body: {} },
  "fuel_price.manage": { method: "get", path: () => "/platform/fuel-prices" },
};

run("RBAC matrix enforced by the API (US-E02-04)", () => {
  const h = new Harness(ADMIN!);
  const tokens = {} as Record<Role, string>;

  beforeAll(async () => {
    await h.start();
    tokens.platform_admin = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    const co = await h.company(tokens.platform_admin, "rbac");
    tokens.company_admin = co.token;
    for (const role of ["fleet_manager", "finance_reviewer", "viewer"] as const) {
      const email = `${role}@${co.slug}.test`;
      const r = await h.http.post("/users").set(bearer(co.token)).send({ email, displayName: role, role, branchIds: role === "fleet_manager" ? [co.hq] : [] });
      tokens[role] = (await h.acceptInvite(email, r.body.inviteToken, `${role}-password-123`)).body.accessToken;
    }
    const d = await h.http.post("/drivers").set(bearer(co.token)).send({ branchId: co.hq, fullName: "Driver One", username: `drv.${h.sfx}` });
    const code = await h.http.post(`/drivers/${d.body.id}/activation-code`).set(bearer(co.token));
    tokens.driver = (await h.http.post("/auth/driver/activate").send({ username: `drv.${h.sfx}`, code: code.body.code, deviceName: "P", platform: "android" })).body.accessToken;
  });
  afterAll(() => h.stop());

  it("has a probe for every action", () => {
    expect(Object.keys(PROBES).sort()).toEqual([...ACTIONS].sort());
  });

  for (const role of ROLES) {
    for (const action of ACTIONS) {
      const allowed = !!RBAC_MATRIX[role][action];
      it(`${role} × ${action} → ${allowed ? "allowed" : "denied"}`, async () => {
        const p = PROBES[action];
        let req = h.http[p.method](p.path()).set(bearer(tokens[role]));
        if (p.body) req = req.send(p.body);
        const r = await req;
        if (allowed) expect(r.status, JSON.stringify(r.body)).not.toBe(403);
        else expect(r.status, JSON.stringify(r.body)).toBe(403);
        expect(r.status).not.toBe(401);
        expect(r.status).toBeLessThan(500);
      });
    }
  }
});
