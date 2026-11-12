-- M1: branches (E03), vendors (E04), vehicle lifecycle/transfer (E05), driver master (E06), documents (E11).

-- ---------- Branches ----------
ALTER TABLE branches
  ADD COLUMN timezone      text NOT NULL DEFAULT 'Africa/Cairo',
  ADD COLUMN weekend_days  int[] NOT NULL DEFAULT '{5}',   -- 0=Sunday … 6=Saturday
  ADD COLUMN status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now();

-- ---------- Vendors (VND-001..003) ----------
CREATE TABLE vendors (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN ('workshop','fuel_provider','lessor','insurer','other')),
  contact_name  text,
  phone         text,
  email         text,
  tax_id        text,
  branch_ids    uuid[] NOT NULL DEFAULT '{}',   -- coverage; empty = all branches
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vendors_name_type_uq ON vendors (lower(name), type) WHERE status = 'active';

-- ---------- Vehicles: disposal + branch history (VEH-005, VEH-006) ----------
ALTER TABLE vehicles
  ADD COLUMN disposed_at          date,
  ADD COLUMN disposal_reason      text CHECK (disposal_reason IN ('sold','scrapped','returned')),
  ADD COLUMN disposal_odometer    int CHECK (disposal_odometer >= 0),
  ADD COLUMN disposal_value_minor bigint CHECK (disposal_value_minor >= 0),
  ADD CONSTRAINT vehicles_disposal_complete CHECK ((status = 'disposed') = (disposed_at IS NOT NULL AND disposal_reason IS NOT NULL));

CREATE TABLE vehicle_branch_history (
  id              uuid PRIMARY KEY,
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  from_branch_id  uuid NOT NULL REFERENCES branches(id),
  to_branch_id    uuid NOT NULL REFERENCES branches(id),
  effective_at    timestamptz NOT NULL,
  reason          text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_branch_id <> to_branch_id)
);
CREATE INDEX vehicle_branch_history_vehicle_idx ON vehicle_branch_history (vehicle_id, effective_at);

-- ---------- Drivers (DRV-001..003, DRV-007) ----------
ALTER TABLE drivers
  ADD COLUMN employee_ref        text,
  ADD COLUMN national_id_enc     text,   -- AES-GCM with the tenant data key
  ADD COLUMN national_id_bidx    text,   -- HMAC blind index for exact search / uniqueness
  ADD COLUMN national_id_mask    text,   -- e.g. 2**********15
  ADD COLUMN license_number      text,
  ADD COLUMN license_categories  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN license_expiry      date,
  ADD COLUMN employment_status   text NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','suspended','terminated')),
  ADD COLUMN updated_at          timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX drivers_national_id_uq ON drivers (national_id_bidx) WHERE national_id_bidx IS NOT NULL AND employment_status <> 'terminated';
CREATE UNIQUE INDEX drivers_employee_ref_uq ON drivers (lower(employee_ref)) WHERE employee_ref IS NOT NULL AND employment_status <> 'terminated';
COMMENT ON COLUMN drivers.status IS 'login account status, mirrors the control-plane membership (DRV-002)';

-- ---------- Documents (DOC-001..008) ----------
-- Country document types live in @fleet/config (they follow the country template);
-- the company stores only stricter settings for them and its own custom types (GEN-008).
CREATE TABLE document_types (
  code               text PRIMARY KEY CHECK (code ~ '^C_[A-Z0-9_]{2,40}$'),
  entity_type        text NOT NULL CHECK (entity_type IN ('vehicle','driver')),
  name_ar            text NOT NULL,
  name_en            text NOT NULL,
  mandatory          boolean NOT NULL DEFAULT false,
  has_expiry         boolean NOT NULL DEFAULT true,
  risk               text NOT NULL CHECK (risk IN ('R1','R2','R3','R4')),
  driver_visibility  text NOT NULL DEFAULT 'none' CHECK (driver_visibility IN ('none','view','download')),
  sensitive          boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_type_settings (
  code               text PRIMARY KEY,
  mandatory          boolean,
  driver_visibility  text CHECK (driver_visibility IN ('none','view','download')),
  updated_by         uuid NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id                uuid PRIMARY KEY,
  entity_type       text NOT NULL CHECK (entity_type IN ('vehicle','driver')),
  entity_id         uuid NOT NULL,
  type_code         text NOT NULL,
  number            text,
  issue_date        date,
  expiry_date       date,
  country_code      char(2),
  version           int NOT NULL DEFAULT 1,
  status            text NOT NULL CHECK (status IN ('draft','pending','verified','rejected','superseded')),
  file_key          text,
  file_name         text,
  file_mime         text CHECK (file_mime IN ('application/pdf','image/jpeg','image/png')),
  file_size         int CHECK (file_size > 0 AND file_size <= 10485760),
  file_sha256       text,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  submitted_at      timestamptz,
  verified_by       uuid,
  verified_at       timestamptz,
  rejection_reason  text,
  superseded_by     uuid REFERENCES documents(id),
  -- GEN-004 Maker ≠ Checker, enforced by the database as well as the API
  CONSTRAINT documents_maker_checker CHECK (verified_by IS NULL OR verified_by <> created_by),
  CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date),
  CHECK (status IN ('draft') OR file_key IS NOT NULL)
);
CREATE INDEX documents_entity_idx ON documents (entity_type, entity_id, type_code);
CREATE INDEX documents_status_idx ON documents (status) WHERE status = 'pending';
CREATE INDEX documents_expiry_idx ON documents (expiry_date) WHERE status = 'verified';

-- ---------- Audit: branch for branch-scoped viewing ----------
ALTER TABLE audit_log ADD COLUMN branch_id uuid;
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
