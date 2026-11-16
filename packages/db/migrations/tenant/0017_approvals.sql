-- Owner decision (14 Nov 2026): odometer readings, fuel entries, costs/invoices and maintenance count only after the
-- fleet manager approves them (the company admin when the fleet manager recorded it). Approval is required by
-- default; the company admin can make a type automatic. Existing records are test data and stay approved.

CREATE TABLE approval_settings (
  type        text PRIMARY KEY CHECK (type IN ('odometer', 'fuel', 'cost', 'maintenance')),
  mode        text NOT NULL CHECK (mode IN ('manual', 'auto')),
  updated_by  uuid NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Readings: a pending or rejected reading is left out of every distance, KPI and due-by-km calculation.
ALTER TABLE meter_readings
  ADD COLUMN approval_status  text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN decided_by       uuid,
  ADD COLUMN decided_at       timestamptz,
  ADD COLUMN decision_reason  text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500);
CREATE INDEX meter_readings_pending_idx ON meter_readings (event_at) WHERE approval_status = 'pending';

-- Fuel: an entry waiting for approval stays under review even when it has no findings.
ALTER TABLE fuel_entries ADD COLUMN needs_approval boolean NOT NULL DEFAULT false;

-- Costs: a pending cost is not counted (reports and KPIs count active ones); a rejected one is voided with the reason.
ALTER TABLE cost_records DROP CONSTRAINT cost_records_status_check;
ALTER TABLE cost_records ADD CONSTRAINT cost_records_status_check CHECK (status IN ('pending', 'active', 'voided'));
ALTER TABLE cost_records
  ADD COLUMN decided_by       uuid,
  ADD COLUMN decided_at       timestamptz,
  ADD COLUMN decision_reason  text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500);
CREATE INDEX cost_records_pending_idx ON cost_records (expense_date) WHERE status = 'pending';

-- Maintenance: a finished visit waits for approval before its cost and new baselines count.
ALTER TABLE maintenance_visits DROP CONSTRAINT maintenance_visits_status_check;
ALTER TABLE maintenance_visits ADD CONSTRAINT maintenance_visits_status_check CHECK (status IN ('draft', 'pending_approval', 'completed', 'voided'));
ALTER TABLE maintenance_visits
  ADD COLUMN decided_by       uuid,
  ADD COLUMN decided_at       timestamptz,
  ADD COLUMN decision_reason  text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500);
