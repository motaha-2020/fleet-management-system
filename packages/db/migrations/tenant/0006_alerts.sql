-- M5: alerts & notifications (E13) and fuel budgets (FUEL-015).

-- ---------- Alerts (ALR-001..005) ----------
CREATE TABLE alerts (
  id                   uuid PRIMARY KEY,
  type                 text NOT NULL,
  severity             text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','in_progress','resolved','closed')),
  -- Escalated is a flag, not a status (ALR-002); level = step of the same cause (DOC-009: 30 → 14 → 7).
  escalated            boolean NOT NULL DEFAULT false,
  level                int NOT NULL DEFAULT 0,
  dedup_key            text NOT NULL,
  entity_type          text NOT NULL,
  entity_id            uuid NOT NULL,
  branch_id            uuid,
  subject              text,
  params               jsonb NOT NULL DEFAULT '{}',
  owner_id             uuid,
  escalation_owner_id  uuid,
  owner_fallback       boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  acknowledged_at      timestamptz,
  acknowledged_by      uuid,
  resolved_at          timestamptz,
  resolved_by          uuid,
  resolution           text CHECK (resolution IN ('auto','manual')),
  resolution_note      text,
  closed_at            timestamptz,
  closed_by            uuid,
  CHECK ((status IN ('resolved','closed')) = (resolved_at IS NOT NULL))
);
-- ALR-003: one active alert per cause.
CREATE UNIQUE INDEX alerts_active_dedup ON alerts (dedup_key) WHERE status IN ('open','acknowledged','in_progress');
CREATE INDEX alerts_owner_idx ON alerts (owner_id, status);
CREATE INDEX alerts_entity_idx ON alerts (entity_type, entity_id);

-- ---------- Notifications (NTF-001, NTF-003): sending is recorded, reading is separate ----------
CREATE TABLE notifications (
  id            uuid PRIMARY KEY,
  alert_id      uuid NOT NULL REFERENCES alerts(id),
  recipient_id  uuid NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('email','push','in_app')),
  locale        text NOT NULL CHECK (locale IN ('ar','en')),
  address       text,
  subject       text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  provider      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  read_at       timestamptz
);
CREATE INDEX notifications_status_idx ON notifications (status, created_at);
CREATE INDEX notifications_recipient_idx ON notifications (recipient_id, created_at);

-- ---------- Fuel budgets (FUEL-015) ----------
CREATE TABLE fuel_budgets (
  id            uuid PRIMARY KEY,
  scope         text NOT NULL CHECK (scope IN ('company','branch','vehicle')),
  branch_id     uuid REFERENCES branches(id),
  vehicle_id    uuid REFERENCES vehicles(id),
  month         date NOT NULL CHECK (extract(day FROM month) = 1),
  amount_minor  bigint CHECK (amount_minor > 0),
  liters        numeric(12,2) CHECK (liters > 0),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_minor IS NOT NULL OR liters IS NOT NULL),
  CHECK ((scope = 'company' AND branch_id IS NULL AND vehicle_id IS NULL)
      OR (scope = 'branch' AND branch_id IS NOT NULL AND vehicle_id IS NULL)
      OR (scope = 'vehicle' AND vehicle_id IS NOT NULL))
);
CREATE UNIQUE INDEX fuel_budgets_uq ON fuel_budgets (scope, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'), coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'), month);
