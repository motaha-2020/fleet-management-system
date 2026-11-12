export interface AppConfig {
  controlDatabaseUrl: string;
  adminDatabaseUrl: string;
  tenantDbHost: string;
  tenantDbPort: number;
  masterKey: string;
  jwtPrivateKeyPem: string;
  port: number;
  /** Browser origins allowed by CORS (web dashboard; Expo web in development). */
  corsOrigins: string[];
  secureCookies: boolean;
  /** NTF-001: SMTP URL for alert emails; without it emails are logged (development). */
  mail: { smtpUrl: string | null; from: string };
  /** Public URL of the web dashboard (links in emails). */
  webUrl: string;
  /** Requests per minute per client IP (SEC baseline): sign-in endpoints and everything else. */
  rateLimit: { authPerMinute: number; generalPerMinute: number };
  /** D-SEC-PWD: check new passwords against the breached-password corpus (k-anonymity, HIBP). */
  breachedPasswordCheck: boolean;
  /** NTF-001 push: "expo" sends through the Expo Push Service; "log" only logs (development). */
  push: { driver: "expo" | "log"; accessToken: string | null };
  storage:
    | { driver: "fs"; dir: string }
    | { driver: "s3"; endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
}

const req = (env: NodeJS.ProcessEnv, k: string) => {
  const v = env[k];
  if (!v) throw new Error(`Missing required environment variable ${k} (see .env.example)`);
  return v;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    controlDatabaseUrl: req(env, "CONTROL_DATABASE_URL"),
    adminDatabaseUrl: req(env, "DATABASE_ADMIN_URL"),
    tenantDbHost: env.TENANT_DB_HOST ?? "localhost",
    tenantDbPort: Number(env.TENANT_DB_PORT ?? 5432),
    masterKey: req(env, "MASTER_KEY"),
    jwtPrivateKeyPem: Buffer.from(req(env, "JWT_PRIVATE_KEY_B64"), "base64").toString("utf8"),
    port: Number(env.API_PORT ?? 4000),
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
    secureCookies: env.NODE_ENV === "production",
    mail: { smtpUrl: env.SMTP_URL || null, from: env.MAIL_FROM ?? "Fleet <no-reply@fleet.local>" },
    webUrl: (env.WEB_URL ?? env.CORS_ORIGINS?.split(",")[0] ?? "http://localhost:3000").replace(/\/$/, ""),
    rateLimit: { authPerMinute: Number(env.RATE_LIMIT_AUTH_PER_MIN ?? 20), generalPerMinute: Number(env.RATE_LIMIT_PER_MIN ?? 600) },
    push: { driver: (env.PUSH_DRIVER ?? (env.NODE_ENV === "production" ? "expo" : "log")) === "expo" ? "expo" : "log", accessToken: env.EXPO_ACCESS_TOKEN || null },
    breachedPasswordCheck: (env.BREACHED_PASSWORD_CHECK ?? (env.NODE_ENV === "production" ? "on" : "off")) === "on",
    storage: env.STORAGE_DRIVER === "s3"
      ? {
          driver: "s3",
          endpoint: req(env, "S3_ENDPOINT"),
          region: env.S3_REGION ?? "eu-central",
          bucket: req(env, "S3_BUCKET"),
          accessKeyId: req(env, "S3_ACCESS_KEY_ID"),
          secretAccessKey: req(env, "S3_SECRET_ACCESS_KEY"),
        }
      : { driver: "fs", dir: env.STORAGE_DIR ?? ".data/files" },
  };
}
