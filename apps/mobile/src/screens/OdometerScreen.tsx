import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { Vehicle } from "@fleet/contracts";
import { GrantExpiredError, store } from "../store";
import { sync } from "../sync";
import { t } from "../theme";
import { MeterCapture, s, type MeterShot } from "./MeterCapture";

/**
 * ODO-001 offline (E14) + owner decisions (13–14 Nov 2026): the driver photographs the meter (camera only), the phone
 * reads the number from the photo and fills it in, and the driver confirms or corrects it. The time, the place (if
 * allowed) and what the phone read are saved with the reading; it counts once approved. Saved to the outbox and sent
 * as odometer.record; the photo follows as an upload.
 */
export function OdometerScreen({ vehicle, last, onDone }: { vehicle: Vehicle; last: { value: number; at: string } | null; onDone: (msg?: string) => void }) {
  const [value, setValue] = useState("");
  const [shot, setShot] = useState<MeterShot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const odo = parseInt(value, 10);
    if (!/^\d{1,7}$/.test(value) || !(odo >= 0)) return setError(t.driverApp.invalidNumber);
    if (!shot) return setError(t.driverApp.odometerPhotoRequired);
    setBusy(true);
    try {
      const loc = await shot.where;
      await store.enqueue(
        "odometer.record",
        { vehicleId: vehicle.id, odometer: odo, photoTakenAt: shot.takenAt, location: loc.point, locationStatus: loc.status, ocrValue: shot.ocrValue },
        `${vehicle.fleetNumber} · ${odo.toLocaleString("en")}`,
        { uri: shot.uri },
      );
      void sync.kick();
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
        <Text style={s.title}>{t.driverApp.recordOdometer} · {vehicle.fleetNumber}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <MeterCapture last={last?.value ?? null} shot={shot} onShot={setShot} value={value} onValue={setValue} onError={setError} />
        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <Pressable style={[s.button, (busy || !shot) && { opacity: 0.6 }]} onPress={submit} disabled={busy} accessibilityRole="button" testID="submit-odometer">
          <Text style={s.buttonText}>{busy ? t.common.loading : t.driverApp.submit}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
