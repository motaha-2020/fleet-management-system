import { asc } from "drizzle-orm";
import { schema } from "@fleet/db";
import { localDate, policiesAt, type PolicyVersion } from "@fleet/domain";
import type { PolicyValues } from "@fleet/config";
import { companyOf, type DbOrTx } from "./common.js";

export async function policyVersions(db: DbOrTx): Promise<PolicyVersion[]> {
  const rows = await db.select().from(schema.companyPolicies).orderBy(asc(schema.companyPolicies.createdAt));
  return rows.map((r) => ({ key: r.key, value: r.value, effectiveFrom: r.effectiveFrom, createdAt: r.createdAt.getTime() }));
}

/** GEN-007: the thresholds in force at an event time (company local date). */
export async function policiesFor(db: DbOrTx, at: Date): Promise<PolicyValues> {
  const { company } = await companyOf(db);
  return policiesAt(await policyVersions(db), localDate(at, company.timezone));
}
