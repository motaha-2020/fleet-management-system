import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { COUNTRY_TEMPLATES, EGYPT } from "@fleet/config";
import type { SessionUser, Vehicle } from "@fleet/contracts";
import { session } from "../session";
import { store, type LocalStatus, type OutboxRow, type ReadSet } from "../store";
import { sync, type SyncStatus } from "../sync";
import { colors, t } from "../theme";

type Recent = OutboxRow & { photoPending: boolean };
const statusColor: Record<LocalStatus, { bg: string; fg: string }> = {
  pending: { bg: colors.accentSoft, fg: colors.accentInk }, held: { bg: colors.accentSoft, fg: colors.accentInk },
  accepted: { bg: colors.okBg, fg: colors.ok }, warning: { bg: "#FEF3C7", fg: "#92400E" },
  conflict: { bg: "#FEF3C7", fg: "#92400E" }, rejected: { bg: colors.badBg, fg: colors.bad },
};

/**
 * Driver home, offline-first (US-E14-07, OFF-001/011..013): vehicles come from the read set saved at the
 * last connection; an online/offline indicator, the number of items waiting, each item's status, and a
 * warning before signing out with unsent items.
 */
export function HomeScreen({ user, onRecordFuel, onRecordOdometer, notice }: {
  user: SessionUser; onRecordFuel: (v: Vehicle) => void; onRecordOdometer: (v: Vehicle, last: { value: number; at: string } | null) => void; notice?: string | null;
}) {
  const [readSet, setReadSet] = useState<ReadSet | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [status, setStatus] = useState<SyncStatus>({ online: null, syncing: false, pending: 0, lastSync: null });
  const [grant, setGrant] = useState<{ valid: boolean; msLeft: number | null } | null>(null);
  const country = COUNTRY_TEMPLATES[user.tenant?.countryCode ?? ""] ?? EGYPT;
  const fuel = (code: string | null) => country.fuelTypes.find((f) => f.code === code)?.name.ar ?? code;

  const reload = useCallback(async () => {
    setReadSet(await store.getReadSet());
    setRecent(await store.recent());
    const g = await store.grantState();
    setGrant({ valid: g.valid, msLeft: g.msLeft });
  }, []);

  useEffect(() => {
    void reload();
    sync.start();
    // Re-read the local store whenever a sync round finishes.
    return sync.subscribe((s) => {
      setStatus(s);
      if (!s.syncing) void reload();
    });
  }, [reload]);

  const logout = async () => {
    const n = await store.pendingCount();
    if (!n) return void session.logout();
    Alert.alert(t.driverApp.logoutPendingTitle, t.driverApp.logoutPendingBody.replace("{n}", String(n)), [
      { text: t.common.cancel, style: "cancel" },
      { text: t.driverApp.logoutAnyway, style: "destructive", onPress: () => void session.logout() },
    ]);
  };

  const online = status.online !== false;
  const lastOdo = (id: string) => readSet?.odometer.find((o) => o.vehicleId === id) ?? null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.hello}>{t.driverApp.hello} {user.displayName}</Text>
          <Text style={s.company}>{user.tenant?.name}</Text>
        </View>
        <View style={[s.chip, { backgroundColor: online ? colors.okBg : colors.badBg }]} testID="online-chip">
          <Text style={{ color: online ? colors.ok : colors.bad, fontWeight: "700", fontSize: 12 }}>{online ? t.driverApp.online : t.driverApp.offline}</Text>
        </View>
      </View>

      <View style={[s.bar, status.pending ? s.barPending : null]} testID="pending-bar">
        <Text style={s.barText}>
          {status.syncing ? t.driverApp.sending : status.pending ? `${t.driverApp.pending}: ${status.pending}` : t.driverApp.allSent}
        </Text>
        <Text style={s.barSub}>{status.lastSync ? `${t.driverApp.lastUpdate} ${time(status.lastSync)}` : t.driverApp.neverSynced}</Text>
      </View>

      {grant && !grant.valid && <Text style={s.warn} accessibilityRole="alert">{t.driverApp.grantExpired}</Text>}
      {grant?.valid && grant.msLeft !== null && grant.msLeft < 24 * 3_600_000 && (
        <Text style={s.info}>{t.driverApp.grantLeft} {Math.max(0, Math.floor(grant.msLeft / 3_600_000))} {t.driverApp.hours}</Text>
      )}
      {notice && <Text style={s.notice}>{notice}</Text>}

      <FlatList
        data={readSet?.vehicles ?? []}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void sync.kick()} />}
        ListHeaderComponent={<Text style={s.section}>{t.driverApp.vehicles}</Text>}
        ListEmptyComponent={readSet ? <Text style={[s.muted, { textAlign: "center", marginTop: 24 }]}>{t.driverApp.noVehicles}</Text> : undefined}
        renderItem={({ item: v }) => {
          const odo = lastOdo(v.id);
          return (
            <View style={s.card} testID={`vehicle-${v.fleetNumber}`}>
              <View style={s.row}>
                <Text style={s.fleet}>{v.fleetNumber}</Text>
                <Text style={s.plate}>{v.registrationNumber}</Text>
              </View>
              <Text style={s.model}>{v.make} {v.model} · {v.year}</Text>
              <Text style={s.muted}>
                {t.driverApp.fuel}: {fuel(v.primaryFuelType)}{v.secondaryFuelType ? ` + ${fuel(v.secondaryFuelType)}` : ""} · {t.driverApp.tank}: {v.primaryTankCapacity}
              </Text>
              {odo && <Text style={s.muted}>{t.driverApp.lastOdometer}: {odo.value.toLocaleString("en")}</Text>}
              <View style={s.actions}>
                <Pressable style={[s.primary, !grant?.valid && s.disabled]} disabled={!grant?.valid} onPress={() => onRecordFuel(v)} accessibilityRole="button" testID={`fuel-${v.fleetNumber}`}>
                  <Text style={s.primaryText}>{t.driverApp.recordFuel}</Text>
                </Pressable>
                <Pressable style={[s.secondary, !grant?.valid && s.disabled]} disabled={!grant?.valid} onPress={() => onRecordOdometer(v, odo)} accessibilityRole="button" testID={`odometer-${v.fleetNumber}`}>
                  <Text style={s.secondaryText}>{t.driverApp.recordOdometer}</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={{ gap: 8, marginTop: 8 }}>
            <Text style={s.section}>{t.driverApp.recentActivity}</Text>
            {!recent.length ? <Text style={s.muted}>{t.driverApp.noActivity}</Text> : recent.map((e) => (
              <View key={e.eventId} style={s.entry} testID="outbox-item">
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.model}>{t.driverApp.types[e.type]} · {e.summary}</Text>
                  <Text style={s.muted}>{time(e.createdAt)}{e.photoPending ? ` · ${t.driverApp.photoPending}` : ""}</Text>
                </View>
                <Text style={[s.badge, { backgroundColor: statusColor[e.status].bg, color: statusColor[e.status].fg }]}>
                  {t.driverApp.localStatuses[e.status]}
                </Text>
              </View>
            ))}
          </View>
        }
      />

      <View style={s.footer}>
        <Pressable style={s.footerBtn} onPress={() => void sync.kick()} accessibilityRole="button" testID="send-now"><Text style={s.footerText}>{t.driverApp.sendNow}</Text></Pressable>
        <Pressable style={s.footerBtn} onPress={() => void logout()} accessibilityRole="button" testID="logout"><Text style={s.footerText}>{t.driverApp.logout}</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.line },
  hello: { fontSize: 18, fontWeight: "700", color: colors.ink },
  company: { fontSize: 13, color: colors.muted },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.okBg },
  barPending: { backgroundColor: colors.accentSoft },
  barText: { fontSize: 14, fontWeight: "700", color: colors.ink },
  barSub: { fontSize: 12, color: colors.muted },
  section: { fontSize: 16, fontWeight: "700", color: colors.ink },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  fleet: { fontSize: 18, fontWeight: "700", color: colors.ink },
  plate: { fontSize: 15, fontWeight: "700", color: colors.accentInk, backgroundColor: colors.accentSoft, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  model: { fontSize: 14, color: colors.ink },
  muted: { fontSize: 13, color: colors.muted },
  footer: { flexDirection: "row", gap: 12, padding: 16, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  footerBtn: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: "#CBD2D9", alignItems: "center", justifyContent: "center" },
  footerText: { fontSize: 15, fontWeight: "600", color: colors.ink },
  primary: { flex: 1, minHeight: 44, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondary: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.accent, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.accent, fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  entry: { flexDirection: "row", gap: 8, justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 12 },
  badge: { fontSize: 12, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  notice: { margin: 16, marginBottom: 0, backgroundColor: colors.okBg, color: colors.ok, padding: 12, borderRadius: 8, fontWeight: "600" },
  warn: { margin: 16, marginBottom: 0, backgroundColor: colors.badBg, color: colors.bad, padding: 12, borderRadius: 8, fontWeight: "600" },
  info: { marginHorizontal: 16, marginTop: 8, color: colors.muted, fontSize: 13 },
});
