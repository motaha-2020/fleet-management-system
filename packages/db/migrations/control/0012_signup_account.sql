-- Owner decisions (14 Nov 2026):
--  * A company admin signs up on their own; the company works at once (no approval, no plans).
--  * Everyone has "My account" (name, phone, job title, password).
--  * An admin can give a temporary password; the person must choose a new one right after signing in with it.

ALTER TABLE identities
  ADD COLUMN phone                 text CHECK (phone IS NULL OR length(phone) <= 20),
  ADD COLUMN job_title             text CHECK (job_title IS NULL OR length(job_title) <= 100),
  ADD COLUMN must_change_password  boolean NOT NULL DEFAULT false;

-- One sign-up attempt: the email gets a 6-digit code; once it is entered the company is created and provisioned,
-- then the browser picks up the session (finished_at) when the company database is ready.
CREATE TABLE signup_requests (
  id             uuid PRIMARY KEY,
  token_hash     text NOT NULL UNIQUE,
  email          text NOT NULL,
  company_name   text NOT NULL,
  country_code   char(2) NOT NULL,
  admin_name     text NOT NULL,
  locale         text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  code_hash      text,
  attempts       int NOT NULL DEFAULT 0,
  ip             text,
  expires_at     timestamptz NOT NULL,
  verified_at    timestamptz,
  tenant_id      uuid REFERENCES tenants(id),
  identity_id    uuid REFERENCES identities(id),
  membership_id  uuid REFERENCES memberships(id),
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signup_requests_email_idx ON signup_requests (email, created_at DESC);
CREATE INDEX signup_requests_ip_idx ON signup_requests (ip, created_at DESC);
