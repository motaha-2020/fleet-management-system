-- SEC-007 / US-E02-06: break-glass support access. A platform admin asks; a company admin decides;
-- an approved grant gives read-only access for D-SEC-BREAKGLASS (24 h) and every view is audited in the tenant.
CREATE TABLE break_glass_grants (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  requested_by  uuid NOT NULL REFERENCES identities(id),
  reason        text NOT NULL CHECK (length(reason) >= 10),
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','revoked')),
  decided_by    uuid REFERENCES identities(id),
  decided_at    timestamptz,
  expires_at    timestamptz,
  revoked_by    uuid,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'approved') <= (expires_at IS NOT NULL))
);
CREATE INDEX break_glass_tenant_idx ON break_glass_grants (tenant_id, created_at DESC);
