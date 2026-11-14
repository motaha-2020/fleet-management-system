-- Owner decision (14 Nov 2026): the company admin keeps the company profile up to date.
ALTER TABLE company
  ADD COLUMN logo_file_key        text,
  ADD COLUMN logo_mime            text CHECK (logo_mime IS NULL OR logo_mime IN ('image/png', 'image/jpeg')),
  ADD COLUMN address              text CHECK (address IS NULL OR length(address) <= 300),
  ADD COLUMN phone                text CHECK (phone IS NULL OR length(phone) <= 20),
  ADD COLUMN email                text CHECK (email IS NULL OR length(email) <= 254),
  ADD COLUMN commercial_register  text CHECK (commercial_register IS NULL OR length(commercial_register) <= 50),
  ADD COLUMN tax_number           text CHECK (tax_number IS NULL OR length(tax_number) <= 50),
  ADD COLUMN updated_at           timestamptz NOT NULL DEFAULT now();
