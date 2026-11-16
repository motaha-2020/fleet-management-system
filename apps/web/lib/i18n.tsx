"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { messages, dir, isLocale, LOCALES, LOCALE_NAMES, type Locale, type Messages } from "@fleet/i18n";

type Ctx = { locale: Locale; t: Messages; setLocale: (l: Locale) => void; picked: number };
const Ctx = createContext<Ctx>({ locale: "ar", t: messages.ar, setLocale: () => {}, picked: 0 });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, set] = useState<Locale>("ar");
  /** Counts choices made in the picker, so the signed-in shell saves only real choices to the account. */
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fleet.locale");
      if (isLocale(saved)) set(saved);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === "tn" ? "ar-TN" : locale;
    document.documentElement.dir = dir(locale);
    try { localStorage.setItem("fleet.locale", locale); } catch {}
  }, [locale]);
  const value = useMemo(() => ({ locale, t: messages[locale], picked, setLocale: (l: Locale) => { set(l); setPicked((n) => n + 1); } }), [locale, picked]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

/** The four languages of the system (owner, 16 Nov 2026): Arabic, Tunisian, French, English. */
export function LanguagePicker() {
  const { t, locale, setLocale } = useI18n();
  return (
    <select
      aria-label={t.app.switchLang}
      className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
      value={locale}
      onChange={(e) => isLocale(e.target.value) && setLocale(e.target.value)}
    >
      {LOCALES.map((l) => <option key={l} value={l} lang={l === "tn" ? "ar-TN" : l}>{LOCALE_NAMES[l]}</option>)}
    </select>
  );
}
