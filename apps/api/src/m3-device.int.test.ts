import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { Harness, bearer } from "./test/harness.js";
import { DEVICE_PROOF_PREFIX } from "./auth/device-key.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

/** SEC-005: the driver device registers a hardware key; a refresh is accepted only with its signature. */
run("Fleet API — M3 device key (integration)", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  let driverId = "";
  const username = () => `key.${h.sfx}`;

  const ecKey = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = (k: KeyObject) => k.export({ type: "spki", format: "der" }).toString("base64");
  const proof = (priv: KeyObject, token: string) => sign("sha256", Buffer.from(DEVICE_PROOF_PREFIX + token), { key: priv, dsaEncoding: "der" }).toString("base64");
  const newCode = async () => (await h.http.post(`/drivers/${driverId}/activation-code`).set(bearer(co.token))).body.code as string;
  const activate = async (devicePublicKey?: string) =>
    h.http.post("/auth/driver/activate").send({ username: username(), code: await newCode(), deviceName: "P", platform: "android", ...(devicePublicKey ? { devicePublicKey } : {}) });
  const refresh = (refreshToken: string, deviceProof?: string) => h.http.post("/auth/refresh").send({ refreshToken, ...(deviceProof ? { deviceProof } : {}) });

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "key");
    driverId = (await h.http.post("/drivers").set(bearer(co.token)).send({ branchId: co.hq, fullName: "Key Driver", username: username() })).body.id;
  });
  afterAll(() => h.stop());

  it("a renewal needs the device's signature; a failed proof consumes nothing", async () => {
    const { publicKey, privateKey } = ecKey();
    const a = await activate(spki(publicKey));
    expect(a.status).toBe(200);
    const token = a.body.refreshToken as string;

    // Stolen token, no key: refused, and the token is not burned
    const none = await refresh(token);
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe("device_proof_invalid");
    // Signed by another key: refused
    expect((await refresh(token, proof(ecKey().privateKey, token))).status).toBe(401);
    // A proof for another token does not transfer
    expect((await refresh(token, proof(privateKey, token + "x"))).status).toBe(401);

    // The real phone still renews with the same token
    const ok = await refresh(token, proof(privateKey, token));
    expect(ok.status).toBe(200);
    const next = ok.body.refreshToken as string;
    expect(next).not.toBe(token);
    // Replaying the old token with its (valid) proof is reuse: the whole session family dies
    expect((await refresh(token, proof(privateKey, token))).status).toBe(401);
    expect((await refresh(next, proof(privateKey, next))).status).toBe(401);
  });

  it("a key that is not EC P-256 is refused at activation", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;
    const r = await activate(spki(rsa));
    expect(r.status).toBe(422);
    expect(r.body.error.fields.devicePublicKey).toBe("invalid_device_key");
    const garbage = await activate("A".repeat(120));
    expect(garbage.status).toBe(422);
  });

  it("devices activated without a key (before M3) still renew, and a new activation with a key replaces them", async () => {
    const legacy = await activate();
    expect(legacy.status).toBe(200);
    const ok = await refresh(legacy.body.refreshToken);
    expect(ok.status).toBe(200);
    const { publicKey, privateKey } = ecKey();
    const keyed = await activate(spki(publicKey));
    // The old device is revoked by the new activation
    expect((await refresh(ok.body.refreshToken)).status).toBe(401);
    expect((await refresh(keyed.body.refreshToken, proof(privateKey, keyed.body.refreshToken))).status).toBe(200);
  });
});
