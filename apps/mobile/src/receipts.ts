import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

/**
 * Receipt photo files waiting for upload (OFF-008), in the app's private document folder.
 * The web build resolves receipts.web.ts instead (development only).
 */
export interface KeptReceipt { path: string; bytes: number; sha256: string }

const folder = () => new Directory(Paths.document, "receipts");
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** Size in bytes of a local file (Infinity when unknown). */
export async function fileSize(uri: string): Promise<number> {
  return new File(uri).size ?? Infinity;
}

/** Copies the photo into the app's private folder and returns where it is, its size and its SHA-256. */
export async function keepReceipt(eventId: string, uri: string): Promise<KeptReceipt> {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${eventId}.jpg`);
  await new File(uri).copy(dest);
  const bytes = await dest.bytes();
  return { path: dest.uri, bytes: bytes.length, sha256: hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)) };
}

export function readReceipt(path: string): Promise<Uint8Array> {
  return new File(path).bytes();
}

export async function deleteReceipt(path: string) {
  try { new File(path).delete(); } catch { /* already gone */ }
}

export async function deleteAllReceipts() {
  try {
    const dir = folder();
    if (dir.exists) dir.delete();
  } catch { /* nothing to remove */ }
}
