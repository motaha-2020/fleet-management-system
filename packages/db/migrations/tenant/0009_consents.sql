-- PRV-002 / US-E19-04: the driver's in-app decision on each device permission, with when and on which device.
CREATE TABLE consents (
  id           uuid PRIMARY KEY,
  identity_id  uuid NOT NULL,
  driver_id    uuid REFERENCES drivers(id),
  device_id    uuid,
  kind         text NOT NULL CHECK (kind IN ('camera','photos','location')),
  decision     text NOT NULL CHECK (decision IN ('granted','denied')),
  app_version  text,
  decided_at   timestamptz NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_identity_idx ON consents (identity_id, kind, decided_at DESC);
