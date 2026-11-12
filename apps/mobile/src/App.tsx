import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { SessionUser } from "@fleet/contracts";
import { session } from "./session";
import { ActivationScreen } from "./screens/ActivationScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { colors } from "./theme";

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

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
      ) : user ? (
        <HomeScreen user={user} />
      ) : (
        <ActivationScreen />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, direction: "rtl", paddingTop: Platform.OS === "android" ? 32 : Platform.OS === "ios" ? 48 : 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
