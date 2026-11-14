import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, bearer } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

/** Owner decisions (14 Nov 2026): self sign-up, company profile, my account, temporary passwords, forgot username. */
run("sign-up, company profile, account recovery", () => {
  const h = new Harness(ADMIN!);
  let platform = "";
  const email = () => `owner.${h.sfx}@signup.test`;

  beforeAll(async () => {
    await h.start();
    platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
  });
  afterAll(() => h.stop());

  let admin = "";

  it("a company admin signs up with an emailed code; the company works at once", async () => {
    const start = await h.http.post("/auth/signup").send({ companyName: "شركة النقل السريع", countryCode: "EG", adminName: "منى", email: email() });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    expect(start.body).toMatchObject({ codeSent: true, emailHint: expect.stringContaining("@signup.test") });
    const token = start.body.signupToken as string;

    expect((await h.http.post("/auth/signup/verify").send({ signupToken: token, code: "000000", password: "a-strong-password-1" })).body.error.fields.code).toBe("invalid_code");
    expect((await h.http.post("/auth/signup/verify").send({ signupToken: token, code: h.lastCode(email()), password: "short" })).status).toBe(422);
    const v = await h.http.post("/auth/signup/verify").send({ signupToken: token, code: h.lastCode(email()), password: "a-strong-password-1" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    // The same token cannot create a second company.
    expect((await h.http.post("/auth/signup/verify").send({ signupToken: token, code: h.lastCode(email()), password: "a-strong-password-1" })).status).toBe(400);

    let fin = await h.http.post("/auth/signup/finish").send({ signupToken: token });
    for (let i = 0; i < 20 && fin.body.status === "provisioning"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      fin = await h.http.post("/auth/signup/finish").send({ signupToken: token });
    }
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    expect(fin.body.user).toMatchObject({ role: "company_admin", tenant: { name: "شركة النقل السريع" }, mustChangePassword: false });
    admin = fin.body.accessToken;
    expect((await h.http.post("/auth/signup/finish").send({ signupToken: token })).status).toBe(400); // once only
    expect((await h.http.get("/branches").set(bearer(admin))).body.items).toHaveLength(1);
    // The platform admin sees it in the company list.
    const list = await h.http.get("/platform/tenants").set(bearer(platform));
    expect(list.body.items.some((t: { name: string; status: string }) => t.name === "شركة النقل السريع" && t.status === "active")).toBe(true);
  });

  it("limits sign-up attempts per email", async () => {
    const body = { companyName: "Spam Co", countryCode: "EG", adminName: "Sam", email: `spam.${h.sfx}@signup.test` };
    for (let i = 0; i < 3; i++) expect((await h.http.post("/auth/signup").send(body)).status).toBe(200);
    expect((await h.http.post("/auth/signup").send(body)).status).toBe(429);
  });

  it("the company admin edits the profile and logo; colleagues only see it", async () => {
    const r = await h.http.patch("/company").set(bearer(admin)).send({ name: "النقل السريع", address: "القاهرة", taxNumber: "123-456-789", email: "info@fast.test" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ name: "النقل السريع", address: "القاهرة", taxNumber: "123-456-789", hasLogo: false });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const logo = await h.http.post("/company/logo").set(bearer(admin)).set("content-type", "image/png").send(png);
    expect(logo.status, JSON.stringify(logo.body)).toBe(200);
    expect(logo.body.hasLogo).toBe(true);
    expect((await h.http.post("/company/logo").set(bearer(admin)).set("content-type", "application/pdf").send(Buffer.from("%PDF-1.4"))).status).toBe(415);
    const got = await h.http.get("/company/logo").set(bearer(admin));
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect((await h.http.get("/me").set(bearer(admin))).body.tenant.name).toBe("النقل السريع");

    const inv = await h.http.post("/users").set(bearer(admin)).send({ email: `fin.${h.sfx}@signup.test`, displayName: "Fin", role: "finance_reviewer" });
    const fin = (await h.acceptInvite(`fin.${h.sfx}@signup.test`, inv.body.inviteToken, "finance-pass-1234")).body.accessToken;
    expect((await h.http.get("/company").set(bearer(fin))).body.name).toBe("النقل السريع");
    expect((await h.http.patch("/company").set(bearer(fin)).send({ name: "x y" })).status).toBe(403);
  });

  it("my account: details and password change; other sessions end", async () => {
    const a = await h.http.patch("/account").set(bearer(admin)).send({ displayName: "منى أحمد", phone: "+20 100 000 0000", jobTitle: "مدير العمليات" });
    expect(a.body).toMatchObject({ displayName: "منى أحمد", phone: "+20 100 000 0000", jobTitle: "مدير العمليات" });
    expect((await h.http.post("/account/password").set(bearer(admin)).send({ currentPassword: "wrong-password-0", newPassword: "another-strong-pass-2" })).body.error.fields.currentPassword).toBe("wrong_password");
    const ok = await h.http.post("/account/password").set(bearer(admin)).send({ currentPassword: "a-strong-password-1", newPassword: "another-strong-pass-2" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await h.login(email(), "another-strong-pass-2")).status).toBe(200);
  });

  it("a temporary password from the admin: no email code, and a new password comes first", async () => {
    const users = (await h.http.get("/users").set(bearer(admin))).body.items as { membershipId: string; email: string }[];
    const fin = users.find((u) => u.email === `fin.${h.sfx}@signup.test`)!;
    const t = await h.http.post(`/users/${fin.membershipId}/temp-password`).set(bearer(admin));
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    expect(t.body.password).toMatch(/^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/);
    const mailsBefore = h.mail.sent.length;
    const login = await h.http.post("/auth/login").send({ email: fin.email, password: t.body.password });
    expect(login.status).toBe(200);
    expect(login.body.mfaToken).toBeUndefined();
    expect(h.mail.sent.length).toBe(mailsBefore);
    expect(login.body.user.mustChangePassword).toBe(true);
    const tk = login.body.accessToken as string;
    expect((await h.http.get("/costs").set(bearer(tk))).body.error.code).toBe("password_change_required");
    expect((await h.http.get("/me").set(bearer(tk))).status).toBe(200);
    const changed = await h.http.post("/account/password").set(bearer(tk)).send({ currentPassword: t.body.password, newPassword: "finance-new-pass-9" });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.mustChangePassword).toBe(false);
    expect((await h.http.get("/costs").set(bearer(tk))).status).toBe(200);
    // An admin cannot use it on themselves.
    const me = (await h.http.get("/me").set(bearer(admin))).body;
    expect((await h.http.post(`/users/${me.currentMembershipId}/temp-password`).set(bearer(admin))).status).toBe(409);
  });

  it("the platform admin can give a company admin a temporary password", async () => {
    const tenants = (await h.http.get("/platform/tenants").set(bearer(platform))).body.items as { id: string; name: string }[];
    const co = tenants.find((x) => x.name === "النقل السريع")!;
    const r = await h.http.post(`/platform/tenants/${co.id}/admin-temp-password`).set(bearer(platform)).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await h.http.post("/auth/login").send({ email: email(), password: r.body.password })).body.user.mustChangePassword).toBe(true);
  });

  it("forgot sign-in name: an email with the details, same answer for unknown emails", async () => {
    expect((await h.http.post("/auth/forgot-username").send({ email: "nobody@nowhere.test" })).status).toBe(200);
    expect((await h.http.post("/auth/forgot-username").send({ email: email() })).status).toBe(200);
    const m = [...h.mail.sent].reverse().find((x) => x.to === email());
    expect(m?.text).toContain(email());
    expect(m?.text).toContain("النقل السريع");
  });
});
