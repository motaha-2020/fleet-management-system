/** Owner (16 Nov 2026): four languages — standard Arabic, Tunisian, French, English. */
export type Locale = "ar" | "tn" | "fr" | "en";
/** Emails are formal: Tunisian readers get them in standard Arabic. */
export type MailLang = "ar" | "fr" | "en";
export const mailLang = (l: string | null | undefined): MailLang => (l === "fr" ? "fr" : l === "en" ? "en" : "ar");
/** The text for the reader's mail language. */
export const say = <T>(l: MailLang, t: Record<MailLang, T>): T => t[l];

/** A name in several languages: Tunisian falls back to Arabic, French to English. */
export function pickName(name: { ar: string; en: string; fr?: string; tn?: string }, l: string | null | undefined): string {
  if (l === "tn") return name.tn ?? name.ar;
  if (l === "fr") return name.fr ?? name.en;
  return l === "en" ? name.en : name.ar;
}
