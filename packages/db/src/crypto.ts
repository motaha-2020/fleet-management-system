import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM envelope for secrets stored in the control plane (e.g. tenant DB passwords). */
export class SecretBox {
  private readonly key: Buffer;
  constructor(masterKeyB64: string) {
    const key = Buffer.from(masterKeyB64, "base64");
    if (key.length !== 32) throw new Error("MASTER_KEY must be 32 bytes, base64-encoded");
    this.key = key;
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
  }
  open(sealed: string): string {
    const [v, iv, tag, ct] = sealed.split(".");
    if (v !== "v1" || !iv || !tag || !ct) throw new Error("unsupported sealed secret");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  }
}

/** SHA-256 for high-entropy tokens (refresh/invite). Low-entropy secrets use argon2 instead. */
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
