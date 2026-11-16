-- Owner decision (14 Nov 2026): a driver may use the phone app and the driver web version at the same time.
-- One active phone and one active browser per driver per company (was: one active device).
DROP INDEX devices_one_active;
CREATE UNIQUE INDEX devices_one_active ON devices (identity_id, tenant_id, (platform = 'web')) WHERE revoked_at IS NULL;
