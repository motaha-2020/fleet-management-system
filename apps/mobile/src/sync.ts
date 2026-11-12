import { AppState } from "react-native";
import * as Network from "expo-network";
import { ApiRequestError } from "@fleet/contracts";
import { session } from "./session";
import { store, type LocalStatus } from "./store";
import { readReceipt } from "./receipts";

/**
 * Sends the outbox when there is a connection (docs/M3_Offline_Design.md):
 *  1. events in device order, one batch in flight; the answer carries a fresh grant and read set
 *  2. then photos of accepted events, in 64 KB chunks that resume where they stopped (OFF-008)
 * Failures only delay: the next attempt waits longer (backoff up to 5 minutes). Nothing is lost.
 */
export interface SyncStatus { online: boolean | null; syncing: boolean; pending: number; lastSync: string | null }
type Listener = (s: SyncStatus) => void;

const CHUNK = 65_536;
const GRANT_REFRESH_MS = 15 * 60_000;

class SyncEngine {
  private status: SyncStatus = { online: null, syncing: false, pending: 0, lastSync: null };
  private listeners = new Set<Listener>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private started = false;
  private forceNext = false;
  /** Set when the server answered during this round; "online" is shown only then. */
  private contacted = false;

  subscribe(l: Listener) {
    this.listeners.add(l);
    l(this.status);
    return () => void this.listeners.delete(l);
  }
  private set(p: Partial<SyncStatus>) {
    this.status = { ...this.status, ...p };
    for (const l of this.listeners) l(this.status);
  }

  /** Starts the background loop: on launch, when the app comes back to the foreground, and on a timer. */
  start() {
    if (this.started) return;
    this.started = true;
    AppState.addEventListener("change", (s) => { if (s === "active") void this.kick({ force: true }); });
    // Follow the phone's connection (OFF-011): offline shows at once; coming back online sends right away.
    const onNetwork = (n: { isConnected?: boolean; isInternetReachable?: boolean | null }) => {
      const up = n.isConnected !== false && n.isInternetReachable !== false;
      if (!up) this.set({ online: false });
      else if (this.status.online !== true) void this.kick({ force: true });
    };
    Network.addNetworkStateListener(onNetwork);
    void Network.getNetworkStateAsync().then(onNetwork).catch(() => {});
    void store.getLastSync().then((lastSync) => this.set({ lastSync }));
    void this.kick({ force: true });
  }

  /**
   * Try now. `force` (a person asked: pull-to-refresh, "send now", app opened or back online) always asks the
   * server, so a new assignment shows at once; the timer only asks when something waits or the grant is old.
   */
  kick(opts: { force?: boolean } = {}): Promise<void> {
    if (opts.force) this.forceNext = true;
    if (this.running) { this.again = true; return this.running; }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) { this.again = false; void this.kick(); }
      else this.schedule();
    });
    return this.running;
  }

  private schedule() {
    const delay = this.failures ? Math.min(300_000, 5_000 * 2 ** Math.min(this.failures, 6)) : this.status.pending ? 30_000 : GRANT_REFRESH_MS;
    this.timer = setTimeout(() => void this.kick(), delay);
  }

  private async run() {
    if (!session.user) return;
    this.set({ syncing: true, pending: await store.pendingCount() });
    const force = this.forceNext;
    this.forceNext = false;
    this.contacted = false;
    try {
      await this.sendEvents(force);
      await this.uploadPhotos();
      this.failures = 0;
      // Only an answer from the server proves the connection; a round with nothing to send proves nothing.
      this.set({ ...(this.contacted ? { online: true } : {}), lastSync: await store.getLastSync() });
    } catch (e) {
      this.failures++;
      // An HTTP answer means we are online; only a failed request means offline.
      this.set({ online: e instanceof ApiRequestError });
    } finally {
      this.set({ syncing: false, pending: await store.pendingCount() });
    }
  }

  private async sendEvents(force: boolean) {
    let batch = await store.toSend();
    if (!batch.length) {
      const last = await store.getLastSync();
      const { grant } = await store.grantState();
      if (force || !grant || !last || Date.now() - Date.parse(last) > GRANT_REFRESH_MS) {
        await store.saveState(await session.api.call("syncState"));
        this.contacted = true;
      }
      return;
    }
    while (batch.length) {
      const res = await session.api.call("syncEvents", { body: { events: batch.map((e) => ({
        eventId: e.eventId, type: e.type, payload: e.payload, deviceSeq: e.seq, deviceTime: e.deviceTime, grantId: e.grantId, elapsedMs: e.elapsedMs,
      })) } });
      this.contacted = true;
      await store.applyResults(res.results.map((r) => ({ ...r, status: r.status as LocalStatus })));
      await store.saveState(res);
      await store.dropOrphanPhotos();
      this.set({ pending: await store.pendingCount() });
      // Held events wait for an earlier one; sending them again now would not change anything.
      if (res.results.every((r) => r.status === "held")) return;
      batch = (await store.toSend()).filter((e) => e.status === "pending");
    }
  }

  private async uploadPhotos() {
    for (const p of await store.photosToUpload()) {
      let state;
      try {
        state = await session.api.call("startUpload", { body: { recordType: "fuel_receipt", recordId: p.eventId, totalBytes: p.bytes, sha256: p.sha256 } });
      } catch (e) {
        // The entry already has a receipt (sent another way): nothing left to do for this photo.
        if (e instanceof ApiRequestError && e.code === "receipt_exists") { await store.photoFinished(p.eventId, 2); continue; }
        throw e;
      }
      await store.setUploadId(p.eventId, state.uploadId);
      if (!state.completed) {
        const bytes = await readReceipt(p.path);
        let offset = state.receivedBytes;
        let restarts = 0;
        while (offset < bytes.length) {
          try {
            const r = await session.uploadChunk(state.uploadId, offset, bytes.subarray(offset, offset + CHUNK));
            offset = r.receivedBytes;
            if (r.completed) break;
          } catch (e) {
            if (e instanceof ApiRequestError && e.code === "offset_mismatch") { offset = Number(e.fields.uploadOffset ?? 0); continue; }
            // Damaged on the way: the server starts over; try once more now, then leave it for the next round.
            if (e instanceof ApiRequestError && e.code === "checksum_mismatch" && restarts++ < 1) { offset = 0; continue; }
            throw e;
          }
        }
      }
      await store.photoFinished(p.eventId, 1);
      this.set({ pending: await store.pendingCount() });
    }
  }
}

export const sync = new SyncEngine();
