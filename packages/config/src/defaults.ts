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
} as const;
