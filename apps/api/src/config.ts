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
