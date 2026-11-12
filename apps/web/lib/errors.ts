import { ApiRequestError } from "@fleet/contracts";
import type { Messages } from "@fleet/i18n";

/** Localized banner text for an API error (the server's message is English, for logs). */
export function apiErrorMessage(t: Messages, err: unknown): string {
  if (!(err instanceof ApiRequestError)) return t.errors.network;
  if (err.status === 403) return t.errors.forbidden;
  const map: Record<string, string> = {
    validation_failed: t.errors.validation_failed,
    duplicate: t.errors.duplicate_record,
    username_taken: t.errors.username_taken,
    slug_taken: t.errors.slug_taken,
  };
  return map[err.code] ?? t.errors.generic;
}
