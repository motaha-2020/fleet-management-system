-- Owner decision (13 Nov 2026): simpler sign-in. The authenticator app (TOTP) is replaced by a code sent by
-- email when signing in from a browser that is not trusted yet; "keep me signed in"; password reset by email
-- or by an admin link; the sender email is set inside the platform. The old MFA columns stay (unused).

-- One-time sign-in codes (6 digits, hashed), sent by email. A new code replaces the open ones.
CREATE TABLE login_codes (
  id            uuid PRIMARY KEY,
  identity_id   uuid NOT NULL REFERENCES identities(id),
  membership_id uuid,
  code_hash     text NOT NULL,
  remember      boolean NOT NULL DEFAULT false,
  attempts      int NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_codes_identity_idx ON login_codes (identity_id, created_at DESC);

-- A browser that passed the email code: no code again on it until it expires (HttpOnly cookie, hashed here).
CREATE TABLE trusted_devices (
  id            uuid PRIMARY KEY,
  identity_id   uuid NOT NULL REFERENCES identities(id),
  token_hash    text NOT NULL UNIQUE,
  user_agent    text,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trusted_devices_identity_idx ON trusted_devices (identity_id);

-- Password reset links: by email ("forgot password") or made by an admin (created_by).
CREATE TABLE password_resets (
  id            uuid PRIMARY KEY,
  identity_id   uuid NOT NULL REFERENCES identities(id),
  token_hash    text NOT NULL UNIQUE,
  created_by    uuid,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- "Keep me signed in": the web session renews for 30 days on every use instead of ending after 24 hours.
ALTER TABLE refresh_tokens ADD COLUMN persistent boolean NOT NULL DEFAULT false;

-- Outgoing email, set by the platform admin in the site. Without a row, SMTP_URL from the environment is used.
CREATE TABLE mail_settings (
  id            int PRIMARY KEY CHECK (id = 1),
  host          text NOT NULL,
  port          int NOT NULL CHECK (port BETWEEN 1 AND 65535),
  secure        boolean NOT NULL,
  username      text,
  password_enc  text,
  from_address  text NOT NULL,
  from_name     text,
  updated_by    uuid NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
