import { ApiRequestError } from "@fleet/contracts";
import type { Messages } from "@fleet/i18n";

/** Localized banner text for an API error (the server's message is English, for logs). */
export function apiErrorMessage(t: Messages, err: unknown): string {
  if (!(err instanceof ApiRequestError)) return t.errors.network;
  const errors = t.errors as Record<string, string>;
  if (errors[err.code]) return errors[err.code]!;
  if (err.code === "duplicate") return t.errors.duplicate_record;
  if (err.status === 403) return t.errors.forbidden;
  return t.errors.generic;
}
