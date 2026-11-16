-- Owner decision (14 Nov 2026): companies make their own roles, and the viewer role is gone.
-- A membership with role 'custom' points at a role in the company database (role_id). A person may hold several
-- roles in one company, each with its own branches; they switch between them (SEC-002).

-- Viewer memberships existed only on test data: end their sessions and remove them.
UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL AND membership_id IN (SELECT id FROM memberships WHERE role = 'viewer');
UPDATE refresh_tokens SET membership_id = NULL WHERE membership_id IN (SELECT id FROM memberships WHERE role = 'viewer');
DELETE FROM memberships WHERE role = 'viewer';

ALTER TABLE memberships ADD COLUMN role_id uuid;
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('company_admin', 'fleet_manager', 'finance_reviewer', 'driver', 'custom'));
ALTER TABLE memberships ADD CONSTRAINT memberships_custom_role_id CHECK ((role = 'custom') = (role_id IS NOT NULL));

ALTER TABLE memberships DROP CONSTRAINT memberships_identity_id_tenant_id_role_key;
CREATE UNIQUE INDEX memberships_builtin_role_key ON memberships (identity_id, tenant_id, role) WHERE role <> 'custom';
CREATE UNIQUE INDEX memberships_custom_role_key ON memberships (identity_id, tenant_id, role_id) WHERE role = 'custom';
CREATE INDEX memberships_role_id_idx ON memberships (tenant_id, role_id) WHERE role_id IS NOT NULL;
