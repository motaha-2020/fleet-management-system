import { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import type { SessionUser, Vehicle } from "@fleet/contracts";
import { GrantExpiredError, store } from "../store";
import { sync } from "../sync";
import { shrinkPhoto } from "../photo";
import { ensureConsent } from "../consent";
import { currentLocation, type LocationResult } from "../location";
import { colors, t } from "../theme";

/**
 * US-E09-01: record a fuel entry in a few steps. Cash needs a receipt photo before submit (FUEL-009).
 * M3: the entry is saved to the encrypted outbox first and sent when there is a connection, so it works
 * offline (E14). The photo is compressed to ≤ 500 KB and uploaded after the entry is accepted (OFF-008).
 */
export function FuelScreen({ user, vehicle, onDone }: { user: SessionUser; vehicle: Vehicle; onDone: (msg?: string) => void }) {
  const country = COUNTRY_TEMPLATES[user.tenant?.countryCode ?? ""] ?? EGYPT;
  const types = [vehicle.primaryFuelType, ...(vehicle.secondaryFuelType ? [vehicle.secondaryFuelType] : [])];
  const [fuelType, setFuelType] = useState(types[0]!);
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [odometer, setOdometer] = useState("");
  const [isFull, setIsFull] = useState(true);
  const [payment, setPayment] = useState<"cash" | "card">("cash");
  const [photo, setPhoto] = useState<{ uri: string; mime: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Owner decision (14 Nov 2026): where the fuel station is. Looked up when the screen opens (the driver is at the
  // pump); a refusal or no fix never blocks the entry.
  const [where] = useState<Promise<LocationResult>>(() => currentLocation());
  const [place, setPlace] = useState<LocationResult | null>(null);
  useEffect(() => { void where.then(setPlace); }, [where]);
  const unit = country.fuelTypes.find((f) => f.code === fuelType)?.unit === "m3" ? "m³" : "L";

  async function pick(camera: boolean) {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.5 };
    if (camera) {
      // PRV-002: explain first and record the decision; "no" leaves the gallery option.
      if (!(await ensureConsent("camera"))) return setError(t.m6.consent.useGallery);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError(t.m6.consent.useGallery);
    }
    const r = camera && Platform.OS !== "web" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    setError(null);
    setBusy(true);
    try {
      setPhoto({ uri: await shrinkPhoto(a.uri), mime: "image/jpeg" });
    } catch {
      setError(t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError(null);
    const q = Number(quantity.replace(",", "."));
    const amt = Number(amount.replace(",", "."));
    const odo = parseInt(odometer, 10);
    if (!(q > 0) || !(amt > 0) || !(odo >= 0)) return setError(t.driverApp.invalidNumber);
    if (payment === "cash" && !photo) return setError(t.driverApp.receiptRequired);
    setBusy(true);
    try {
      const loc = place ?? (await where);
      await store.enqueue(
        "fuel.create",
        { vehicleId: vehicle.id, odometer: odo, fuelType, quantity: q, amountMinor: Math.round(amt * 100), isFull, payment, location: loc.point, locationStatus: loc.status },
        `${vehicle.fleetNumber} · ${q} ${unit} · ${amt.toFixed(2)}`,
        photo ? { uri: photo.uri } : undefined,
      );
      void sync.kick();
      onDone(t.driverApp.saved);
    } catch (e) {
      setError(e instanceof GrantExpiredError ? t.driverApp.grantExpired : t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const Choice = ({ on, label, onPress, testID }: { on: boolean; label: string; onPress: () => void; testID?: string }) => (
    <Pressable onPress={onPress} style={[s.choice, on && s.choiceOn]} accessibilityRole="radio" accessibilityState={{ selected: on }} testID={testID}>
      <Text style={[s.choiceText, on && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={s.header}>
        <Pressable onPress={() => onDone()} accessibilityRole="button"><Text style={s.back}>{t.driverApp.back}</Text></Pressable>
        <Text style={s.title}>{t.driverApp.recordFuel} · {vehicle.fleetNumber}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {types.length > 1 && (
          <View>
            <Text style={s.label}>{t.driverApp.fuelType}</Text>
            <View style={s.row}>{types.map((ft) => <Choice key={ft} on={fuelType === ft} label={country.fuelTypes.find((f) => f.code === ft)?.name.ar ?? ft} onPress={() => setFuelType(ft)} />)}</View>
          </View>
        )}
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{t.driverApp.quantity} ({unit})</Text>
            <TextInput style={s.input} keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} testID="quantity" accessibilityLabel={t.driverApp.quantity} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{t.driverApp.amount}</Text>
            <TextInput style={s.input} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} testID="amount" accessibilityLabel={t.driverApp.amount} />
          </View>
        </View>
        <View>
          <Text style={s.label}>{t.driverApp.odometer}</Text>
          <TextInput style={s.input} keyboardType="number-pad" value={odometer} onChangeText={setOdometer} testID="odometer" accessibilityLabel={t.driverApp.odometer} />
          <Text style={s.place} testID="fuel-location">
            {!place ? t.driverApp.locating
              : place.status === "ok" ? t.driverApp.stationLocated.replace("{m}", String(place.point.accuracyM ?? "?"))
                : place.status === "denied" ? t.driverApp.locationDenied : t.driverApp.locationUnavailable}
          </Text>
        </View>
        <View style={s.row}>
          <Choice on={isFull} label={t.driverApp.full} onPress={() => setIsFull(true)} />
          <Choice on={!isFull} label={t.driverApp.partial} onPress={() => setIsFull(false)} />
        </View>
        <View style={s.row}>
          <Choice on={payment === "cash"} label={t.driverApp.cash} onPress={() => setPayment("cash")} testID="pay-cash" />
          <Choice on={payment === "card"} label={t.driverApp.card} onPress={() => setPayment("card")} testID="pay-card" />
        </View>
        <View style={s.row}>
          <Pressable style={s.secondary} onPress={() => pick(true)} accessibilityRole="button"><Text style={s.secondaryText}>{t.driverApp.takePhoto}</Text></Pressable>
          <Pressable style={s.secondary} onPress={() => pick(false)} accessibilityRole="button" testID="choose-photo"><Text style={s.secondaryText}>{t.driverApp.choosePhoto}</Text></Pressable>
        </View>
        {photo && (
          <View style={{ alignItems: "center", gap: 6 }}>
            <Image source={{ uri: photo.uri }} style={{ width: 120, height: 120, borderRadius: 8 }} />
            <Text style={{ color: colors.ok, fontWeight: "600" }}>{t.driverApp.photoReady}</Text>
          </View>
        )}
        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <Pressable style={[s.button, busy && { opacity: 0.7 }]} onPress={submit} disabled={busy} accessibilityRole="button" testID="submit-fuel">
          <Text style={s.buttonText}>{busy ? t.common.loading : t.driverApp.submit}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  place: { fontSize: 13, color: colors.muted, marginTop: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.line },
  back: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink, flex: 1 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink, marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#CBD2D9", borderRadius: 10, paddingHorizontal: 12, fontSize: 17, color: colors.ink, backgroundColor: colors.surface, writingDirection: "ltr", textAlign: "center" },
  row: { flexDirection: "row", gap: 10 },
  choice: { flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: "#CBD2D9", alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  choiceOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceText: { fontSize: 15, fontWeight: "600", color: colors.ink },
  secondary: { flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.accent, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.accent, fontWeight: "700" },
  button: { minHeight: 52, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  error: { backgroundColor: colors.badBg, color: colors.bad, padding: 12, borderRadius: 8, fontWeight: "600" },
});
