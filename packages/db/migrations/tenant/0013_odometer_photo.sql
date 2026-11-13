-- Owner decision (13 Nov 2026): every odometer reading from the driver app carries a photo of the meter, the time
-- it was taken and, when the phone allows it, the location. A denied or unavailable location does not block the
-- reading; it is recorded as such. The photo arrives after the reading through the resumable upload.
ALTER TABLE meter_readings
  ADD COLUMN photo_file_key      text,
  ADD COLUMN photo_mime          text,
  ADD COLUMN photo_taken_at      timestamptz,
  ADD COLUMN latitude            numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),
  ADD COLUMN longitude           numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  ADD COLUMN location_accuracy_m integer CHECK (location_accuracy_m >= 0),
  ADD COLUMN location_status     text CHECK (location_status IN ('ok', 'denied', 'unavailable')),
  ADD CONSTRAINT meter_readings_location_pair CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE uploads DROP CONSTRAINT uploads_record_type_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_record_type_check CHECK (record_type IN ('fuel_receipt', 'defect_photo', 'odometer_photo'));
