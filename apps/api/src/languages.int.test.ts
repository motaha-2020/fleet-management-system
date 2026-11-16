import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, bearer } from "./test/harness.js";
import { renderAlert } from "./m5/alert.service.js";
import { mailLang, pickName } from "./infra/lang.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

/** Owner (16 Nov 2026): four languages — standard Arabic, Tunisian, French, English. */
describe("languages (no database)", () => {
  it("emails: Tunisian readers get standard Arabic, French readers French", () => {
    expect([mailLang("ar"), mailLang("tn"), mailLang("fr"), mailLang("en"), mailLang(null)]).toEqual(["ar", "ar", "fr", "en", "ar"]);
  });

  it("names fall back: Tunisian to Arabic, French to English", () => {
    const n = { ar: "بنزين بدون رصاص", en: "Unleaded petrol", fr: "Essence sans plomb", tn: "بنزين" };
    expect([pickName(n, "ar"), pickName(n, "tn"), pickName(n, "fr"), pickName(n, "en")]).toEqual(["بنزين بدون رصاص", "بنزين", "Essence sans plomb", "Unleaded petrol"]);
    expect([pickName({ ar: "تأمين", en: "Insurance" }, "tn"), pickName({ ar: "تأمين", en: "Insurance" }, "fr")]).toEqual(["تأمين", "Insurance"]);
  });

  it("alert text in French", () => {
    const r = renderAlert({ type: "x", severity: "low", subject: "", params: { expiryDate: "2026-12-01", daysLeft: 5, docName: { ar: "البطاقة الرمادية", en: "Registration", fr: "Carte grise" } } }, "fr");
    expect(r.body).toContain("Carte grise");
    expect(r.body).toContain("Expiration: 2026-12-01");
    expect(r.body).toContain("5 jours restants");
  });
});

run("languages (account)", () => {
  const h = new Harness(ADMIN!);
  let token = "";

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    token = (await h.company(platform, "lang", { countryCode: "TN" })).token;
  });
  afterAll(() => h.stop());

  it("each user picks one of the four languages", async () => {
    for (const locale of ["fr", "tn", "en", "ar"]) {
      const r = await h.http.patch("/account").set(bearer(token)).send({ locale });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.locale).toBe(locale);
    }
    expect((await h.http.patch("/account").set(bearer(token)).send({ locale: "de" })).status).toBe(422);
  });
});
