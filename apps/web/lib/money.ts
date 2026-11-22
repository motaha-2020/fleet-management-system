import { COUNTRY_TEMPLATES, DEFAULT_COUNTRY, fromMinorUnits, toMinorUnits, CURRENCY_MINOR_UNITS } from "@fleet/config";

/**
 * The signed-in company's currency. One company = one country = one currency, so the session sets it once
 * and every amount on the page is converted with it (TND has 3 decimals, EGP 2).
 */
let current = COUNTRY_TEMPLATES[DEFAULT_COUNTRY]!.currency;
let zone = COUNTRY_TEMPLATES[DEFAULT_COUNTRY]!.timezone;

export function setCompanyCountry(countryCode: string | null | undefined) {
  const c = countryCode ? COUNTRY_TEMPLATES[countryCode] : undefined;
  if (c) { current = c.currency; zone = c.timezone; }
}
export const companyCurrency = () => current;
/** The company's timezone (Tunisia: Africa/Tunis), for "today" and month starts. */
export const companyTimezone = () => zone;
export const currencyDecimals = (currency = current) => CURRENCY_MINOR_UNITS[currency] ?? 2;
/** Input step for an amount field: 0.001 for TND, 0.01 for EGP. */
export const amountStep = (currency = current) => (1 / 10 ** currencyDecimals(currency)).toFixed(currencyDecimals(currency));
/** "12.5" → 12500 millimes (TND). */
export const toMinor = (s: string, currency = current) => toMinorUnits(Number(s), currency);
/** 12500 millimes → "12.500". */
export const fromMinor = (n: number, currency = current) => fromMinorUnits(n, currency).toFixed(currencyDecimals(currency));
