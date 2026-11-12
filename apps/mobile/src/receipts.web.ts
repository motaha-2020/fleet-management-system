import * as Crypto from "expo-crypto";
import { localDb } from "./localdb";

/**
 * Web (development only): there is no app folder, so the photo bytes are kept in the local database
 * (unencrypted, like the rest of the web build) under a "web-receipt:<eventId>" path.
 */
export interface KeptReceipt { path: string; bytes: number; sha256: string }

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

let ready: Promise<void> | null = null;
async function db() {
  const d = await localDb();
  ready ??= d.execAsync("CREATE TABLE IF NOT EXISTS web_receipts (path TEXT PRIMARY KEY, data BLOB NOT NULL);");
  await ready;
  return d;
}

async function load(uri: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await (await fetch(uri)).arrayBuffer());
}

export async function fileSize(uri: string): Promise<number> {
  return (await load(uri)).length;
}

export async function keepReceipt(eventId: string, uri: string): Promise<KeptReceipt> {
  const bytes = await load(uri);
  const path = `web-receipt:${eventId}`;
  await (await db()).runAsync("INSERT OR REPLACE INTO web_receipts (path, data) VALUES (?, ?)", path, bytes);
  return { path, bytes: bytes.length, sha256: hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)) };
}

export async function readReceipt(path: string): Promise<Uint8Array> {
  const row = await (await db()).getFirstAsync<{ data: Uint8Array }>("SELECT data FROM web_receipts WHERE path = ?", path);
  if (!row) throw new Error("receipt_missing");
  return new Uint8Array(row.data);
}

export async function deleteReceipt(path: string) {
  await (await db()).runAsync("DELETE FROM web_receipts WHERE path = ?", path);
}

export async function deleteAllReceipts() {
  await (await db()).runAsync("DELETE FROM web_receipts");
}
