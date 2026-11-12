import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Device from "expo-device";
import { ApiRequestError } from "@fleet/contracts";
import { session } from "../session";
import { colors, t } from "../theme";

export function ActivationScreen() {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
      await session.activate(username.trim(), code, Device.deviceName ?? Device.modelName ?? "Driver device", platform);
    } catch (e) {
      setError(e instanceof ApiRequestError ? (e.code === "account_locked" ? t.driverApp.locked : t.driverApp.invalid) : t.errors.network);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
      <View style={s.card}>
        <Text style={s.title} accessibilityRole="header">{t.driverApp.activateTitle}</Text>
        <Text style={s.help}>{t.driverApp.activateHelp}</Text>
        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <Text style={s.label}>{t.driverApp.username}</Text>
        <TextInput style={s.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}
          textContentType="username" accessibilityLabel={t.driverApp.username} testID="username" />
        <Text style={s.label}>{t.driverApp.code}</Text>
        <TextInput style={[s.input, s.code]} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false}
          textContentType="oneTimeCode" accessibilityLabel={t.driverApp.code} testID="code" />
        <Pressable style={({ pressed }) => [s.button, (busy || pressed) && { opacity: 0.8 }]} onPress={submit} disabled={busy || !username || !code}
          accessibilityRole="button" testID="activate">
          <Text style={s.buttonText}>{busy ? t.common.loading : t.driverApp.activate}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 20, gap: 8 },
  title: { fontSize: 22, fontWeight: "700", color: colors.ink },
  help: { fontSize: 14, color: colors.muted, lineHeight: 22, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink, marginTop: 8 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#CBD2D9", borderRadius: 10, paddingHorizontal: 12, fontSize: 16, color: colors.ink, backgroundColor: colors.surface },
  code: { letterSpacing: 4, fontSize: 20, fontWeight: "700", writingDirection: "ltr", textAlign: "center" },
  button: { marginTop: 16, minHeight: 48, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  error: { backgroundColor: colors.badBg, color: colors.bad, padding: 12, borderRadius: 8, fontWeight: "600" },
});
