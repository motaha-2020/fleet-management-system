-- Owner decision (14 Nov 2026): a fuel entry from the driver app carries where the phone was, so the office sees the
-- fuel station on a map. The same point goes on the odometer reading made by the entry. A refused or missing location
-- never blocks the entry; it is recorded as denied / unavailable.
ALTER TABLE fuel_entries
  ADD COLUMN latitude            numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),
  ADD COLUMN longitude           numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  ADD COLUMN location_accuracy_m integer CHECK (location_accuracy_m >= 0),
  ADD COLUMN location_status     text CHECK (location_status IN ('ok', 'denied', 'unavailable')),
  ADD CONSTRAINT fuel_entries_location_pair CHECK ((latitude IS NULL) = (longitude IS NULL));
CREATE INDEX fuel_entries_located_idx ON fuel_entries (event_at) WHERE latitude IS NOT NULL;
