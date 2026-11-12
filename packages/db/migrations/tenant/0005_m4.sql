-- M4: maintenance (E10) and operational readiness (E12).

-- Readings taken at a maintenance visit join the odometer ledger (ODO-001).
ALTER TABLE meter_readings DROP CONSTRAINT meter_readings_source_type_check;
ALTER TABLE meter_readings ADD CONSTRAINT meter_readings_source_type_check
  CHECK (source_type IN ('opening','manual','fuel','handover','replacement','correction','maintenance'));

-- Defect photos are uploaded like fuel receipts (OFF-008).
ALTER TABLE uploads DROP CONSTRAINT uploads_record_type_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_record_type_check CHECK (record_type IN ('fuel_receipt','defect_photo'));

-- ---------- Templates (MNT-002) ----------
CREATE TABLE maintenance_templates (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  make        text,            -- null = any make
  model       text,            -- null = any model
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (model IS NULL OR make IS NOT NULL)
);

CREATE TABLE maintenance_template_items (
  id               uuid PRIMARY KEY,
  template_id      uuid NOT NULL REFERENCES maintenance_templates(id),
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,32}$'),
  name             text NOT NULL,
  interval_km      int CHECK (interval_km > 0),
  interval_months  int CHECK (interval_months > 0),
  safety           boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL),
  UNIQUE (template_id, code)
);

-- US-E10-01: per-vehicle interval override for one item code.
CREATE TABLE vehicle_maintenance_overrides (
  vehicle_id       uuid NOT NULL REFERENCES vehicles(id),
  item_code        text NOT NULL,
  interval_km      int CHECK (interval_km > 0),
  interval_months  int CHECK (interval_months > 0),
  updated_by       uuid NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, item_code),
  CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL)
);

-- Last time each item was done for a vehicle (MNT-008). Set by completed visits or as an opening baseline.
CREATE TABLE maintenance_baselines (
  vehicle_id   uuid NOT NULL REFERENCES vehicles(id),
  item_code    text NOT NULL,
  done_on      date NOT NULL,
  odometer     int CHECK (odometer >= 0),
  reading_id   uuid REFERENCES meter_readings(id),
  source_type  text NOT NULL CHECK (source_type IN ('visit','opening')),
  source_id    uuid,
  updated_by   uuid NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, item_code)
);

-- ---------- Defects (WO-001/002) ----------
CREATE TABLE defects (
  id               uuid PRIMARY KEY,
  vehicle_id       uuid NOT NULL REFERENCES vehicles(id),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  driver_id        uuid REFERENCES drivers(id),
  reported_at      timestamptz NOT NULL,       -- event time (offline: estimated device time)
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  description      text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  drivable         boolean NOT NULL,
  photo_file_key   text,
  photo_mime       text,
  status           text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','triaged','converted','rejected','duplicate')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_reason  text,
  work_order_id    uuid,
  duplicate_of     uuid REFERENCES defects(id),
  flags            text[] NOT NULL DEFAULT '{}',
  created_by       uuid NOT NULL,
  CHECK (status NOT IN ('rejected','duplicate') OR length(decision_reason) >= 3),
  CHECK ((status = 'duplicate') = (duplicate_of IS NOT NULL))
);
CREATE INDEX defects_vehicle_idx ON defects (vehicle_id, reported_at);
CREATE INDEX defects_open_idx ON defects (status) WHERE status IN ('reported','triaged');

-- ---------- Work orders (WO-003..006) ----------
CREATE TABLE work_orders (
  id                    uuid PRIMARY KEY,
  vehicle_id            uuid NOT NULL REFERENCES vehicles(id),
  branch_id             uuid NOT NULL REFERENCES branches(id),
  defect_id             uuid REFERENCES defects(id),
  type                  text NOT NULL CHECK (type IN ('preventive','corrective','accident')),
  title                 text NOT NULL,
  not_drivable          boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','scheduled','in_progress','completed','closed','cancelled')),
  scheduled_for         date,
  vendor_id             uuid REFERENCES vendors(id),
  off_road_at           timestamptz,
  return_to_service_at  timestamptz,
  close_reason          text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT not_drivable OR off_road_at IS NOT NULL),
  CHECK (return_to_service_at IS NULL OR off_road_at IS NULL OR return_to_service_at >= off_road_at)
);
CREATE INDEX work_orders_vehicle_idx ON work_orders (vehicle_id, status);
ALTER TABLE defects ADD CONSTRAINT defects_work_order_fk FOREIGN KEY (work_order_id) REFERENCES work_orders(id);
-- A defect converts into at most one work order.
CREATE UNIQUE INDEX work_orders_defect_uq ON work_orders (defect_id) WHERE defect_id IS NOT NULL;

-- ---------- Visits (MNT-001, MNT-006..008) ----------
CREATE TABLE maintenance_visits (
  id              uuid PRIMARY KEY,
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  work_order_id   uuid REFERENCES work_orders(id),
  vendor_id       uuid REFERENCES vendors(id),
  type            text NOT NULL CHECK (type IN ('preventive','corrective','accident')),
  visit_date      date NOT NULL,
  odometer        int CHECK (odometer >= 0),
  reading_id      uuid REFERENCES meter_readings(id),
  net_minor       bigint CHECK (net_minor >= 0),
  tax_minor       bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  gross_minor     bigint GENERATED ALWAYS AS (net_minor + tax_minor) STORED,
  currency        char(3) NOT NULL,
  parts_minor     bigint CHECK (parts_minor >= 0),
  labor_minor     bigint CHECK (labor_minor >= 0),
  other_minor     bigint CHECK (other_minor >= 0),
  invoice_ref     text,
  notes           text,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','voided')),
  completed_at    timestamptz,
  void_reason     text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- US-E10-07: a completed visit always has its invoice total, and the breakdown never exceeds it.
  CHECK (status <> 'completed' OR (net_minor IS NOT NULL AND odometer IS NOT NULL)),
  CHECK (coalesce(parts_minor,0) + coalesce(labor_minor,0) + coalesce(other_minor,0) <= coalesce(net_minor + tax_minor, 0) OR net_minor IS NULL),
  CHECK ((status = 'voided') = (void_reason IS NOT NULL))
);
CREATE INDEX maintenance_visits_vehicle_idx ON maintenance_visits (vehicle_id, visit_date);

CREATE TABLE maintenance_visit_items (
  visit_id   uuid NOT NULL REFERENCES maintenance_visits(id),
  item_code  text NOT NULL,
  PRIMARY KEY (visit_id, item_code)
);

-- ---------- Readiness (OPS-003, OPS-005) ----------
CREATE TABLE readiness_rule_settings (
  rule_code   text PRIMARY KEY,
  risk        text NOT NULL CHECK (risk IN ('R1','R2','R3','R4')),
  updated_by  uuid NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE readiness_overrides (
  id           uuid PRIMARY KEY,
  rule_code    text NOT NULL,
  entity_type  text NOT NULL CHECK (entity_type IN ('vehicle','driver')),
  entity_id    uuid NOT NULL,
  subject      text,
  risk         text NOT NULL CHECK (risk IN ('R2','R3')),    -- never R4 (OPS-005)
  reason       text NOT NULL CHECK (length(reason) >= 3),
  expires_at   timestamptz NOT NULL,
  branch_id    uuid NOT NULL,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  revoked_by   uuid,
  CHECK (expires_at > created_at)
);
CREATE INDEX readiness_overrides_entity_idx ON readiness_overrides (entity_type, entity_id) WHERE revoked_at IS NULL;
