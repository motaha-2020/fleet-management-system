-- M5: traffic fines, Egypt pilot (E29: INC-003..005).
CREATE TABLE fines (
  id                    uuid PRIMARY KEY,
  vehicle_id            uuid NOT NULL REFERENCES vehicles(id),
  branch_id             uuid NOT NULL REFERENCES branches(id),
  violation_at          timestamptz NOT NULL,
  amount_minor          bigint NOT NULL CHECK (amount_minor > 0),
  currency              char(3) NOT NULL,
  authority_ref         text,
  due_date              date,
  description           text,
  payment_status        text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','disputed')),
  paid_on               date,
  -- INC-003: the system suggests the custodian at the violation time; a person confirms (or picks).
  suggested_driver_id   uuid REFERENCES drivers(id),
  driver_id             uuid REFERENCES drivers(id),
  driver_confirmed_by   uuid,
  driver_confirmed_at   timestamptz,
  source                text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  import_batch_id       uuid,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  void_reason           text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((payment_status = 'paid') = (paid_on IS NOT NULL)),
  CHECK ((status = 'voided') = (void_reason IS NOT NULL))
);
-- US-E29-01: one fine per authority reference.
CREATE UNIQUE INDEX fines_authority_ref_uq ON fines (authority_ref) WHERE authority_ref IS NOT NULL AND status = 'active';
CREATE INDEX fines_vehicle_idx ON fines (vehicle_id, violation_at);
