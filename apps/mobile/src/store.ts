import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { uuidv7 } from "@fleet/domain";
import type { SessionUser, Vehicle } from "@fleet/contracts";
import { clock, type ClockReading } from "./clock";
import { localDb } from "./localdb";

/**
 * The driver's offline store (Architecture §8.1), all inside the SQLCipher database:
 *  - outbox: every action, in device order (seq = device_seq). Writing the action is the only step that
 *    must succeed offline; sending happens later (Transactional Outbox).
 *  - photos: receipt files waiting to be uploaded after their event is accepted (OFF-008).
 *  - kv: the Offline Grant (with the monotonic reading taken when it arrived) and the read set.
 */

export type SyncType = "fuel.create" | "odometer.record" | "defect.report";
export type LocalStatus = "pending" | "held" | "accepted" | "warning" | "conflict" | "rejected";
export interface OutboxRow {
  seq: number; eventId: string; type: SyncType; payload: Record<string, unknown>; deviceTime: string; grantId: string;
  elapsedMs: number | null; status: LocalStatus; code: string | null; flags: string[]; recordId: string | null; summary: string; createdAt: string;
}
export interface StoredGrant {
  token: string; grantId: string; issuedAt: string; expiresAt: string; vehicleIds: string[];
  /** Monotonic reading when the grant arrived; null without the native clock. */
  received: ClockReading | null;
}
export interface ReadSet {
  vehicles: Vehicle[];
  odometer: { vehicleId: string; value: number; at: string }[];
  /** US-E12-02: may the driver drive each vehicle, and why not (absent in read sets saved before M4). */
  readiness?: { vehicleId: string; outcome: "allowed" | "warning" | "restricted"; reasons: { code: string; risk: string; outcome: string; subject: string | null }[] }[];
}
export interface PhotoRow { eventId: string; type: SyncType; path: string; bytes: number; sha256: string; uploadId: string | null; done: number }

let ready: Promise<void> | null = null;
async function db() {
  const d = await localDb();
  ready ??= d.execAsync(`
    CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, payload TEXT NOT NULL,
      device_time TEXT NOT NULL, grant_id TEXT NOT NULL, elapsed_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', code TEXT, flags TEXT NOT NULL DEFAULT '[]', record_id TEXT,
      summary TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photos (
      event_id TEXT PRIMARY KEY, path TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
      upload_id TEXT, done INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  `);
  await ready;
  return d;
}

type RawOutbox = { seq: number; event_id: string; type: SyncType; payload: string; device_time: string; grant_id: string; elapsed_ms: number | null; status: LocalStatus; code: string | null; flags: string; record_id: string | null; summary: string; created_at: string };
const toRow = (r: RawOutbox): OutboxRow => ({
  seq: r.seq, eventId: r.event_id, type: r.type, payload: JSON.parse(r.payload), deviceTime: r.device_time, grantId: r.grant_id,
  elapsedMs: r.elapsed_ms, status: r.status, code: r.code, flags: JSON.parse(r.flags), recordId: r.record_id, summary: r.summary, createdAt: r.created_at,
});

// ---------------------------------------------------------------- key/value

async function getKv<T>(key: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ json: string }>("SELECT json FROM kv WHERE key = ?", key);
  return row ? (JSON.parse(row.json) as T) : null;
}
async function setKv(key: string, value: unknown) {
  await (await db()).runAsync("INSERT INTO kv (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", key, JSON.stringify(value));
}

