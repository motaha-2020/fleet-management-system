/** Prints fresh MASTER_KEY and JWT_PRIVATE_KEY_B64 values for a local .env. */
import { generateKeyPairSync, randomBytes } from "node:crypto";
const { privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
console.log(`MASTER_KEY=${randomBytes(32).toString("base64")}`);
console.log(`JWT_PRIVATE_KEY_B64=${Buffer.from(pem).toString("base64")}`);
