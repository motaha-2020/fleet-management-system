-- M5: import & onboarding (E17: IMP-001..006).
CREATE TABLE import_batches (
  id               uuid PRIMARY KEY,
  entity           text NOT NULL CHECK (entity IN ('vehicles','drivers','opening_odometer','fines','costs')),
  -- IMP-003: financial records all-or-nothing; master data may be partial.
  mode             text NOT NULL CHECK (mode IN ('all_or_nothing','partial')),
  status           text NOT NULL DEFAULT 'validated' CHECK (status IN ('validated','imported','partially_imported','failed','rolled_back')),
  file_name        text NOT NULL,
  file_sha256      text NOT NULL,
  mapping          jsonb NOT NULL DEFAULT '{}',
  rows             jsonb NOT NULL,
  errors           jsonb NOT NULL DEFAULT '[]',
  results          jsonb NOT NULL DEFAULT '[]',
  row_count        int NOT NULL,
  error_count      int NOT NULL DEFAULT 0,
  imported_count   int NOT NULL DEFAULT 0,
  branch_ids       uuid[] NOT NULL DEFAULT '{}',
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  imported_by      uuid,
  imported_at      timestamptz,
  rolled_back_by   uuid,
  rolled_back_at   timestamptz,
  rollback_reason  text
);
CREATE INDEX import_batches_hash_idx ON import_batches (entity, file_sha256);
ALTER TABLE cost_records ADD COLUMN import_batch_id uuid REFERENCES import_batches(id);
