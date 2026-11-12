-- M3: offline & sync (E14). Architecture §8, docs/M3_Offline_Design.md.

-- ---------- Offline Grants (OFF-002) ----------
-- Every grant handed to a device. An offline event names its grant; the server checks the event against it.
CREATE TABLE offline_grants (
  id           uuid PRIMARY KEY,
  device_id    uuid NOT NULL,
  identity_id  uuid NOT NULL,
  driver_id    uuid REFERENCES drivers(id),
  vehicle_ids  uuid[] NOT NULL DEFAULT '{}',
  issued_at    timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  CHECK (expires_at > issued_at)
);
CREATE INDEX offline_grants_device_idx ON offline_grants (device_id, issued_at DESC);

-- ---------- Inbox (OFF-004/005/007) ----------
-- Highest device_seq applied with no gap before it, per device.
CREATE TABLE device_sync_state (
  device_id         uuid PRIMARY KEY,
  last_applied_seq  bigint NOT NULL DEFAULT 0 CHECK (last_applied_seq >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingested_events (
  event_id        uuid PRIMARY KEY,
  device_id       uuid NOT NULL,
  device_seq      bigint NOT NULL CHECK (device_seq > 0),
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  device_time     timestamptz NOT NULL,
  server_time     timestamptz NOT NULL DEFAULT now(),
  -- OFF-006: grant issue time + monotonic elapsed; both times are kept
  estimated_time  timestamptz,
  clock_drift_ms  bigint,
  elapsed_ms      bigint,
  -- NULL when the device named a grant it was never given (the event is stored as rejected so the sequence advances)
  grant_id        uuid REFERENCES offline_grants(id),
  status          text NOT NULL CHECK (status IN ('held','accepted','warning','conflict','rejected')),
  flags           text[] NOT NULL DEFAULT '{}',
  -- The exact result sent back; a retried event gets it again (OFF-005)
  result          jsonb,
  record_type     text,
  record_id       uuid,
  created_by      uuid NOT NULL,
  applied_at      timestamptz,
  UNIQUE (device_id, device_seq)
);
CREATE INDEX ingested_events_held_idx ON ingested_events (device_id, device_seq) WHERE status = 'held';

-- ---------- Conflict queue (OFF-009/010) ----------
-- No automatic last-write-wins: a person decides, with a reason.
CREATE TABLE sync_conflicts (
  id                 uuid PRIMARY KEY,
  event_id           uuid NOT NULL UNIQUE REFERENCES ingested_events(event_id),
  branch_id          uuid REFERENCES branches(id),
  reason             text NOT NULL,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected','corrected')),
  resolution_reason  text,
  resolved_by        uuid,
  resolved_at        timestamptz,
  -- correct: the fields the reviewer changed; accept/correct: the record that was created
  correction         jsonb,
  record_type        text,
  record_id          uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(resolution_reason) >= 3))
);
CREATE INDEX sync_conflicts_open_idx ON sync_conflicts (branch_id) WHERE status = 'open';

-- ---------- Resumable photo upload (OFF-008 / US-E14-05) ----------
-- One upload per record. Bytes are appended chunk by chunk and kept here until the file is complete and checked;
-- then the file goes (encrypted) to object storage and `data` is cleared.
CREATE TABLE uploads (
  id              uuid PRIMARY KEY,
  record_type     text NOT NULL CHECK (record_type IN ('fuel_receipt')),
  record_id       uuid NOT NULL,
  total_bytes     integer NOT NULL CHECK (total_bytes > 0 AND total_bytes <= 512000),
  received_bytes  integer NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= total_bytes),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  data            bytea,
  completed_at    timestamptz,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_type, record_id)
);
