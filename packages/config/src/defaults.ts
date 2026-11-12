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
  /** D-ODO-MAXDAY: km per day above which a reading is a Warning. */
  ODO_MAX_KM_PER_DAY: 1500,
  /** D-ODO-CORROB: two readings within ±2 km and 10 minutes corroborate each other. */
  ODO_CORROB_KM: 2,
  ODO_CORROB_MINUTES: 10,
  /** D-FUEL-TANKTOL: quantity may exceed tank capacity by 5% before it is a Conflict. */
  FUEL_TANK_TOLERANCE: 0.05,
  /** D-FUEL-PRICETOL: unit price ±20% of reference; ±2% when the country has an official price (FUEL-017). */
  FUEL_PRICE_TOLERANCE: 0.2,
  FUEL_OFFICIAL_PRICE_TOLERANCE: 0.02,
  /** D-FUEL-DUPWIN: same vehicle + amount + quantity within 30 minutes = possible duplicate. */
  FUEL_DUPLICATE_WINDOW_MINUTES: 30,
  /** Event times may be at most this far in the future (device clock skew). */
  MAX_FUTURE_SKEW_MINUTES: 5,
  /** D-OFF-GRANT (OFF-002): an Offline Grant allows new offline actions for 72 hours after it is issued. */
  OFFLINE_GRANT_HOURS: 72,
  /** D-OFF-DRIFT (OFF-006): device time this far from the estimated true time is flagged clock_drift. */
  SYNC_CLOCK_DRIFT_MINUTES: 5,
  /** Events per /sync/events request. */
  SYNC_MAX_BATCH: 50,
  /** An event waiting for an earlier device_seq goes to the conflict queue after this long. */
  SYNC_HOLD_MAX_DAYS: 7,
} as const;

/** Roles that must use MFA (SEC-004). */
export const MFA_REQUIRED_ROLES = ["platform_admin", "company_admin"] as const;
