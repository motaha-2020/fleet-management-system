# M3 — Offline & Sync: design skeleton (for approval)

Decisions (2026-11-12):
- **Local store:** expo-sqlite + SQLCipher. This needs an EAS dev build, so Expo Go is no longer used.
- **Sync:** one `POST /sync/events`.
- **Photos:** resumable chunked upload.
- **Scope:** fuel and standalone odometer reading.

Architecture §8 stays the reference. This file fixes the types that cross the boundaries before any logic is written.

## Pattern

```
Device                                         Server (tenant DB)
──────                                         ──────────────────
action ─► outbox (SQLCipher, FIFO by seq)      POST /sync/events
          │                                     ├─ verify grant + device
          └─ sync loop ── batch ≤ 50 ─────────► ├─ for each event:
                                                │    seen in ingested_events? → return stored result
             ◄── results + new grant + read set ┤    gap in device_seq? → hold
                                                │    else handler(type) in one transaction
          accepted → upload photos (chunks) ──► └─ release held events whose gap is now filled
```

- **Transactional Outbox** on the device. Writing the action and its outbox row is one local transaction.
- **Idempotent Receiver (Inbox)** on the server, through `ingested_events`.
- **Command Handler registry.** There is one handler per event type. It calls the same service as the REST endpoint, so `createFuelEntry` moves from `FuelController` into a `FuelService`.

## Wire contract (`packages/contracts`)

```ts
type SyncEventType = "fuel.create" | "odometer.record";

interface SyncEvent {
  eventId: string;            // UUIDv7 made on the device; it is also the id of the record it creates
  type: SyncEventType;
  payload: FuelCreatePayload | OdometerRecordPayload;   // validated by the handler's own Zod schema
  deviceSeq: number;          // 1, 2, 3… per device, with no gaps on the device
  deviceTime: string;         // ISO wall clock at the time of the action
  grantId: string;            // the Offline Grant in force when the action was taken
  elapsedMs: number | null;   // monotonic ms since that grant was received; null = unknown (reboot)
}

interface SyncRequest  { events: SyncEvent[] }          // 1..50, ascending deviceSeq

type SyncStatus = "accepted" | "warning" | "conflict" | "rejected" | "held";
interface SyncResult {
  eventId: string;
  status: SyncStatus;
  recordId?: string;
  code?: string;              // e.g. grant_expired, assignment_expired, out_of_scope, invalid_payload
  flags?: string[];           // e.g. clock_drift, time_unverified, plus the record's own warnings
}

interface SyncResponse {
  results: SyncResult[];      // same order as the request
  grant: string;              // fresh Offline Grant (JWS)
  serverTime: string;
  readSet: ReadSet;           // assigned vehicles, last odometer, fuel types, document/maintenance due
  lastAppliedSeq: number;     // highest seq applied with no gap before it; the device can drop rows up to here
}

type FuelCreatePayload     = Omit<CreateFuelEntryRequest, "id">;
type OdometerRecordPayload = { vehicleId: string; odometer: number; note?: string };
```

## Offline Grant (JWS, EdDSA, same signing key as access tokens, separate `typ`)

```ts
interface OfflineGrantClaims {
  typ: "offline-grant";
  jti: string;                // grantId
  sub: string;                // identityId
  tid: string;                // tenantId
  did: string;                // deviceId
  drv: string;                // driverId
  veh: string[];              // vehicles the driver may act on offline (assigned, or branch scope today)
  iat: number;                // server time
  exp: number;                // iat + 72h (D-OFF-GRANT)
}
```

- **On the device:** check the signature with the public key from `/sync/keys`. Then check `elapsed (monotonic) < exp − iat`. If the elapsed time is unknown after a reboot, use the wall clock and add the `time_unverified` flag.
- **On the server:** `grantId` must be a grant issued to this device. The event time must fall within that grant's window. A new action after expiry is `rejected/grant_expired`. Events created before expiry are still accepted when they arrive later (OFF-003).

## Server tables (tenant DB, migration `0004_m3.sql`)

