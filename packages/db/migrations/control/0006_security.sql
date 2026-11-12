-- M6 security baseline: MFA recovery codes (single use, stored as SHA-256 of a high-entropy code).
ALTER TABLE identities ADD COLUMN mfa_recovery_codes text[] NOT NULL DEFAULT '{}';
