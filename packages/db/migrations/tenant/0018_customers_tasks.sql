-- Owner decisions (14 Nov 2026):
--  * Customers are data only (no sign-in). A task belongs to one customer; its vehicles and drivers work for it.
--  * A task is a trip (from → to) or a period (days, daily hours, or from/to date-time). The fleet manager makes it.
--  * A task has crew lines: vehicle + driver + from/to. A breakdown or a driver change closes a line (with a reason
--    and an odometer reading) and opens a new one; the task and its customer do not change. Repair costs of a
--    breakdown are the company's, never the customer's.
--  * The driver starts and finishes the task in the app with a meter photo; the task counts once approved.
--  * Vehicle inspections: a checklist, how often is a company setting, and they count once approved.

CREATE TABLE customers (
  id            uuid PRIMARY KEY,
  name          text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 200),
  contact_name  text CHECK (contact_name IS NULL OR length(contact_name) <= 200),
  phone         text CHECK (phone IS NULL OR length(phone) <= 20),
  email         text CHECK (email IS NULL OR length(email) <= 254),
  notes         text CHECK (notes IS NULL OR length(notes) <= 1000),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_name_key ON customers (lower(name));

CREATE TABLE tasks (
  id               uuid PRIMARY KEY,
  customer_id      uuid NOT NULL REFERENCES customers(id),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  kind             text NOT NULL CHECK (kind IN ('trip', 'period')),
  title            text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 200),
  from_place       text CHECK (from_place IS NULL OR length(from_place) <= 300),
  to_place         text CHECK (to_place IS NULL OR length(to_place) <= 300),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  -- "Per day" periods: the working hours of each day (local time of the branch), e.g. 08:00–16:00.
  daily_start      time,
  daily_end        time,
  notes            text CHECK (notes IS NULL OR length(notes) <= 1000),
  status           text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'done', 'approved', 'rejected', 'cancelled')),
  started_at       timestamptz,
  finished_at      timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_reason  text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((daily_start IS NULL) = (daily_end IS NULL)),
  CHECK (kind = 'period' OR (from_place IS NOT NULL AND to_place IS NOT NULL))
);
CREATE INDEX tasks_window_idx ON tasks (starts_at, ends_at);
CREATE INDEX tasks_customer_idx ON tasks (customer_id);

-- Who worked the task, and when. Exactly one open line per vehicle/driver slot; a swap ends one and starts another.
CREATE TABLE task_lines (
  id                 uuid PRIMARY KEY,
  task_id            uuid NOT NULL REFERENCES tasks(id),
  vehicle_id         uuid NOT NULL REFERENCES vehicles(id),
  driver_id          uuid NOT NULL REFERENCES drivers(id),
  -- Planned window of the line (the task's, or from the swap onwards).
  from_at            timestamptz NOT NULL,
  to_at              timestamptz NOT NULL,
  started_at         timestamptz,
  ended_at           timestamptz,
  start_reading_id   uuid REFERENCES meter_readings(id),
  end_reading_id     uuid REFERENCES meter_readings(id),
  end_reason         text CHECK (end_reason IN ('done', 'breakdown', 'driver_change', 'cancelled', 'other')),
  replaces_line_id   uuid REFERENCES task_lines(id),
  note               text CHECK (note IS NULL OR length(note) <= 500),
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (to_at > from_at),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX task_lines_task_idx ON task_lines (task_id);
CREATE INDEX task_lines_vehicle_idx ON task_lines (vehicle_id, from_at);
CREATE INDEX task_lines_driver_idx ON task_lines (driver_id, from_at);

ALTER TABLE meter_readings DROP CONSTRAINT meter_readings_source_type_check;
ALTER TABLE meter_readings ADD CONSTRAINT meter_readings_source_type_check
  CHECK (source_type IN ('opening','manual','fuel','handover','replacement','correction','maintenance','task','inspection'));

CREATE TABLE inspections (
  id               uuid PRIMARY KEY,
  vehicle_id       uuid NOT NULL REFERENCES vehicles(id),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  driver_id        uuid REFERENCES drivers(id),
  inspected_at     timestamptz NOT NULL,
  odometer         integer CHECK (odometer >= 0),
  reading_id       uuid REFERENCES meter_readings(id),
  -- [{ "code": "tires", "ok": true, "note": null }, ...] from the checklist in packages/config.
  items            jsonb NOT NULL,
  failed           integer NOT NULL DEFAULT 0,
  notes            text CHECK (notes IS NULL OR length(notes) <= 1000),
  status           text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_reason  text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inspections_vehicle_idx ON inspections (vehicle_id, inspected_at DESC);

ALTER TABLE approval_settings DROP CONSTRAINT approval_settings_type_check;
ALTER TABLE approval_settings ADD CONSTRAINT approval_settings_type_check CHECK (type IN ('odometer', 'fuel', 'cost', 'maintenance', 'task', 'inspection'));
