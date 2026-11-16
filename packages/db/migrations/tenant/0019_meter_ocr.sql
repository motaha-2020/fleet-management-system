-- Owner decision (14 Nov 2026): the driver app reads the number from the meter photo on the phone; the driver
-- confirms or corrects it. What the phone read is kept, so the approver sees "matches the photo" or "differs".
ALTER TABLE meter_readings ADD COLUMN ocr_value integer CHECK (ocr_value IS NULL OR ocr_value >= 0);
