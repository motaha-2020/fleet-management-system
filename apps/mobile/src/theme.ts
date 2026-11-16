import { intlLocale, isLocale, isRtl, messages, type Locale, type Messages } from "@fleet/i18n";
import { keystore } from "./keystore";

/** Same tokens as the web dashboard / prototype. */
export const colors = {
  bg: "#F4F6F8", surface: "#FFFFFF", ink: "#14202B", muted: "#4B5563", line: "#E2E6EA",
  accent: "#0F5FA8", accentInk: "#0B4A84", accentSoft: "#E8F1FB", ok: "#05603A", okBg: "#E7F5EE", bad: "#A01B12", badBg: "#FDECEC",
};
/**
 * The driver's language (owner, 16 Nov 2026: Arabic, Tunisian, French, English), kept on the phone.
 * Screens read `t` while rendering; App re-renders everything when the language changes.
 */
export let locale: Locale = "ar";
export let t: Messages = messages.ar;
/** Layout direction and date format of the current language. */
export const rtl = () => isRtl(locale);
export const dateLocale = () => intlLocale(locale);
const KEY = "fleet.locale";
const listeners = new Set<(l: Locale) => void>();
export const language = {
  async load() {
    const saved = await keystore.get(KEY).catch(() => null);
    if (isLocale(saved)) { locale = saved; t = messages[saved]; }
  },
  set(l: Locale) {
    locale = l; t = messages[l];
    void keystore.set(KEY, l).catch(() => {});
    listeners.forEach((f) => f(l));
  },
  subscribe(f: (l: Locale) => void) { listeners.add(f); return () => { listeners.delete(f); }; },
};