export const store = {
  getGrant: () => getKv<StoredGrant>("grant"),
  getReadSet: () => getKv<ReadSet>("readSet"),
  getLastSync: () => getKv<string>("lastSync"),
  /** Profile from the last connection, so the app opens offline (OFF-001). */
  getUser: () => getKv<SessionUser>("user"),
  saveUser: (u: SessionUser) => setKv("user", u),

  /** Saves what the server returned on a successful connection: a fresh grant and the read set. */
  async saveState(s: { grant: Omit<StoredGrant, "received">; readSet: ReadSet; serverTime: string }) {
    await setKv("grant", { ...s.grant, received: clock.read() } satisfies StoredGrant);
    await setKv("readSet", s.readSet);
    await setKv("lastSync", new Date().toISOString());
  },

  /**
   * OFF-002/003: may the driver start a new offline action? Measured with the monotonic clock since the grant
   * arrived, so changing the phone time does not help. Without it (reboot), the wall clock decides.
   */
  async grantState(): Promise<{ grant: StoredGrant | null; valid: boolean; msLeft: number | null }> {
    const grant = await this.getGrant();
    if (!grant) return { grant, valid: false, msLeft: null };
    const span = Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt);
    const elapsed = clock.elapsedSince(grant.received);
    const left = elapsed !== null ? span - elapsed : Date.parse(grant.expiresAt) - Date.now();
    return { grant, valid: left > 0, msLeft: left };
  },

  // ---------------------------------------------------------------- outbox

  /**
   * Records an action locally. Its id is also the id of the record it will create, so sending it twice is safe.
   * The photo is copied into the app's private folder first; both rows are written in one transaction.
   */
  async enqueue(type: SyncType, payload: Record<string, unknown>, summary: string, photo?: { uri: string }) {
    const { grant, valid } = await this.grantState();
    if (!grant || !valid) throw new GrantExpiredError();
    const eventId = uuidv7(Date.now(), Crypto.getRandomBytes(10));
    let saved: { path: string; bytes: number; sha256: string } | null = null;
    if (photo) {
      const dir = new Directory(Paths.document, "receipts");
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const dest = new File(dir, `${eventId}.jpg`);
      await new File(photo.uri).copy(dest);
      const bytes = await dest.bytes();
      const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
      saved = { path: dest.uri, bytes: bytes.length, sha256: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("") };
    }
    const d = await db();
    await d.withTransactionAsync(async () => {
      await d.runAsync(
        "INSERT INTO outbox (event_id, type, payload, device_time, grant_id, elapsed_ms, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        eventId, type, JSON.stringify(payload), new Date().toISOString(), grant.grantId, clock.elapsedSince(grant.received), summary, new Date().toISOString(),
      );
      if (saved) await d.runAsync("INSERT INTO photos (event_id, path, bytes, sha256) VALUES (?, ?, ?, ?)", eventId, saved.path, saved.bytes, saved.sha256);
    });
    return eventId;
  },

  /** Events still to send (never answered, or waiting on the server for an earlier one), in device order. */
  async toSend(limit = 50): Promise<OutboxRow[]> {
    const rows = await (await db()).getAllAsync<RawOutbox>("SELECT * FROM outbox WHERE status IN ('pending','held') ORDER BY seq LIMIT ?", limit);
    return rows.map(toRow);
  },

  async applyResults(results: { eventId: string; status: LocalStatus; code?: string; flags?: string[]; recordId?: string }[]) {
    const d = await db();
    await d.withTransactionAsync(async () => {
      for (const r of results) {
        await d.runAsync("UPDATE outbox SET status = ?, code = ?, flags = ?, record_id = ? WHERE event_id = ?",
          r.status, r.code ?? null, JSON.stringify(r.flags ?? []), r.recordId ?? null, r.eventId);
      }
    });
  },

  async pendingCount(): Promise<number> {
    const d = await db();
    const ev = await d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM outbox WHERE status IN ('pending','held')");
    const ph = await d.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM photos WHERE done = 0");
    return (ev?.n ?? 0) + (ph?.n ?? 0);
  },

  async recent(limit = 15): Promise<(OutboxRow & { photoPending: boolean })[]> {
    const rows = await (await db()).getAllAsync<RawOutbox & { photo_done: number | null }>(
      "SELECT o.*, p.done AS photo_done FROM outbox o LEFT JOIN photos p ON p.event_id = o.event_id ORDER BY o.seq DESC LIMIT ?", limit);
    return rows.map((r) => ({ ...toRow(r), photoPending: r.photo_done === 0 }));
  },

  // ---------------------------------------------------------------- photos

  /** Photos whose text event the server accepted (OFF-008: text first, photos after). */
  async photosToUpload(): Promise<PhotoRow[]> {
    const rows = await (await db()).getAllAsync<{ event_id: string; type: SyncType; path: string; bytes: number; sha256: string; upload_id: string | null; done: number }>(
      "SELECT p.*, o.type FROM photos p JOIN outbox o ON o.event_id = p.event_id WHERE p.done = 0 AND o.status IN ('accepted','warning') ORDER BY o.seq");
    return rows.map((r) => ({ eventId: r.event_id, type: r.type, path: r.path, bytes: r.bytes, sha256: r.sha256, uploadId: r.upload_id, done: r.done }));
  },
  async setUploadId(eventId: string, uploadId: string) {
    await (await db()).runAsync("UPDATE photos SET upload_id = ? WHERE event_id = ?", uploadId, eventId);
  },
  /** done: 1 uploaded, 2 not needed (the event was rejected or a receipt already exists). The file is removed. */
  async photoFinished(eventId: string, done: 1 | 2) {
    const d = await db();
    const row = await d.getFirstAsync<{ path: string }>("SELECT path FROM photos WHERE event_id = ?", eventId);
    await d.runAsync("UPDATE photos SET done = ? WHERE event_id = ?", done, eventId);
    if (row) { try { new File(row.path).delete(); } catch { /* already gone */ } }
  },
  /** Photos of events the server will never accept are not uploaded. */
  async dropOrphanPhotos() {
    const d = await db();
    const rows = await d.getAllAsync<{ event_id: string }>(
      "SELECT p.event_id FROM photos p JOIN outbox o ON o.event_id = p.event_id WHERE p.done = 0 AND o.status IN ('rejected')");
    for (const r of rows) await this.photoFinished(r.event_id, 2);
  },

  /**
   * OFF-013: on logout or when another device is activated, nothing of this driver stays readable on the phone,
   * and the device sequence starts again at 1 for the new device.
   */
  async wipe() {
    const d = await db();
    await d.execAsync("DELETE FROM outbox; DELETE FROM photos; DELETE FROM kv; DELETE FROM sqlite_sequence WHERE name = 'outbox';");
    try {
      const dir = new Directory(Paths.document, "receipts");
      if (dir.exists) dir.delete();
    } catch { /* nothing to remove */ }
  },
};

export class GrantExpiredError extends Error {
  constructor() { super("offline_grant_expired"); }
}