```sql
ingested_events (
  event_id     uuid PRIMARY KEY,
  device_id    uuid NOT NULL,
  device_seq   bigint NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  device_time  timestamptz NOT NULL,
  server_time  timestamptz NOT NULL DEFAULT now(),
  estimated_time timestamptz,              -- grant iat + elapsedMs
  clock_drift_ms bigint,                   -- device_time − estimated_time
  grant_id     uuid NOT NULL,
  status       text NOT NULL CHECK (status IN ('held','accepted','warning','conflict','rejected')),
  result       jsonb,                      -- the exact SyncResult returned (replayed on retry)
  record_type  text, record_id uuid,
  created_by   uuid NOT NULL,
  UNIQUE (device_id, device_seq)
)

sync_conflicts (
  id           uuid PRIMARY KEY,
  event_id     uuid NOT NULL REFERENCES ingested_events,
  reason       text NOT NULL,              -- assignment_expired, vehicle_not_in_scope, odometer_conflict …
  status       text NOT NULL CHECK (status IN ('open','accepted','rejected','corrected')),
  resolution_reason text, resolved_by uuid, resolved_at timestamptz,
  CHECK (status = 'open' OR (resolved_by IS NOT NULL AND resolution_reason IS NOT NULL))
)

uploads (
  id uuid PRIMARY KEY, record_type text NOT NULL, record_id uuid NOT NULL,
  total_bytes int NOT NULL CHECK (total_bytes <= 512000), received_bytes int NOT NULL DEFAULT 0,
  sha256 text NOT NULL, completed_at timestamptz, created_by uuid NOT NULL
)
```

All three tables are append/update only, with no `DELETE`, and are added to `grants.sql`.

## Upload API

```
POST /uploads              { recordType, recordId, totalBytes, sha256 } → { uploadId, receivedBytes }   (idempotent by recordId)
PUT  /uploads/:id          header Upload-Offset: n, body ≤ 64 KB          → { receivedBytes }
                           a wrong offset gives 409 with the current receivedBytes, so the device resumes from there
                           when the last chunk arrives the sha256 is checked, then the same path as uploadFuelReceipt runs
```

## Conflict queue API

```
GET  /sync/conflicts?status=open                                   fleet.manage scope
POST /sync/conflicts/:id/resolve { decision: accept|reject|correct, reason, correction? }
     accept  → the handler runs again with override; the record is created and recalculation runs
     reject  → the event stays stored, no record
     correct → creates the record with corrected fields + a correction trail
     There is never any automatic last-write-wins.
```

## Device (apps/mobile)

```ts
// local SQLCipher schema
outbox(seq INTEGER PRIMARY KEY, event_id TEXT UNIQUE, type TEXT, payload TEXT, device_time TEXT,
       grant_id TEXT, elapsed_ms INTEGER, status TEXT /* pending|sent|accepted|warning|conflict|rejected */,
       result TEXT)
photos(id TEXT PRIMARY KEY, event_id TEXT, path TEXT, bytes INTEGER, sha256 TEXT,
       upload_id TEXT, received INTEGER, done INTEGER)
read_set(key TEXT PRIMARY KEY, json TEXT)
grant(id TEXT PRIMARY KEY, jws TEXT, received_monotonic INTEGER, boot_id TEXT)

interface Outbox  { enqueue(type, payload, photo?): Promise<string /*eventId*/>; pending(): Promise<number>; }
interface SyncLoop { kick(): void; status$: Observable<{ online: boolean; pending: number; lastSync?: string }>; }
interface Clock   { monotonicMs(): number; bootId(): string; }   // native module: elapsedRealtime + BOOT_COUNT
```

## Errors a handler can return

| code | status | meaning |
|---|---|---|
| `invalid_payload` | rejected | the schema failed; never retried |
| `grant_expired` | rejected | the action was taken after the grant had expired |
| `grant_unknown` | rejected | the grant was not issued to this device |
| `vehicle_not_in_scope` | conflict | the driver no longer has this vehicle |
| `assignment_expired` | conflict | the assignment ended before the event time |
| `odometer_conflict` | conflict | the meter ledger reported a conflict |
| — | warning | accepted with flags (clock_drift, time_unverified, fuel flags) |

## Production limits

