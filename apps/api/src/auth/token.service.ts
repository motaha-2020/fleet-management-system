import { Inject, Injectable } from "@nestjs/common";
import { importPKCS8, SignJWT, jwtVerify, exportSPKI, type CryptoKey, type KeyObject } from "jose";
import { createPublicKey } from "node:crypto";
import { DEFAULTS } from "@fleet/config";
import { CONFIG } from "../infra/tokens.js";
import type { AppConfig } from "../config.js";

export interface AccessClaims {
  sub: string; // identity id
  mid: string | null; // membership id (null for platform admin)
  tid: string | null; // tenant id
  did: string | null; // device id
}

const ISSUER = "fleet-api";

/**
 * Access tokens are short-lived EdDSA JWTs. Asymmetric so devices can later verify
 * server-signed Offline Grants with the public key (Architecture §8.2).
 */
@Injectable()
export class TokenService {
  private key?: Promise<CryptoKey | KeyObject>;
  private pub?: KeyObject;
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  private privateKey() {
    this.key ??= importPKCS8(this.config.jwtPrivateKeyPem, "EdDSA");
    return this.key;
  }
  private publicKey() {
    this.pub ??= createPublicKey(this.config.jwtPrivateKeyPem);
    return this.pub;
  }

  async signAccess(c: AccessClaims): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = DEFAULTS.ACCESS_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ mid: c.mid, tid: c.tid, did: c.did })
      .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt" })
      .setSubject(c.sub)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(await this.privateKey());
    return { token, expiresIn };
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.publicKey(), { issuer: ISSUER, algorithms: ["EdDSA"], typ: "at+jwt" });
    if (typeof payload.sub !== "string") throw new Error("no subject");
    const s = (v: unknown) => (typeof v === "string" ? v : null);
    return { sub: payload.sub, mid: s(payload.mid), tid: s(payload.tid), did: s(payload.did) };
  }

  publicKeyPem() {
    return exportSPKI(this.publicKey());
  }
}
