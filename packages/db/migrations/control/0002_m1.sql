-- M1: MFA (US-E02-01), per-tenant data keys for field-level encryption (DRV-007, TEN-003).
ALTER TABLE identities
  ADD COLUMN mfa_secret_enc          text,
  ADD COLUMN mfa_pending_secret_enc  text,
  ADD COLUMN mfa_enabled_at          timestamptz,
  ADD COLUMN mfa_last_step           bigint;

-- Data key per tenant, sealed with the platform master key (envelope encryption).
CREATE TABLE tenant_keys (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id),
  data_key_enc  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE memberships ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invites ADD COLUMN tenant_id uuid REFERENCES tenants(id);
