import { Inject, Injectable } from "@nestjs/common";
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, SecretBox, type Db } from "@fleet/db";
import { CONTROL_DB, SECRETS } from "./tokens.js";

export interface TenantCrypto {
  /** AES-256-GCM with the tenant's own data key (field-level encryption, files). */
  box: SecretBox;
  /** Deterministic HMAC for exact-match search and uniqueness without storing plaintext. */
  blindIndex(value: string): string;
  /** Raw key for streaming file encryption. */
  fileKey: Buffer;
}

/**
 * Envelope encryption (Architecture §6.1, §10): each tenant has a random data key, stored sealed with
 * the platform master key in the control plane. Database and backups only ever hold ciphertext.
 */
@Injectable()
export class TenantKeys {
  private readonly cache = new Map<string, Promise<TenantCrypto>>();
  constructor(@Inject(CONTROL_DB) private readonly db: Db, @Inject(SECRETS) private readonly master: SecretBox) {}

  for(tenantId: string): Promise<TenantCrypto> {
    let p = this.cache.get(tenantId);
    if (!p) {
      p = this.load(tenantId).catch((e) => {
        this.cache.delete(tenantId);
        throw e;
      });
      this.cache.set(tenantId, p);
    }
    return p;
  }

  forget(tenantId: string) {
    this.cache.delete(tenantId);
  }

  private async load(tenantId: string): Promise<TenantCrypto> {
    // Created lazily so tenants provisioned before this feature get a key on first use.
    await this.db.insert(schema.tenantKeys).values({ tenantId, dataKeyEnc: this.master.seal(randomBytes(32).toString("base64")) }).onConflictDoNothing();
    const [row] = await this.db.select().from(schema.tenantKeys).where(eq(schema.tenantKeys.tenantId, tenantId));
    const dataKey = Buffer.from(this.master.open(row!.dataKeyEnc), "base64");
    const derive = (info: string) => Buffer.from(hkdfSync("sha256", dataKey, Buffer.alloc(0), info, 32));
    const fieldKey = derive("fleet/field/v1");
    const indexKey = derive("fleet/blind-index/v1");
    return {
      box: new SecretBox(fieldKey.toString("base64")),
      blindIndex: (value) => createHmac("sha256", indexKey).update(value).digest("hex"),
      fileKey: derive("fleet/file/v1"),
    };
  }
}
