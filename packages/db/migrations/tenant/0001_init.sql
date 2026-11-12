-- Tenant DB (one per company). Tables are owned by the migration (admin) role;
-- the tenant's application role gets only the privileges granted below (ADR-012).
CREATE TABLE company (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  country_code  char(2) NOT NULL,
  currency      char(3) NOT NULL,
  timezone      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX company_singleton ON company ((true));

CREATE TABLE branches (
  id          uuid PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id                         uuid PRIMARY KEY,
  branch_id                  uuid NOT NULL REFERENCES branches(id),
  fleet_number               text NOT NULL,
  registration_number        text NOT NULL,
  registration_normalized    text NOT NULL,
  vin                        text CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  make                       text NOT NULL,
  model                      text NOT NULL,
  year                       int  NOT NULL,
  primary_fuel_type          text NOT NULL,
  primary_tank_capacity      numeric(10,3) NOT NULL CHECK (primary_tank_capacity > 0),
  secondary_fuel_type        text,
  secondary_tank_capacity    numeric(10,3) CHECK (secondary_tank_capacity > 0),
  meter_type                 text NOT NULL CHECK (meter_type IN ('distance','hours','both')),
  required_license_category  text NOT NULL,
  ownership_type             text NOT NULL CHECK (ownership_type IN ('owned','leased','rented')),
  status                     text NOT NULL CHECK (status IN ('draft','active','inactive','disposed')),
  created_by                 uuid NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CHECK ((secondary_fuel_type IS NULL) = (secondary_tank_capacity IS NULL)),
  CHECK (secondary_fuel_type IS DISTINCT FROM primary_fuel_type)
);
-- VEH-002: unique among non-disposed vehicles, enforced by the database.
CREATE UNIQUE INDEX vehicles_fleet_number_uq  ON vehicles (lower(fleet_number))  WHERE status <> 'disposed';
CREATE UNIQUE INDEX vehicles_registration_uq  ON vehicles (registration_normalized) WHERE status <> 'disposed';
CREATE UNIQUE INDEX vehicles_vin_uq           ON vehicles (vin) WHERE status <> 'disposed' AND vin IS NOT NULL;
CREATE INDEX vehicles_branch_idx ON vehicles (branch_id);

CREATE TABLE drivers (
  id           uuid PRIMARY KEY,
  branch_id    uuid NOT NULL REFERENCES branches(id),
  identity_id  uuid NOT NULL UNIQUE,  -- control-plane identity
  full_name    text NOT NULL,
  username     text NOT NULL UNIQUE,
  phone        text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drivers_branch_idx ON drivers (branch_id);

-- SEC-011: append-only audit log.
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid,
  action       text NOT NULL,
  entity_type  text,
  entity_id    uuid,
  before       jsonb,
  after        jsonb
);
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
