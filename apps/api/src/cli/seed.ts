/**
 * Dev bootstrap: migrate the control plane and create (or reset) a platform admin.
 *   pnpm db:seed -- --email admin@example.com --password 'a-long-password'
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { controlDb, ensureControlDb, newId, schema } from "@fleet/db";
import { DEFAULTS } from "@fleet/config";
import { AuthService } from "../auth/auth.service.js";

const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: { email: { type: "string" }, password: { type: "string" }, name: { type: "string" } } });
const email = values.email?.toLowerCase();
const password = values.password;
if (!email || !password || password.length < DEFAULTS.PASSWORD_MIN_LENGTH) {
  console.error(`usage: seed --email <email> --password <at least ${DEFAULTS.PASSWORD_MIN_LENGTH} chars> [--name <name>]`);
  process.exit(2);
}
const controlUrl = process.env.CONTROL_DATABASE_URL!;
await ensureControlDb(process.env.DATABASE_ADMIN_URL!, controlUrl);
const { db, pool } = controlDb(controlUrl);
const passwordHash = await AuthService.hashPassword(password);
const [existing] = await db.select().from(schema.identities).where(eq(schema.identities.email, email));
if (existing) {
  await db.update(schema.identities).set({ passwordHash, isPlatformAdmin: true, failedAttempts: 0, lockedUntil: null }).where(eq(schema.identities.id, existing.id));
  console.log(`Updated platform admin ${email}`);
} else {
  await db.insert(schema.identities).values({ id: newId(), email, displayName: values.name ?? "Platform Admin", passwordHash, isPlatformAdmin: true });
  console.log(`Created platform admin ${email}`);
}
await pool.end();
