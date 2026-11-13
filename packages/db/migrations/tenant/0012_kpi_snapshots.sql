-- US-E16-03 / AUD-003: monthly KPI snapshots and the log of why a month was recalculated.
-- One snapshot per month for the whole company (all branches), replaced when the month is recalculated.
CREATE TABLE kpi_snapshots (
  month        date PRIMARY KEY CHECK (extract(day FROM month) = 1),
  kpis         jsonb NOT NULL,
  costs        jsonb NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only: one row per month a cause (an applied correction) touched. Pending while the month is
-- "Recalculating"; done keeps the values before and after so the change can be explained.
CREATE TABLE kpi_recalculations (
  id            uuid PRIMARY KEY,
  month         date NOT NULL CHECK (extract(day FROM month) = 1),
  cause_type    text NOT NULL CHECK (cause_type IN ('correction')),
  cause_id      uuid NOT NULL,
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  requested_by  uuid NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  before        jsonb,
  after         jsonb,
  UNIQUE (cause_type, cause_id, month)
);
CREATE INDEX kpi_recalculations_month_idx ON kpi_recalculations (month, requested_at DESC);
CREATE INDEX kpi_recalculations_pending_idx ON kpi_recalculations (requested_at) WHERE status = 'pending';
