import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { INSPECTION_ITEMS } from "@fleet/config";
import type { Vehicle } from "@fleet/contracts";
import { GrantExpiredError, store } from "../store";
import { sync } from "../sync";
import { colors, t } from "../theme";
import { s } from "./MeterCapture";

/**
 * Owner decision (14 Nov 2026): the driver inspects the vehicle with the checklist (OK / problem + note). Works offline
 * (inspection.create in the outbox); it counts once approved, and failed critical items alert the fleet manager.
 */
export function InspectionScreen({ vehicle, onDone }: { vehicle: Vehicle; onDone: (msg?: string) => void }) {
  const [checks, setChecks] = useState<Record<string, { ok: boolean; note: string }>>(() => Object.fromEntries(INSPECTION_ITEMS.map((i) => [i.code, { ok: true, note: "" }])));
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const odo = odometer ? parseInt(odometer, 10) : null;
    if (odometer && !(odo! >= 0)) return setError(t.driverApp.invalidNumber);
    setBusy(true);
    try {
      const items = Object.entries(checks).map(([code, c]) => ({ code, ok: c.ok, note: c.note || null }));
      const failed = items.filter((i) => !i.ok).length;
      await store.enqueue("inspection.create", { vehicleId: vehicle.id, odometer: odo, notes: notes || null, items },
        `${vehicle.fleetNumber} · ${t.driverApp.inspection}${failed ? ` · ${failed} ✗` : ""}`);
      void sync.kick();
      // QA 16 Nov 2026: a failed safety item means "do not drive" — said plainly, even offline.
      const unsafe = INSPECTION_ITEMS.filter((i) => i.critical && !checks[i.code]?.ok).map((i) => i.name.ar);
      if (unsafe.length) Alert.alert(t.driverApp.inspection, t.driverApp.criticalFailWarning.replace("{items}", unsafe.join("، ")));
      onDone(t.driverApp.savedPendingApproval);
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
        <Text style={s.title}>{t.driverApp.inspection} · {vehicle.fleetNumber}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {INSPECTION_ITEMS.map((item) => {
          const c = checks[item.code]!;
          return (
            <View key={item.code} style={s.card}>
              <Text style={s.strong}>{item.name.ar}{item.critical ? " *" : ""}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[true, false].map((ok) => (
                  <Pressable key={String(ok)} onPress={() => setChecks({ ...checks, [item.code]: { ...c, ok } })} accessibilityRole="button" accessibilityState={{ selected: c.ok === ok }}
                    style={[s.secondary, { flex: 1 }, c.ok === ok && { backgroundColor: ok ? colors.ok : colors.bad, borderColor: ok ? colors.ok : colors.bad }]} testID={`check-${item.code}-${ok ? "ok" : "bad"}`}>
                    <Text style={[s.secondaryText, c.ok === ok && { color: "#fff" }]}>{ok ? t.driverApp.checkOk : t.driverApp.checkProblem}</Text>
                  </Pressable>
                ))}
              </View>
              {!c.ok && <TextInput style={[s.input, { fontSize: 15, textAlign: "right", writingDirection: "rtl" }]} placeholder={t.driverApp.problemNote} value={c.note} onChangeText={(note) => setChecks({ ...checks, [item.code]: { ...c, note } })} />}
            </View>
          );
        })}
        <View>
          <Text style={s.label}>{t.driverApp.odometer} ({t.common.optional})</Text>
          <TextInput style={s.input} keyboardType="number-pad" value={odometer} onChangeText={setOdometer} testID="inspection-odometer" />
        </View>
        <View>
          <Text style={s.label}>{t.driverApp.notes}</Text>
          <TextInput style={[s.input, { fontSize: 15, textAlign: "right", writingDirection: "rtl" }]} value={notes} onChangeText={setNotes} />
        </View>
        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <Pressable style={[s.button, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} accessibilityRole="button" testID="submit-inspection">
          <Text style={s.buttonText}>{busy ? t.common.loading : t.driverApp.submit}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
