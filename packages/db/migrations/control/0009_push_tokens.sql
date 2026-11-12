-- NTF-001: the driver app's Expo push token, per activated device (a new device / reinstall replaces it).
ALTER TABLE devices ADD COLUMN push_token text;
ALTER TABLE devices ADD COLUMN push_token_at timestamptz;
CREATE INDEX devices_push_token_idx ON devices (push_token) WHERE push_token IS NOT NULL;
