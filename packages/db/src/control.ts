import pg from "pg";
import { migrate } from "./migrate.js";
import { assertIdent, q } from "./ident.js";

/** Create the control plane database if missing, then migrate it. */
export async function ensureControlDb(adminUrl: string, controlUrl: string) {
  const name = assertIdent(new URL(controlUrl).pathname.slice(1));
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const r = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
    if (!r.rowCount) await admin.query(`CREATE DATABASE ${q(name)}`);
  } finally {
    await admin.end();
  }
  const c = new pg.Client({ connectionString: controlUrl });
  await c.connect();
  try {
    return await migrate(c, "control");
  } finally {
    await c.end();
  }
}
