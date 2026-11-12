-- M2: assignments & handover (E07), odometer ledger (E08), fuel (E09), costs (E15), corrections (E16).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- Assignments (ASN-001..006) ----------
CREATE TABLE assignments (
  id            uuid PRIMARY KEY,
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id),
  driver_id     uuid NOT NULL REFERENCES drivers(id),
  role          text NOT NULL CHECK (role IN ('primary','secondary')),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  notes         text,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  period        tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  -- ASN-002: one primary per vehicle at any moment
  CONSTRAINT assignments_vehicle_primary EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (role = 'primary' AND status = 'active'),
  -- ASN-003: a driver is primary on one vehicle at a time
  CONSTRAINT assignments_driver_primary EXCLUDE USING gist (driver_id WITH =, period WITH &&) WHERE (role = 'primary' AND status = 'active'),
  -- the same driver cannot hold two overlapping assignments on the same vehicle
  CONSTRAINT assignments_same_pair EXCLUDE USING gist (vehicle_id WITH =, driver_id WITH =, period WITH &&) WHERE (status = 'active')
);
CREATE INDEX assignments_vehicle_idx ON assignments (vehicle_id, starts_at);
CREATE INDEX assignments_driver_idx ON assignments (driver_id, starts_at);

-- ---------- Odometer ledger (ODO-001..010) ----------
CREATE TABLE meter_replacements (
  id          uuid PRIMARY KEY,
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id),
  event_at    timestamptz NOT NULL,
  old_final   int NOT NULL CHECK (old_final >= 0),
  new_start   int NOT NULL CHECK (new_start >= 0),
  reason      text,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, event_at)
);

CREATE TABLE meter_readings (
  id             uuid PRIMARY KEY,
  vehicle_id     uuid NOT NULL REFERENCES vehicles(id),
  value          int NOT NULL CHECK (value >= 0),
  event_at       timestamptz NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  source_type    text NOT NULL CHECK (source_type IN ('opening','manual','fuel','handover','replacement','correction')),
  source_id      uuid,
  status         text NOT NULL CHECK (status IN ('valid','warning','conflict','corrected','excluded')),
  reasons        text[] NOT NULL DEFAULT '{}',
  corroborates   uuid[] NOT NULL DEFAULT '{}',
  corrected_by   uuid REFERENCES meter_readings(id),
  created_by     uuid NOT NULL,
  CHECK ((status = 'corrected') = (corrected_by IS NOT NULL))
);
CREATE INDEX meter_readings_vehicle_idx ON meter_readings (vehicle_id, event_at);

-- ---------- Handovers (ASN-007) ----------
CREATE TABLE handovers (
  id              uuid PRIMARY KEY,
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  from_driver_id  uuid REFERENCES drivers(id),
  to_driver_id    uuid NOT NULL REFERENCES drivers(id),
  event_at        timestamptz NOT NULL,
  odometer        int NOT NULL CHECK (odometer >= 0),
  reading_id      uuid REFERENCES meter_readings(id),
  notes           text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_driver_id IS DISTINCT FROM to_driver_id)
);
CREATE INDEX handovers_vehicle_idx ON handovers (vehicle_id, event_at);

-- ---------- Fuel (FUEL-001..017) ----------
CREATE TABLE fuel_entries (
  id                     uuid PRIMARY KEY,
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id),
  driver_id              uuid REFERENCES drivers(id),
  branch_id              uuid NOT NULL REFERENCES branches(id),      -- vehicle's branch at the event (reports by branch)
  event_at               timestamptz NOT NULL,
  recorded_at            timestamptz NOT NULL DEFAULT now(),
  odometer               int NOT NULL CHECK (odometer >= 0),
  reading_id             uuid REFERENCES meter_readings(id),
  fuel_type              text NOT NULL,
  quantity               numeric(10,3) NOT NULL CHECK (quantity > 0),
  unit                   text NOT NULL CHECK (unit IN ('L','m3')),
  is_full                boolean NOT NULL,
  net_minor              bigint NOT NULL CHECK (net_minor > 0),
  tax_minor              bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  gross_minor            bigint GENERATED ALWAYS AS (net_minor + tax_minor) STORED,
  currency               char(3) NOT NULL,
  payment                text NOT NULL CHECK (payment IN ('cash','card')),
  receipt_ref            text,
  receipt_file_key       text,
  receipt_file_mime      text,
  reference_price_minor  int,
  reference_official     boolean,
  status                 text NOT NULL CHECK (status IN ('submitted','under_review','accepted','voided')),
  flags                  text[] NOT NULL DEFAULT '{}',
  notes                  text,
  created_by             uuid NOT NULL,
  reviewed_by            uuid,
  reviewed_at            timestamptz,
  void_reason            text,
  CONSTRAINT fuel_maker_checker CHECK (reviewed_by IS NULL OR reviewed_by <> created_by),
  CHECK ((status = 'voided') = (void_reason IS NOT NULL))
);
CREATE INDEX fuel_entries_vehicle_idx ON fuel_entries (vehicle_id, event_at);
CREATE INDEX fuel_entries_review_idx ON fuel_entries (status) WHERE status = 'under_review';

-- ---------- Costs (FIN-001..013) ----------
CREATE TABLE cost_records (
  id               uuid PRIMARY KEY,
  category         text NOT NULL CHECK (category IN ('fuel','preventive','corrective','accident','insurance','licensing','rental','fines','tolls','other')),
  vehicle_id       uuid REFERENCES vehicles(id),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  vendor_id        uuid REFERENCES vendors(id),
  net_minor        bigint NOT NULL CHECK (net_minor >= 0),
  tax_minor        bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  gross_minor      bigint GENERATED ALWAYS AS (net_minor + tax_minor) STORED,
  currency         char(3) NOT NULL,
  tax_recoverable  boolean NOT NULL,
  expense_date     date NOT NULL,
  source_type      text NOT NULL CHECK (source_type IN ('manual','fuel','maintenance','provider','fine')),
  source_id        uuid,
  e_invoice_uuid   text,
  description      text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  flags            text[] NOT NULL DEFAULT '{}',
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((source_type = 'manual') = (source_id IS NULL))
);
-- GEN-006 / FIN-003: one expense identity per source record — double counting is impossible.
CREATE UNIQUE INDEX cost_records_expense_identity ON cost_records (source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX cost_records_vehicle_idx ON cost_records (vehicle_id, expense_date);
CREATE INDEX cost_records_einvoice_idx ON cost_records (e_invoice_uuid) WHERE e_invoice_uuid IS NOT NULL;

-- ---------- Corrections (AUD-001..003, GEN-003) ----------
CREATE TABLE corrections (
  id             uuid PRIMARY KEY,
  record_type    text NOT NULL CHECK (record_type IN ('fuel_entry','meter_reading','cost_record')),
  record_id      uuid NOT NULL,
  branch_id      uuid NOT NULL,
  changes        jsonb NOT NULL,          -- { field: { from, to } }
  reason         text NOT NULL,
  financial      boolean NOT NULL,
  status         text NOT NULL CHECK (status IN ('pending','applied','rejected')),
  requested_by   uuid NOT NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  affected_from  date,
  affected_to    date,
  CONSTRAINT corrections_maker_checker CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX corrections_record_idx ON corrections (record_type, record_id);
CREATE INDEX corrections_pending_idx ON corrections (status) WHERE status = 'pending';
-- Only one open correction per record at a time.
CREATE UNIQUE INDEX corrections_one_pending ON corrections (record_type, record_id) WHERE status = 'pending';
