import * as SQLite from "expo-sqlite";
import { assertDevWeb } from "./devWeb";

/**
 * Web (development only): the same schema and SQL as on the phone, run by expo-sqlite's WebAssembly build
 * and kept in the browser's origin-private file system. There is no SQLCipher on web, so the database is
 * NOT encrypted and there is no key to keep. Needs the COOP/COEP headers set in metro.config.js.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function localDb(name = "fleet.db"): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    assertDevWeb();
    return SQLite.openDatabaseAsync(name);
  })();
  return dbPromise;
}

/** Always empty on web: the database is plain SQLite. */
export async function cipherVersion(_db: SQLite.SQLiteDatabase): Promise<string> {
  return "";
}
