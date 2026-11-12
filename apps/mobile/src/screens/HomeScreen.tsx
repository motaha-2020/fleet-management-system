import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import type { SessionUser, Vehicle } from "@fleet/contracts";
import { session } from "../session";
import { colors, t } from "../theme";

export function HomeScreen({ user }: { user: SessionUser }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [online, setOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const country = COUNTRY_TEMPLATES[user.tenant?.countryCode ?? ""] ?? EGYPT;
  const fuel = (code: string | null) => country.fuelTypes.find((f) => f.code === code)?.name.ar ?? code;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await session.api.call("listVehicles");
      setVehicles(r.items);
      setOnline(true);
      setUpdatedAt(new Date());
    } catch {
      // Offline-first storage arrives in M3; for now keep the last list and show the state.
      setOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.hello}>{t.driverApp.hello} {user.displayName}</Text>
          <Text style={s.company}>{user.tenant?.name}</Text>
        </View>
        <View style={[s.chip, { backgroundColor: online ? colors.okBg : colors.badBg }]}>
          <Text style={{ color: online ? colors.ok : colors.bad, fontWeight: "700", fontSize: 12 }}>{online ? t.driverApp.online : t.driverApp.offline}</Text>
        </View>
      </View>

      <View style={s.sectionRow}>
        <Text style={s.section}>{t.driverApp.vehicles}</Text>
        {updatedAt && <Text style={s.muted}>{t.driverApp.lastUpdate} {updatedAt.toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}</Text>}
      </View>

      <FlatList
        data={vehicles ?? []}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={vehicles ? <Text style={[s.muted, { textAlign: "center", marginTop: 24 }]}>{t.driverApp.noVehicles}</Text> : undefined}
        renderItem={({ item: v }) => (
          <View style={s.card} testID={`vehicle-${v.fleetNumber}`}>
            <View style={s.row}>
              <Text style={s.fleet}>{v.fleetNumber}</Text>
              <Text style={s.plate}>{v.registrationNumber}</Text>
            </View>
            <Text style={s.model}>{v.make} {v.model} · {v.year}</Text>
            <Text style={s.muted}>
              {t.driverApp.fuel}: {fuel(v.primaryFuelType)}{v.secondaryFuelType ? ` + ${fuel(v.secondaryFuelType)}` : ""} · {t.driverApp.tank}: {v.primaryTankCapacity}
            </Text>
          </View>
        )}
      />

      <View style={s.footer}>
        <Pressable style={s.secondary} onPress={load} accessibilityRole="button"><Text style={s.secondaryText}>{t.driverApp.refresh}</Text></Pressable>
        <Pressable style={s.secondary} onPress={() => void session.logout()} accessibilityRole="button"><Text style={s.secondaryText}>{t.driverApp.logout}</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.line },
  hello: { fontSize: 18, fontWeight: "700", color: colors.ink },
  company: { fontSize: 13, color: colors.muted },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 16, paddingTop: 16 },
  section: { fontSize: 16, fontWeight: "700", color: colors.ink },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fleet: { fontSize: 18, fontWeight: "700", color: colors.ink },
  plate: { fontSize: 15, fontWeight: "700", color: colors.accentInk, backgroundColor: colors.accentSoft, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  model: { fontSize: 14, color: colors.ink },
  muted: { fontSize: 13, color: colors.muted },
  footer: { flexDirection: "row", gap: 12, padding: 16, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  secondary: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: "#CBD2D9", alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 15, fontWeight: "600", color: colors.ink },
});
