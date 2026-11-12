-- Control Plane DB (Architecture §6.1): routing, identity, platform audit. No tenant operational data here.
CREATE TABLE tenants (
  id              uuid PRIMARY KEY,
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$'),
  name            text NOT NULL,
  country_code    char(2) NOT NULL,
  home_region     text NOT NULL DEFAULT 'eu-central',
  status          text NOT NULL CHECK (status IN ('provisioning','active','suspended','failed','terminated')),
  failure_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_db_locations (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id),
  host             text NOT NULL,
  port             int  NOT NULL,
  db_name          text NOT NULL UNIQUE,
  db_role          text NOT NULL UNIQUE,
  db_password_enc  text NOT NULL,
  schema_version   int
);

CREATE TABLE provisioning_steps (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  step        text NOT NULL,
  status      text NOT NULL CHECK (status IN ('done','failed')),
  detail      text,
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, step)
);

CREATE TABLE tenant_migrations (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  version     int  NOT NULL,
  status      text NOT NULL CHECK (status IN ('success','failed')),
  error       text,
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, version)
);

-- One identity per person on the platform (SEC-008); access comes from memberships.
CREATE TABLE identities (
  id                  uuid PRIMARY KEY,
  email               text UNIQUE CHECK (email = lower(email)),
  username            text UNIQUE CHECK (username = lower(username)),
  display_name        text NOT NULL,
  password_hash       text,
  is_platform_admin   boolean NOT NULL DEFAULT false,
  failed_attempts     int NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  disabled_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR username IS NOT NULL)
);

CREATE TABLE memberships (
  id           uuid PRIMARY KEY,
  identity_id  uuid NOT NULL REFERENCES identities(id),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  role         text NOT NULL CHECK (role IN ('company_admin','fleet_manager','finance_reviewer','driver','viewer')),
  branch_ids   uuid[] NOT NULL DEFAULT '{}',
  driver_id    uuid,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_id, tenant_id, role),
  CHECK ((role = 'driver') = (driver_id IS NOT NULL))
);
CREATE INDEX memberships_tenant_idx ON memberships (tenant_id);

CREATE TABLE invites (
  id           uuid PRIMARY KEY,
  identity_id  uuid NOT NULL REFERENCES identities(id),
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id           uuid PRIMARY KEY,
  identity_id  uuid NOT NULL REFERENCES identities(id),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  name         text NOT NULL,
  platform     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
-- At most one active device per driver identity (SEC-005: new code revokes old device).
CREATE UNIQUE INDEX devices_one_active ON devices (identity_id, tenant_id) WHERE revoked_at IS NULL;

CREATE TABLE activation_codes (
  id           uuid PRIMARY KEY,
  identity_id  uuid NOT NULL REFERENCES identities(id),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  revoked_at   timestamptz,
  created_by   uuid NOT NULL REFERENCES identities(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activation_codes_identity_idx ON activation_codes (identity_id) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE refresh_tokens (
  id             uuid PRIMARY KEY,
  identity_id    uuid NOT NULL REFERENCES identities(id),
  membership_id  uuid REFERENCES memberships(id),
  device_id      uuid REFERENCES devices(id),
  family_id      uuid NOT NULL,
  token_hash     text NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  replaced_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE platform_audit (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid,
  tenant_id    uuid,
  action       text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}'
);
-- Append-only even for the table owner's application code path.
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER platform_audit_append_only BEFORE UPDATE OR DELETE ON platform_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
