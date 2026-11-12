/** D-* defaults (PRD §3.2). Only the values M0 needs are defined so far. */
export const DEFAULTS = {
  /** Access token lifetime (Architecture §10). */
  ACCESS_TOKEN_TTL_SECONDS: 15 * 60,
  /** Refresh token absolute lifetime for web sessions. */
  WEB_REFRESH_TTL_SECONDS: 12 * 60 * 60,
  /** Refresh token lifetime for a bound driver device. */
  DEVICE_REFRESH_TTL_SECONDS: 30 * 24 * 60 * 60,
  /** D-SEC-LOCKOUT: 5 failed attempts lock for 15 minutes. */
  LOCKOUT_MAX_ATTEMPTS: 5,
  LOCKOUT_MINUTES: 15,
  /** SEC-005: activation code valid for 24h, single use. */
  ACTIVATION_CODE_TTL_HOURS: 24,
  ACTIVATION_CODE_LENGTH: 8,
  /** Minimum password length for web users (D-SEC-PWD). */
  PASSWORD_MIN_LENGTH: 12,
  /** D-SEC-WEBIDLE: a web session unused for 30 minutes must sign in again. */
  WEB_IDLE_MINUTES: 30,
  /** Short-lived token that carries a password-verified login to the MFA step. */
  MFA_CHALLENGE_TTL_SECONDS: 5 * 60,
  /** D-FILE-DOC: documents ≤ 10 MB, PDF/JPG/PNG. */
  FILE_DOC_MAX_BYTES: 10 * 1024 * 1024,
  FILE_DOC_MIME_TYPES: ["application/pdf", "image/jpeg", "image/png"] as readonly string[],
  /** D-DOC-LEAD: expiry reminders, in days before expiry. The first one marks a document "expiring". */
  DOC_LEAD_DAYS: [30, 14, 7] as readonly number[],
  /** D-DOC-GRACE */
  DOC_GRACE_DAYS: 0,
} as const;

/** Roles that must use MFA (SEC-004). */
export const MFA_REQUIRED_ROLES = ["platform_admin", "company_admin"] as const;
