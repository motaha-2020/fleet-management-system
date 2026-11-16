import { ar } from "./ar.js";
import { en } from "./en.js";
import { fr } from "./fr.js";
import { tn } from "./tn.js";

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<typeof ar>;
/** Owner (16 Nov 2026): the system runs in Tunisia — standard Arabic, Tunisian, French and English. */
export type Locale = "ar" | "tn" | "fr" | "en";
export const LOCALES: readonly Locale[] = ["ar", "tn", "fr", "en"];
/** Each language's name in itself, for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = { ar: "العربية", tn: "تونسي", fr: "Français", en: "English" };
export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export const messages: Record<Locale, Messages> = { ar, tn, fr, en };
export const isRtl = (l: Locale) => l === "ar" || l === "tn";
export const dir = (l: Locale) => (isRtl(l) ? "rtl" : "ltr");
/** Locale for dates and numbers (Latin digits, as used in Tunisia). */
export const intlLocale = (l: Locale) => (l === "fr" ? "fr-TN" : l === "en" ? "en-GB" : "ar-TN-u-nu-latn");

/** A name given in several languages (fuel types, documents, roles…). Only ar and en are required. */
export interface LocalizedName { ar: string; en: string; fr?: string; tn?: string }
/** The name in the user's language; Tunisian falls back to Arabic, French to English. */
export function pick(name: LocalizedName, locale: Locale): string;
export function pick(name: LocalizedName | null | undefined, locale: Locale): string | undefined;
export function pick(name: LocalizedName | null | undefined, locale: Locale): string | undefined {
  if (!name) return undefined;
  if (locale === "tn") return name.tn ?? name.ar;
  if (locale === "fr") return name.fr ?? name.en;
  return name[locale];
}

/** Map an API field error code (e.g. "duplicate:<id>:F-001") to a message. */
export function fieldError(m: Messages, code: string | undefined): string | undefined {
  if (!code) return undefined;
  const [key, , extra] = code.split(":");
  const msg = (m.errors as Record<string, string>)[key ?? ""];
  if (!msg) return code;
  return extra ? `${msg} (${extra})` : msg;
}

export { ar, en, fr, tn };
