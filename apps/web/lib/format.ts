import type { Locale } from "@fleet/i18n";

export const fmtDate = (iso: string | null | undefined, locale: Locale) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { timeZone: iso.length === 10 ? "UTC" : undefined }) : "—";

export const fmtDateTime = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "short", timeStyle: "short" });

/** EGP stored in piasters (minor units) — Architecture §7 "Money". */
export const fmtMoney = (minor: number | null | undefined, currency = "EGP", locale: Locale = "ar") =>
  minor == null ? "—" : new Intl.NumberFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { style: "currency", currency }).format(minor / 100);

export async function saveDownload(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const name = m ? decodeURIComponent(m[1]!) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
