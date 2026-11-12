import { COUNTRY_TEMPLATES } from "@fleet/config";
import { schema } from "@fleet/db";
import { effectiveDocumentTypes, localDate } from "@fleet/domain";
import type { DbOrTx } from "../m2/common.js";

/** Effective document types for the tenant: country catalog + stricter company settings + custom types (GEN-008). */
export async function loadDocumentTypes(db: DbOrTx) {
  const [company] = await db.select().from(schema.company).limit(1);
  const country = COUNTRY_TEMPLATES[company?.countryCode ?? ""];
  if (!company || !country) throw new Error("tenant has no country template");
  const settings = await db.select().from(schema.documentTypeSettings);
  const custom = await db.select().from(schema.documentTypes);
  const types = effectiveDocumentTypes(
    country.documentTypes,
    settings.map((s) => ({ code: s.code, mandatory: s.mandatory, driverVisibility: s.driverVisibility })),
    custom.map((c) => ({
      code: c.code, entityType: c.entityType, name: { ar: c.nameAr, en: c.nameEn }, mandatory: c.mandatory, hasExpiry: c.hasExpiry,
      risk: c.risk, driverVisibility: c.sensitive ? "none" : c.driverVisibility, sensitive: c.sensitive, source: "company" as const, active: c.status === "active",
    })),
  );
  return { types, byCode: new Map(types.map((t) => [t.code, t])), today: localDate(new Date(), company.timezone), country, company };
}
