import { Pressable, StyleSheet, Text, View } from "react-native";
import { LOCALES, LOCALE_NAMES } from "@fleet/i18n";
import { colors, language, locale, t } from "./theme";
import { session } from "./session";

/** The four languages (owner, 16 Nov 2026). A choice made while signed in is also saved to the account, for alerts. */
export function LanguageChips() {
  return (
    <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel={t.app.switchLang}>
      {LOCALES.map((l) => (
        <Pressable key={l} testID={`lang-${l}`} accessibilityRole="radio" accessibilityState={{ selected: l === locale }}
          style={[s.chip, l === locale && s.on]}
          onPress={() => {
            if (l === locale) return;
            language.set(l);
            void session.api.call("updateAccount", { body: { locale: l } }).catch(() => {});
          }}>
          <Text style={[s.text, l === locale && s.onText]}>{LOCALE_NAMES[l]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", paddingVertical: 6 },
  chip: { minHeight: 36, paddingHorizontal: 12, justifyContent: "center", borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { fontSize: 14, color: colors.ink, fontWeight: "600" },
  onText: { color: "#FFFFFF" },
});
