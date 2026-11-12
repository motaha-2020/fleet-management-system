-- NFR-008 / US-E19-02: operational failures per tenant (sync, notifications, import, jobs, API errors,
-- backups, security), queryable within seconds of happening. Append-only; old rows are pruned by retention.
CREATE TABLE ops_events (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  tenant_id  uuid,
  kind       text NOT NULL CHECK (kind IN ('sync','notification','import','job','api_error','backup','security')),
  severity   text NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  code       text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ops_events_at_idx ON ops_events (at DESC);
CREATE INDEX ops_events_tenant_idx ON ops_events (tenant_id, at DESC);
