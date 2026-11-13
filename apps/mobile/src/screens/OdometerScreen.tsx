import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { Vehicle } from "@fleet/contracts";
import { GrantExpiredError, store } from "../store";
import { sync } from "../sync";
import { shrinkPhoto } from "../photo";
import { ensureConsent } from "../consent";
import { currentLocation, type LocationResult } from "../location";
import { colors, t } from "../theme";

type Shot = { uri: string; takenAt: string };

/**
 * ODO-001 offline (E14) + owner decision (13 Nov 2026): the driver photographs the meter and records the reading.
 * The photo is required and taken with the camera (not chosen from the gallery), so it shows the meter now. The
 * time it was taken and, if the driver allows it, the location are saved with the reading; a refused or missing
 * location does not block it. Saved to the outbox and sent as odometer.record; the photo follows as an upload.
 */
export function OdometerScreen({ vehicle, last, onDone }: { vehicle: Vehicle; last: { value: number; at: string } | null; onDone: (msg?: string) => void }) {
  const [value, setValue] = useState("");
  const [shot, setShot] = useState<Shot | null>(null);
  const [where, setWhere] = useState<Promise<LocationResult> | null>(null);
  const [place, setPlace] = useState<LocationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function photograph() {
    setError(null);
    if (Platform.OS !== "web") {
      if (!(await ensureConsent("camera"))) return setError(t.driverApp.cameraNeeded);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError(t.driverApp.cameraNeeded);
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.5 };
    // The development web build has no camera API: it falls back to choosing a file.
    const r = Platform.OS === "web" ? await ImagePicker.launchImageLibraryAsync(opts) : await ImagePicker.launchCameraAsync(opts);
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    const takenAt = new Date().toISOString();
    // Look up the location while the photo is compressed; the driver can keep typing.
    setPlace(null);
    const lookup = currentLocation();
    setWhere(lookup);
    void lookup.then(setPlace);
    setBusy(true);
    try {
      setShot({ uri: await shrinkPhoto(a.uri), takenAt });
    } catch {
      setError(t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError(null);
    const odo = parseInt(value, 10);
    if (!/^\d{1,7}$/.test(value) || !(odo >= 0)) return setError(t.driverApp.invalidNumber);
    if (!shot) return setError(t.driverApp.odometerPhotoRequired);
    setBusy(true);
    try {
      const loc = place ?? (where ? await where : { status: "unavailable" as const, point: null });
      await store.enqueue(
        "odometer.record",
        { vehicleId: vehicle.id, odometer: odo, photoTakenAt: shot.takenAt, location: loc.point, locationStatus: loc.status },
        `${vehicle.fleetNumber} · ${odo.toLocaleString("en")}`,
        { uri: shot.uri },
      );
      void sync.kick();
      onDone(t.driverApp.saved);
    } catch (e) {
      setError(e instanceof GrantExpiredError ? t.driverApp.grantExpired : t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const time = shot ? new Date(shot.takenAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "";
  const placeText = !shot ? null
    : !place ? t.driverApp.locating
      : place.status === "ok" ? t.driverApp.locationOk.replace("{m}", String(place.point.accuracyM ?? "?"))
        : place.status === "denied" ? t.driverApp.locationDenied : t.driverApp.locationUnavailable;

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
        <Pressable style={[s.camera, shot && s.cameraDone]} onPress={photograph} disabled={busy} accessibilityRole="button" testID="odometer-photo">
          {shot ? (
            <View style={{ alignItems: "center", gap: 6 }}>
              <Image source={{ uri: shot.uri }} style={{ width: 220, height: 150, borderRadius: 8 }} resizeMode="cover" />
              <Text style={s.ok}>{t.driverApp.photoTakenAt.replace("{time}", time)}</Text>
              <Text style={s.link}>{t.driverApp.retakePhoto}</Text>
            </View>
          ) : (
            <View style={{ alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 34 }}>📷</Text>
              <Text style={s.cameraText}>{t.driverApp.odometerPhoto}</Text>
            </View>
          )}
        </Pressable>
        {placeText && <Text style={place?.status === "ok" ? s.ok : s.muted}>{placeText}</Text>}
        <View>
          <Text style={s.label}>{t.driverApp.odometer}</Text>
          <TextInput style={s.input} keyboardType="number-pad" value={value} onChangeText={setValue} testID="odometer-value" accessibilityLabel={t.driverApp.odometer} />
        </View>
        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <Pressable style={[s.button, (busy || !shot) && { opacity: 0.6 }]} onPress={submit} disabled={busy} accessibilityRole="button" testID="submit-odometer">
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
  ok: { fontSize: 14, color: colors.ok, fontWeight: "600" },
  link: { fontSize: 14, color: colors.accent, fontWeight: "700" },
  strong: { fontWeight: "700", color: colors.ink },
  camera: { minHeight: 150, borderRadius: 12, borderWidth: 2, borderStyle: "dashed", borderColor: colors.accent, alignItems: "center", justifyContent: "center", padding: 12, backgroundColor: colors.surface },
  cameraDone: { borderStyle: "solid", borderColor: colors.ok },
  cameraText: { color: colors.accent, fontSize: 17, fontWeight: "700" },
  input: { minHeight: 52, borderWidth: 1, borderColor: "#CBD2D9", borderRadius: 10, paddingHorizontal: 12, fontSize: 20, color: colors.ink, backgroundColor: colors.surface, writingDirection: "ltr", textAlign: "center" },
  button: { minHeight: 52, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  error: { backgroundColor: colors.badBg, color: colors.bad, padding: 12, borderRadius: 8, fontWeight: "600" },
});