- Batch of at most 50 events, at most 256 KB of JSON.
- One batch in flight per device, retried with backoff.
- `clock_drift` when the drift is more than 5 minutes (D-OFF-DRIFT).
- A held event waits at most 7 days. After that it goes to the conflict queue as `sequence_gap`.
- Chunk of at most 64 KB. Temp chunks are deleted 48 h after the last activity.
- Logs and metrics carry tenant, device, seq and status. Sync success rate and conflict count are recorded for the M5 dashboards.

## Build order

0. **Spike:** native monotonic clock + SQLCipher on an EAS build on a real low-end Android phone.
1. Server: FuelService refactor, `0004_m3.sql`, `/sync/events` (idempotency, ordering, drift, grant), tests for US-E14-01..04.
2. Server and web: conflict queue (US-E14-06).
3. Server: chunked uploads (US-E14-05).
4. Mobile: SQLCipher store, outbox, sync loop, odometer screen, offline UI and logout warning (US-E14-07).
5. Device key-pair proof + PIN/biometric (deferred SEC item).

## Spike result (2026-11-12)

Tested on a real Android phone with an EAS build (`spike` profile).

| Check | Result |
|---|---|
| Native monotonic clock | Works. With the phone clock moved by 3 h between launches, it showed **4 min** while the wall clock showed **−177 min**, so changing the phone time doesn't fool the Offline Grant |
| Boot id | `android:1669` (BOOT_COUNT readable) |
| SQLCipher | Linked (4.17.0 community) |
| Write speed | 1000 single-row inserts in one transaction: 1.7 s, count in 3 ms. An outbox write is one row per action, so this is fine |

Both of the riskiest assumptions hold, so the design stands as written. The `time_unverified` fallback is still needed after a reboot.

## Drifted while building step 1 (2026-11-12)

| Design said | Built | Why |
|---|---|---|
| `odometer_conflict` → status `conflict` | The reading is stored with the meter ledger's own `conflict` status; the event is `warning` with `odometer_*` flags | The E08 correction flow already handles conflicting readings. The conflict queue is for events that created **no** record |
| `grant_id NOT NULL` | Nullable | An event naming an unknown grant is still stored (as `rejected/grant_unknown`) so the device sequence keeps moving |
| `GET /sync/keys` | `GET /sync/public-key` (public) + `POST /sync/grant` (grant + read set) | One call when the app comes online, before any events |
| Scope = driver's current vehicles | Fuel: grant vehicles or the driver's branch (FUEL-008). Odometer: an assignment at the **event time** (`assignment_expired` when the grant listed the vehicle but the assignment ended) | Offline events are judged by when they happened, not when they arrived |
| Held event → `sequence_gap` after 7 days | Not built yet | Lands with the conflict-queue resolution (step 2) |
| — | `clock_drift` added to the fuel warning flags, so a drifted fuel entry goes to review | US-E14-03 "flagged for review" |
| — | Fixed: `POST /meter-readings` with a client `id` now stores that id (before, a retry created a second reading) | Needed for idempotent `odometer.record`; same bug class as Worked Example E5 |

## Step 2: conflict resolution (2026-11-12)

- `POST /sync/conflicts/:id/resolve { decision: accept|reject|correct, reason (≥3), correction? }`, gated by `sync.conflict_review` (company admin: all; fleet manager: their branches).
- **accept:** the handler runs again as the driver who recorded the event, without the scope check that sent it to the queue. The record is created at the event time, and the usual recalculation follows from the record.
- **correct:** the same, with the reviewer's fields merged over the original payload (`vehicleId, odometer, quantity, amountMinor, fuelType`). The original payload stays on the event, and the change is stored on the conflict.
- **reject:** nothing is created. The event becomes `rejected/rejected_by_reviewer`.
- **For all three:** the phone's next retry of the same event gets the final decision. Nothing is resolved by last-write-wins. The recorder can't decide their own event.
- **sequence_gap:** an event held more than 7 days for a missing earlier seq goes to the queue as `sequence_gap`, and the device's sequence moves past the gap.
- **Web:** `/sync-conflicts` (Arabic + English) with open/all tabs, a decision form with a required reason, and a corrected-value field for readings.
