import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { SessionUser, Vehicle } from "@fleet/contracts";
import { FuelScreen } from "./screens/FuelScreen";
import { OdometerScreen } from "./screens/OdometerScreen";
import { DefectScreen } from "./screens/DefectScreen";
import { session } from "./session";
import { ActivationScreen } from "./screens/ActivationScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { DiagnosticsScreen } from "./screens/DiagnosticsScreen";
import { PinScreen } from "./screens/PinScreen";
import { appLock, pin } from "./pin";
import { colors } from "./theme";

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  // SEC-005: no driver screen opens without the PIN (or fingerprint). null = not known yet.
  const [pinSet, setPinSet] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(appLock.isLocked);
  const [fuelFor, setFuelFor] = useState<Vehicle | null>(null);
  const [odoFor, setOdoFor] = useState<{ vehicle: Vehicle; last: { value: number; at: string } | null } | null>(null);
  const [defectFor, setDefectFor] = useState<Vehicle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState(false);

  useEffect(() => {
    appLock.start();
    const offLock = appLock.subscribe(setLocked);
    const off = session.subscribe((u) => {
      setUser(u);
      // A new session (activation) or none (sign-out, wipe): re-read whether a PIN exists.
      void pin.isSet().then(setPinSet);
    });
    void session.restore().finally(async () => {
      setPinSet(await pin.isSet());
      setReady(true);
    });
    return () => { off(); offLock(); };
  }, []);

  const signedIn = !!user && pinSet !== null;
  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {!ready || (user && pinSet === null) ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : signedIn && !pinSet ? (
        <PinScreen mode="setup" onDone={() => setPinSet(true)} />
      ) : signedIn && locked ? (
        <PinScreen mode="unlock" onDone={() => setLocked(false)} />
      ) : user && fuelFor ? (
        <FuelScreen user={user} vehicle={fuelFor} onDone={(msg) => { setFuelFor(null); setNotice(msg ?? null); }} />
      ) : user && odoFor ? (
        <OdometerScreen vehicle={odoFor.vehicle} last={odoFor.last} onDone={(msg) => { setOdoFor(null); setNotice(msg ?? null); }} />
      ) : user && defectFor ? (
        <DefectScreen vehicle={defectFor} onDone={(msg) => { setDefectFor(null); setNotice(msg ?? null); }} />
      ) : user ? (
        <HomeScreen user={user} notice={notice}
          onReportDefect={(v) => { setNotice(null); setDefectFor(v); }}
          onRecordFuel={(v) => { setNotice(null); setFuelFor(v); }}
          onRecordOdometer={(vehicle, last) => { setNotice(null); setOdoFor({ vehicle, last }); }} />
      ) : diagnostics ? (
        <DiagnosticsScreen onBack={() => setDiagnostics(false)} />
      ) : (
        <ActivationScreen onDiagnostics={() => setDiagnostics(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, direction: "rtl", paddingTop: Platform.OS === "android" ? 32 : Platform.OS === "ios" ? 48 : 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
