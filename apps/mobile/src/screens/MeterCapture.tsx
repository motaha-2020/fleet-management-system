import { useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { shrinkPhoto } from "../photo";
import { ensureConsent } from "../consent";
import { currentLocation, type LocationResult } from "../location";
import { readMeter } from "../ocr";
import { colors, t } from "../theme";

export interface MeterShot {
  uri: string;
  takenAt: string;
  /** What the phone read from the photo (null: could not read it). */
  ocrValue: number | null;
  where: Promise<LocationResult>;
}

/**
 * The meter photo (camera only, so it shows the meter now), the time and place it was taken, and the number read
 * from it on the phone (owner decision, 14 Nov 2026), which fills the field for the driver to confirm or correct.
 */
export function MeterCapture({ last, shot, onShot, value, onValue, onError }: {
  last: number | null;
  shot: MeterShot | null;
  onShot: (s: MeterShot) => void;
  value: string;
  onValue: (v: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState<LocationResult | null>(null);

  async function photograph() {
    onError(null);
    if (Platform.OS !== "web") {
      if (!(await ensureConsent("camera"))) return onError(t.driverApp.cameraNeeded);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return onError(t.driverApp.cameraNeeded);
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.5 };
    const r = Platform.OS === "web" ? await ImagePicker.launchImageLibraryAsync(opts) : await ImagePicker.launchCameraAsync(opts);
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    const takenAt = new Date().toISOString();
    setPlace(null);
    const where = currentLocation();
    void where.then(setPlace);
    setBusy(true);
    try {
      // Read the full-size photo (sharper digits), then keep the smaller copy for upload.
      const ocrValue = await readMeter(a.uri, last);
      const uri = await shrinkPhoto(a.uri);
      onShot({ uri, takenAt, ocrValue, where });
      if (ocrValue != null && !value) onValue(String(ocrValue));
    } catch {
      onError(t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const time = shot ? new Date(shot.takenAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "";
  const placeText = !shot ? null
    : !place ? t.driverApp.locating
      : place.status === "ok" ? t.driverApp.locationOk.replace("{m}", String(place.point.accuracyM ?? "?"))
        : place.status === "denied" ? t.driverApp.locationDenied : t.driverApp.locationUnavailable;
  const typed = parseInt(value, 10);

  return (
    <View style={{ gap: 14 }}>
      {last != null && <Text style={s.muted}>{t.driverApp.lastOdometer}: <Text style={s.strong}>{last.toLocaleString("en")}</Text></Text>}
      <Pressable style={[s.camera, shot && s.cameraDone]} onPress={photograph} disabled={busy} accessibilityRole="button" testID="meter-photo">
        {shot ? (
          <View style={{ alignItems: "center", gap: 6 }}>
            <Image source={{ uri: shot.uri }} style={{ width: 220, height: 150, borderRadius: 8 }} resizeMode="cover" />
            <Text style={s.ok}>{t.driverApp.photoTakenAt.replace("{time}", time)}</Text>
            <Text style={s.link}>{t.driverApp.retakePhoto}</Text>
          </View>
        ) : (
          <View style={{ alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 34 }}>📷</Text>
            <Text style={s.cameraText}>{busy ? t.driverApp.readingPhoto : t.driverApp.odometerPhoto}</Text>
          </View>
        )}
      </Pressable>
      {placeText && <Text style={place?.status === "ok" ? s.ok : s.muted}>{placeText}</Text>}
      {shot && (
        <Text style={shot.ocrValue == null ? s.muted : shot.ocrValue === typed ? s.ok : s.warn} testID="ocr-result">
          {shot.ocrValue == null ? t.driverApp.ocrNone
            : shot.ocrValue === typed ? t.driverApp.ocrMatch.replace("{n}", shot.ocrValue.toLocaleString("en"))
              : t.driverApp.ocrDiffers.replace("{n}", shot.ocrValue.toLocaleString("en"))}
        </Text>
      )}
      <View>
        <Text style={s.label}>{t.driverApp.confirmOdometer}</Text>
        <TextInput style={s.input} keyboardType="number-pad" value={value} onChangeText={onValue} testID="odometer-value" accessibilityLabel={t.driverApp.odometer} />
      </View>
    </View>
  );
}

export const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.line },
  back: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink, flex: 1 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink, marginBottom: 6 },
  muted: { fontSize: 14, color: colors.muted },
  ok: { fontSize: 14, color: colors.ok, fontWeight: "600" },
  warn: { fontSize: 14, color: colors.bad, fontWeight: "600" },
  link: { fontSize: 14, color: colors.accent, fontWeight: "700" },
  strong: { fontWeight: "700", color: colors.ink },
  camera: { minHeight: 150, borderRadius: 12, borderWidth: 2, borderStyle: "dashed", borderColor: colors.accent, alignItems: "center", justifyContent: "center", padding: 12, backgroundColor: colors.surface },
  cameraDone: { borderStyle: "solid", borderColor: colors.ok },
  cameraText: { color: colors.accent, fontSize: 17, fontWeight: "700" },
  input: { minHeight: 52, borderWidth: 1, borderColor: "#CBD2D9", borderRadius: 10, paddingHorizontal: 12, fontSize: 20, color: colors.ink, backgroundColor: colors.surface, writingDirection: "ltr", textAlign: "center" },
  button: { minHeight: 52, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  secondary: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  secondaryText: { color: colors.accent, fontSize: 15, fontWeight: "700" },
  error: { backgroundColor: colors.badBg, color: colors.bad, padding: 12, borderRadius: 8, fontWeight: "600" },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 6 },
});
