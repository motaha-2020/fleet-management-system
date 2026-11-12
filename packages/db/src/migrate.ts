import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { q } from "./ident.js";

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export interface Migration { version: number; name: string; sql: string }

export function loadMigrations(kind: "control" | "tenant"): Migration[] {
  const dir = join(MIGRATIONS_DIR, kind);
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: Number(f.slice(0, 4)), name: f, sql: readFileSync(join(dir, f), "utf8") }));
}

export const latestVersion = (kind: "control" | "tenant") => Math.max(0, ...loadMigrations(kind).map((m) => m.version));

/**
 * Apply pending migrations, each in its own transaction, under an advisory lock.
 * A failing migration rolls back and leaves the DB at the previous version (TEN-006).
 */
export async function migrate(client: pg.ClientBase, kind: "control" | "tenant"): Promise<{ from: number; to: number }> {
  await client.query("SELECT pg_advisory_lock(727274)");
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ v: number | null }>("SELECT max(version) AS v FROM schema_migrations");
    const from = rows[0]?.v ?? 0;
    let to = from;
    for (const m of loadMigrations(kind)) {
      if (m.version <= from) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [m.version, m.name]);
        await client.query("COMMIT");
        to = m.version;
      } catch (e) {
        await client.query("ROLLBACK");
        throw new MigrationError(m, from, to, e);
      }
    }
    return { from, to };
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)");
  }
}

export class MigrationError extends Error {
  constructor(public readonly migration: Migration, public readonly from: number, public readonly reachedVersion: number, cause: unknown) {
    super(`migration ${migration.name} failed: ${(cause as Error)?.message ?? cause}`, { cause });
  }
}

/** Grants for the tenant application role, re-applied after each migration. */
export async function applyTenantGrants(client: pg.ClientBase, appRole: string) {
  const sql = readFileSync(join(MIGRATIONS_DIR, "tenant", "grants.sql"), "utf8").replaceAll(":app_role", q(appRole));
  await client.query(sql);
}
