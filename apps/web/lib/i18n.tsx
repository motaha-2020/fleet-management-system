"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { messages, dir, type Locale, type Messages } from "@fleet/i18n";

const Ctx = createContext<{ locale: Locale; t: Messages; setLocale: (l: Locale) => void }>({
  locale: "ar", t: messages.ar, setLocale: () => {},
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("ar");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fleet.locale");
      if (saved === "ar" || saved === "en") setLocale(saved);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir(locale);
    try { localStorage.setItem("fleet.locale", locale); } catch {}
  }, [locale]);
  const value = useMemo(() => ({ locale, t: messages[locale], setLocale }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
