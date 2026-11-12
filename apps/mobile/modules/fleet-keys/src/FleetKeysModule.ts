import { requireOptionalNativeModule } from "expo";

/**
 * Hardware-held device key (EC P-256): Android Keystore / iOS Secure Enclave.
 * The server stores the public key at activation and accepts a session renewal only with a signature
 * from it, so a copied refresh token is useless on another phone.
 */
export interface FleetKeysNative {
  /** Creates a new key (replacing any old one) and returns its public key, SPKI DER in base64. */
  createKey(): Promise<string>;
  /** The current public key, or null when none was created. */
  publicKey(): string | null;
  /** ECDSA P-256 / SHA-256 signature of the UTF-8 message, DER in base64. */
  sign(message: string): Promise<string>;
  deleteKey(): void;
}

/** null in Expo Go and on web: the module only exists in a native build. */
export default requireOptionalNativeModule<FleetKeysNative>("FleetKeys");
