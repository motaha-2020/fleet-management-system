-- GEN-007 / US-E03-03: effective-dated company policies (thresholds). Append-only: a change is a new version.
CREATE TABLE company_policies (
  id              uuid PRIMARY KEY,
  key             text NOT NULL,
  value           numeric(12,3) NOT NULL,
  effective_from  date NOT NULL,
  retroactive     boolean NOT NULL DEFAULT false,
  reason          text NOT NULL CHECK (length(reason) >= 3),
  recalculated    int NOT NULL DEFAULT 0,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_policies_key_idx ON company_policies (key, effective_from DESC, created_at DESC);
