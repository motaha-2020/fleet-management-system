-- Owner decision (16 Nov 2026): the company admin enters the official fuel price; fuel entries are compared
-- against it. Effective-dated and append-only: a new price is a new row, past entries keep their evaluation.
CREATE TABLE company_fuel_prices (
  id              uuid PRIMARY KEY,
  fuel_type       text NOT NULL,
  price_minor     int NOT NULL CHECK (price_minor > 0),   -- per litre / m³, in minor units, tax included
  effective_from  timestamptz NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fuel_type, effective_from)
);
