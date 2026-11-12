import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { SessionUser, Vehicle } from "@fleet/contracts";
import { FuelScreen } from "./screens/FuelScreen";
import { OdometerScreen } from "./screens/OdometerScreen";
import { session } from "./session";
import { ActivationScreen } from "./screens/ActivationScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { DiagnosticsScreen } from "./screens/DiagnosticsScreen";
import { colors } from "./theme";

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [fuelFor, setFuelFor] = useState<Vehicle | null>(null);
  const [odoFor, setOdoFor] = useState<{ vehicle: Vehicle; last: { value: number; at: string } | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState(false);

  useEffect(() => {
    const off = session.subscribe(setUser);
    void session.restore().finally(() => setReady(true));
    return off;
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {!ready ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : user && fuelFor ? (
        <FuelScreen user={user} vehicle={fuelFor} onDone={(msg) => { setFuelFor(null); setNotice(msg ?? null); }} />
      ) : user && odoFor ? (
        <OdometerScreen vehicle={odoFor.vehicle} last={odoFor.last} onDone={(msg) => { setOdoFor(null); setNotice(msg ?? null); }} />
      ) : user ? (
        <HomeScreen user={user} notice={notice}
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
