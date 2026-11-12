import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { Vehicle } from "@fleet/contracts";
import { GrantExpiredError, store } from "../store";
import { sync } from "../sync";
import { shrinkPhoto } from "../photo";
import { colors, t } from "../theme";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

/**
 * US-E10-04 / WO-001: the driver reports a defect, online or offline. Saved to the outbox and sent as
 * defect.report; the optional photo follows as a resumable upload once the report is accepted (OFF-008).
 * "Not drivable" restricts the vehicle until a supervisor reviews the report (E12).
 */
export function DefectScreen({ vehicle, onDone }: { vehicle: Vehicle; onDone: (msg?: string) => void }) {
  const D = t.m4.driver;
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("medium");
  const [drivable, setDrivable] = useState<boolean | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(camera: boolean) {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.5 };
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
    }
    const r = camera && Platform.OS !== "web" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    setBusy(true);
    try {
      setPhoto(await shrinkPhoto(a.uri));
    } catch {
      setError(t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError(null);
    if (description.trim().length < 3 || drivable === null) return setError(t.errors.required);
    setBusy(true);
    try {
      await store.enqueue(
        "defect.report",
        { vehicleId: vehicle.id, description: description.trim(), severity, drivable },
        `${vehicle.fleetNumber} · ${t.m4.defects.severities[severity]}${drivable ? "" : ` · ${t.m4.defects.notDrivable}`}`,
        photo ? { uri: photo } : undefined,
      );
      void sync.kick();
      onDone(D.saved);
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
        <Text style={s.title}>{D.title} · {vehicle.fleetNumber}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View>
          <Text style={s.label}>{D.description}</Text>
          <TextInput style={[s.input, { minHeight: 96, textAlignVertical: "top" }]} multiline value={description} onChangeText={setDescription}
            testID="defect-description" accessibilityLabel={D.description} />
        </View>
        <View>
          <Text style={s.label}>{D.severity}</Text>
          <View style={s.row}>
            {SEVERITIES.map((x) => <Choice key={x} on={severity === x} label={t.m4.defects.severities[x]} onPress={() => setSeverity(x)} testID={`severity-${x}`} />)}
          </View>
        </View>
        <View>
          <Text style={s.label}>{D.drivable}</Text>
          <View style={s.row}>
            <Choice on={drivable === true} label={D.yes} onPress={() => setDrivable(true)} testID="drivable-yes" />
            <Choice on={drivable === false} label={D.no} onPress={() => setDrivable(false)} testID="drivable-no" danger />
          </View>
        </View>
        <View style={s.row}>
          <Pressable style={s.secondary} onPress={() => pick(true)} accessibilityRole="button"><Text style={s.secondaryText}>{D.takePhoto}</Text></Pressable>
          <Pressable style={s.secondary} onPress={() => pick(false)} accessibilityRole="button" testID="defect-photo"><Text style={s.secondaryText}>{t.driverApp.choosePhoto}</Text></Pressable>
        </View>
        {photo && <Image source={{ uri: photo }} style={{ width: 120, height: 120, borderRadius: 8, alignSelf: "center" }} />}
        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <Pressable style={[s.button, busy && { opacity: 0.7 }]} onPress={submit} disabled={busy} accessibilityRole="button" testID="submit-defect">
          <Text style={s.buttonText}>{busy ? t.common.loading : D.send}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Choice({ on, label, onPress, testID, danger }: { on: boolean; label: string; onPress: () => void; testID?: string; danger?: boolean }) {
  return (
    <Pressable style={[s.choice, on && (danger ? s.choiceBad : s.choiceOn)]} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }} testID={testID}>
      <Text style={[s.choiceText, on && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.line },
  back: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink, flex: 1 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink, marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#CBD2D9", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.ink, backgroundColor: colors.surface, textAlign: "right" },
  row: { flexDirection: "row", gap: 8 },
  choice: { flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: "#CBD2D9", alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  choiceOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceBad: { backgroundColor: colors.bad, borderColor: colors.bad },
  choiceText: { fontSize: 15, fontWeight: "600", color: colors.ink },
  secondary: { flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.accent, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.accent, fontSize: 15, fontWeight: "700" },
  button: { minHeight: 52, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  error: { backgroundColor: colors.badBg, color: colors.bad, padding: 12, borderRadius: 8, fontWeight: "600" },
});
