/** D-* defaults (PRD §3.2). Only the values M0 needs are defined so far. */
export const DEFAULTS = {
  /** Access token lifetime (Architecture §10). */
  ACCESS_TOKEN_TTL_SECONDS: 15 * 60,
  /** Web session without "keep me signed in": ends 24 hours after sign-in (owner decision, 13 Nov 2026). */
  WEB_REFRESH_TTL_SECONDS: 24 * 60 * 60,
  /** "Keep me signed in": the web session renews for 30 days on every use. */
  WEB_REMEMBER_TTL_SECONDS: 30 * 24 * 60 * 60,
  /** A browser that passed the email code is trusted (no code) for this many days. */
  TRUSTED_DEVICE_DAYS: 30,
  /** Email sign-in code: 6 digits, valid 10 minutes, 5 tries; a new one at most once a minute. */
  LOGIN_CODE_TTL_MINUTES: 10,
  LOGIN_CODE_MAX_ATTEMPTS: 5,
  LOGIN_CODE_RESEND_SECONDS: 60,
  /** Password reset links: 1 hour by email, 24 hours when an admin makes one. */
  PASSWORD_RESET_TTL_MINUTES: 60,
  PASSWORD_RESET_ADMIN_TTL_HOURS: 24,
  /** A device retrying with the refresh token it just rotated (lost reply) within this window is not theft. */
  REFRESH_REUSE_GRACE_SECONDS: 120,
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
  /** Short-lived token that carries a password-verified login to the email-code step. */
  MFA_CHALLENGE_TTL_SECONDS: 10 * 60,
  /** D-FILE-DOC: documents ≤ 10 MB, PDF/JPG/PNG. */
  FILE_DOC_MAX_BYTES: 10 * 1024 * 1024,
  FILE_DOC_MIME_TYPES: ["application/pdf", "image/jpeg", "image/png"] as readonly string[],
  /** D-DOC-LEAD: expiry reminders, in days before expiry. The first one marks a document "expiring". */
  DOC_LEAD_DAYS: [30, 14, 7] as readonly number[],
  /** D-DOC-GRACE */
  DOC_GRACE_DAYS: 0,
  /** D-MNT-UPCOMING: an item is Upcoming within 500 km or 14 days of its due point. */
  MNT_UPCOMING_KM: 500,
  MNT_UPCOMING_DAYS: 14,
  /** Recent movement used to forecast a distance-based due date (MNT-005). */
  MNT_FORECAST_WINDOW_DAYS: 30,
  /** OPS-005: overrides must expire; the longest allowed. */
  READINESS_OVERRIDE_MAX_DAYS: 30,
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
  /** OFF-008: photos are compressed on the device to at most 500 KB and uploaded in chunks of at most 64 KB. */
  PHOTO_MAX_BYTES: 512_000,
  UPLOAD_CHUNK_MAX_BYTES: 65_536,
  /** D-BUD-THRESH (FUEL-015): fuel budget alerts at 80% and 100% of the monthly budget. */
  BUDGET_THRESHOLDS: [80, 100] as readonly number[],
  /** Daily alert scan, local time of the platform (UTC). */
  ALERT_SCAN_CRON: "15 3 * * *",
  /** Attempts to deliver one notification before it is marked failed (NTF-003). */
  NOTIFY_MAX_ATTEMPTS: 3,
  /** INC-005: unpaid fines are flagged when the vehicle license expires within this many days. */
  FINE_RENEWAL_LEAD_DAYS: 30,
  /** D-SEC-BREAKGLASS: approved support access lasts 24 hours, read-only. */
  BREAK_GLASS_HOURS: 24,
} as const;

