import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import { keystore } from "./keystore";

/**
 * Encrypted local store (Architecture §8.1). The whole file is encrypted by SQLCipher with a
 * random 256-bit key kept in the OS keystore, so a copied database file is unreadable.
 * A raw hex key skips SQLCipher's PBKDF2 step, which matters on low-end phones.
 * The web build resolves localdb.web.ts instead (development only, NOT encrypted).
 */
const KEY_NAME = "fleet.db.key";
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function dbKey(): Promise<string> {
  let key = await keystore.get(KEY_NAME);
  if (!key) {
    key = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
    await keystore.set(KEY_NAME, key);
  }
  return key;
}

export function localDb(name = "fleet.db"): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync(name);
    // Must be the first statement on the connection.
    await db.execAsync(`PRAGMA key = "x'${await dbKey()}'";`);
    await db.execAsync("PRAGMA journal_mode = WAL;");
    return db;
  })();
  return dbPromise;
}

/** Empty string when the build is plain SQLite (SQLCipher not linked). */
export async function cipherVersion(db: SQLite.SQLiteDatabase): Promise<string> {
  const row = await db.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version;").catch(() => null);
  return row?.cipher_version ?? "";
}
