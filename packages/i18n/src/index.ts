import { ar } from "./ar.js";
import { en } from "./en.js";

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<typeof ar>;
export type Locale = "ar" | "en";

export const messages: Record<Locale, Messages> = { ar, en };
export const dir = (l: Locale) => (l === "ar" ? "rtl" : "ltr");

/** Map an API field error code (e.g. "duplicate:<id>:F-001") to a message. */
export function fieldError(m: Messages, code: string | undefined): string | undefined {
  if (!code) return undefined;
  const [key, , extra] = code.split(":");
  const msg = (m.errors as Record<string, string>)[key ?? ""];
  if (!msg) return code;
  return extra ? `${msg} (${extra})` : msg;
}

export { ar, en };
