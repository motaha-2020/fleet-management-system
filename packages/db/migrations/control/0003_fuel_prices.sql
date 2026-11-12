-- FUEL-017: official fuel prices per country, effective-dated, maintained by the platform admin.
-- Rows are never edited: a new price is a new row with a later effective date.
CREATE TABLE fuel_prices (
  id              uuid PRIMARY KEY,
  country_code    char(2) NOT NULL,
  fuel_type       text NOT NULL,
  price_minor     int NOT NULL CHECK (price_minor > 0),   -- per litre / m³, in minor units
  currency        char(3) NOT NULL,
  effective_from  timestamptz NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, fuel_type, effective_from)
);
CREATE TRIGGER fuel_prices_append_only BEFORE UPDATE OR DELETE ON fuel_prices FOR EACH ROW EXECUTE FUNCTION forbid_change();
