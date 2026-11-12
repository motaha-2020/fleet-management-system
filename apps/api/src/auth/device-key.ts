import { createPublicKey, verify, type KeyObject } from "node:crypto";

/**
 * Device keys (SEC-005, Architecture §6): EC P-256 public keys from the phone's Keystore / Secure Enclave,
 * sent as SPKI DER in base64. The phone signs "fleet-refresh-v1:" + its refresh token; the refresh token is
 * single-use, so each proof is good exactly once.
 */
export const DEVICE_PROOF_PREFIX = "fleet-refresh-v1:";

export function parseDeviceKey(spkiBase64: string): KeyObject | null {
  try {
    const key = createPublicKey({ key: Buffer.from(spkiBase64, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return null;
    return key;
  } catch {
    return null;
  }
}

export function verifyDeviceProof(key: KeyObject, refreshToken: string, proofBase64: string): boolean {
  try {
    return verify("sha256", Buffer.from(DEVICE_PROOF_PREFIX + refreshToken, "utf8"), { key, dsaEncoding: "der" }, Buffer.from(proofBase64, "base64"));
  } catch {
    return false;
  }
}
