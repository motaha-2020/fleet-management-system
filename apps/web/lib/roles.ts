import type { Messages } from "@fleet/i18n";
import type { Role } from "@fleet/config";

/** A role's name as people see it: the company's own name for a custom role, else the built-in label. */
export function roleLabel(t: Messages, locale: "ar" | "en", role: Role, roleName?: { ar: string; en: string } | null): string {
  return roleName ? roleName[locale] : t.roles[role];
}
