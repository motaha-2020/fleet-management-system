import { intlLocale, type Locale } from "@fleet/i18n";
import { fromMinorUnits } from "@fleet/config";
import { localDate } from "@fleet/domain";
import { companyCurrency, companyTimezone } from "./money";

/**
 * Today (plus n days) as the company sees it. `toISOString().slice(0, 10)` gave the UTC date: in Tunisia the
 * first hour after midnight still counted as yesterday, and the 1st of the month became the 31st.
 */
export const companyToday = (n = 0) => localDate(new Date(Date.now() + n * 86_400_000), companyTimezone());
export const companyMonthStart = () => `${companyToday().slice(0, 8)}01`;

export const fmtDate = (iso: string | null | undefined, locale: Locale) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(intlLocale(locale), { timeZone: iso.length === 10 ? "UTC" : undefined }) : "—";

export const fmtDateTime = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleString(intlLocale(locale), { dateStyle: "short", timeStyle: "short" });

/** Money is stored in minor units (Architecture §7): millimes for TND (3 decimals), piasters for EGP. */
export const fmtMoney = (minor: number | null | undefined, currency = companyCurrency(), locale: Locale = "ar") =>
  minor == null ? "—" : new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency }).format(fromMinorUnits(minor, currency));

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
