import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Vehicle } from "@fleet/contracts";
import { GrantExpiredError, store } from "../store";
import { sync } from "../sync";
import { colors, t } from "../theme";

/**
 * ODO-001 offline (E14): the driver records the odometer of an assigned vehicle. Saved to the outbox and
 * sent as odometer.record; the server checks the assignment at the time of the reading.
 */
export function OdometerScreen({ vehicle, last, onDone }: { vehicle: Vehicle; last: { value: number; at: string } | null; onDone: (msg?: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const odo = parseInt(value, 10);
    if (!/^\d{1,7}$/.test(value) || !(odo >= 0)) return setError(t.driverApp.invalidNumber);
    setBusy(true);
    try {
      await store.enqueue("odometer.record", { vehicleId: vehicle.id, odometer: odo }, `${vehicle.fleetNumber} · ${odo.toLocaleString("en")}`);
      void sync.kick();
      onDone(t.driverApp.saved);
    } catch (e) {
      setError(e instanceof GrantExpiredError ? t.driverApp.grantExpired : t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={s.header}>
        <Pressable onPress={() => onDone()} accessibilityRole="button"><Text style={s.back}>{t.driverApp.back}</Text></Pressable>
        <Text style={s.title}>{t.driverApp.recordOdometer} · {vehicle.fleetNumber}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {last && (
          <Text style={s.muted}>
            {t.driverApp.lastOdometer}: <Text style={s.strong}>{last.value.toLocaleString("en")}</Text>
          </Text>
        )}
        <View>
          <Text style={s.label}>{t.driverApp.odometer}</Text>
          <TextInput style={s.input} keyboardType="number-pad" value={value} onChangeText={setValue} testID="odometer-value" accessibilityLabel={t.driverApp.odometer} autoFocus />
        </View>
        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <Pressable style={[s.button, busy && { opacity: 0.7 }]} onPress={submit} disabled={busy} accessibilityRole="button" testID="submit-odometer">
          <Text style={s.buttonText}>{busy ? t.common.loading : t.driverApp.submit}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.line },
  back: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink, flex: 1 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink, marginBottom: 6 },
  muted: { fontSize: 14, color: colors.muted },
  strong: { fontWeight: "700", color: colors.ink },
  input: { minHeight: 52, borderWidth: 1, borderColor: "#CBD2D9", borderRadius: 10, paddingHorizontal: 12, fontSize: 20, color: colors.ink, backgroundColor: colors.surface, writingDirection: "ltr", textAlign: "center" },
  button: { minHeight: 52, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  error: { backgroundColor: colors.badBg, color: colors.bad, padding: 12, borderRadius: 8, fontWeight: "600" },
});
