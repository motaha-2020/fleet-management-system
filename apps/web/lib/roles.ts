import type { Role } from "@fleet/config";
import { pick, type Locale, type Messages } from "@fleet/i18n";

/** A role's name as people see it: the company's own name for a custom role, else the built-in label. */
export function roleLabel(t: Messages, locale: Locale, role: Role, roleName?: { ar: string; en: string } | null): string {
  return roleName ? pick(roleName, locale) : t.roles[role];
}
