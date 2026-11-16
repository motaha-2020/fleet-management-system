import { useCallback, useEffect, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import type { SessionUser, Task, TaskLine, Vehicle } from "@fleet/contracts";
import { session } from "../session";
import { GrantExpiredError, store } from "../store";
import { sync } from "../sync";
import { colors, t } from "../theme";
import { MeterCapture, s, type MeterShot } from "./MeterCapture";

const fmt = (iso: string) => new Date(iso).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Owner decisions (14 Nov 2026): the driver sees their tasks and starts / finishes their crew line with a meter photo
 * (read on the phone, confirmed by the driver). Works offline: the start/finish goes to the outbox as task.line and
 * the photo follows as an upload. The list itself needs a connection (it is refreshed when online).
 */
export function TasksScreen({ user, vehicles, onBack }: { user: SessionUser; vehicles: Vehicle[]; onBack: (msg?: string) => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState<{ task: Task; line: TaskLine; action: "start" | "finish" } | null>(null);
  const [done, setDone] = useState<Record<string, "start" | "finish">>({});

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await session.api.call("listTasks", { query: {} });
      setTasks(r.items.filter((k) => k.status === "planned" || k.status === "in_progress" || k.status === "done"));
      setError(null);
    } catch {
      setError(t.driverApp.tasksOffline);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (working) {
    return <LineScreen {...working} vehicle={vehicles.find((v) => v.id === working.line.vehicleId) ?? null}
      onDone={(msg) => { if (msg) setDone({ ...done, [working.line.id]: working.action }); setWorking(null); if (msg) void load(); }} />;
  }
  const vName = (id: string) => vehicles.find((v) => v.id === id)?.fleetNumber ?? "—";
  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <Pressable onPress={() => onBack()} accessibilityRole="button"><Text style={s.back}>{t.driverApp.back}</Text></Pressable>
        <Text style={s.title}>{t.driverApp.myTasks}</Text>
      </View>
      <FlatList
        contentContainerStyle={{ padding: 16, gap: 12 }}
        data={tasks ?? []}
        keyExtractor={(k) => k.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListHeaderComponent={error ? <Text style={s.error}>{error}</Text> : undefined}
        ListEmptyComponent={tasks ? <Text style={s.muted}>{t.driverApp.noTasks}</Text> : undefined}
        renderItem={({ item: k }) => {
          const mine = k.lines.filter((l) => l.driverId === user.driverId && l.endReason !== "breakdown" && l.endReason !== "driver_change" && l.endReason !== "cancelled");
          return (
            <View style={s.card}>
              <Text style={[s.strong, { fontSize: 16 }]}>{k.title}</Text>
              <Text style={s.muted}>{k.customerName}</Text>
              {k.kind === "trip" && <Text style={s.muted}>{k.fromPlace} ← {k.toPlace}</Text>}
              <Text style={s.muted}>{fmt(k.startsAt)} — {fmt(k.endsAt)}{k.dailyStart ? ` · ${k.dailyStart}–${k.dailyEnd}` : ""}</Text>
              {k.notes && <Text style={s.muted}>{k.notes}</Text>}
              {k.status === "done" && <Text style={s.ok}>{t.driverApp.taskDone}</Text>}
              {mine.map((l) => {
                const queued = done[l.id];
                const canStart = !l.startedAt && !queued;
                const canFinish = (!!l.startedAt || queued === "start") && !l.endedAt && queued !== "finish";
                return (
                  <View key={l.id} style={{ gap: 6, marginTop: 6 }}>
                    <Text style={s.label}>{t.driverApp.vehicle}: {vName(l.vehicleId)}</Text>
                    {l.startOdometer != null && <Text style={s.muted}>{t.driverApp.startedAt}: {l.startOdometer.toLocaleString("en")}</Text>}
                    {queued && <Text style={s.ok}>{t.driverApp.waitingToSend}</Text>}
                    {canStart && (
                      <Pressable style={s.button} onPress={() => setWorking({ task: k, line: l, action: "start" })} accessibilityRole="button" testID={`task-start-${k.id}`}>
                        <Text style={s.buttonText}>{t.driverApp.startTask}</Text>
                      </Pressable>
                    )}
                    {canFinish && (
                      <Pressable style={[s.button, { backgroundColor: colors.ok }]} onPress={() => setWorking({ task: k, line: l, action: "finish" })} accessibilityRole="button" testID={`task-finish-${k.id}`}>
                        <Text style={s.buttonText}>{t.driverApp.finishTask}</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          );
        }}
      />
    </View>
  );
}

function LineScreen({ task, line, action, vehicle, onDone }: { task: Task; line: TaskLine; action: "start" | "finish"; vehicle: Vehicle | null; onDone: (msg?: string) => void }) {
  const [value, setValue] = useState("");
  const [shot, setShot] = useState<MeterShot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const odo = parseInt(value, 10);
    if (!/^\d{1,7}$/.test(value) || !(odo >= 0)) return setError(t.driverApp.invalidNumber);
    if (!shot) return setError(t.driverApp.odometerPhotoRequired);
    if (action === "finish" && line.startOdometer != null && odo < line.startOdometer) return setError(t.driverApp.belowStart);
    setBusy(true);
    try {
      const loc = await shot.where;
      await store.enqueue(
        "task.line",
        { taskId: task.id, lineId: line.id, action, odometer: odo, photoTakenAt: shot.takenAt, location: loc.point, locationStatus: loc.status, ocrValue: shot.ocrValue },
        `${task.title} · ${action === "start" ? t.driverApp.startTask : t.driverApp.finishTask} · ${odo.toLocaleString("en")}`,
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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={s.header}>
        <Pressable onPress={() => onDone()} accessibilityRole="button"><Text style={s.back}>{t.driverApp.back}</Text></Pressable>
        <Text style={s.title}>{action === "start" ? t.driverApp.startTask : t.driverApp.finishTask} · {vehicle?.fleetNumber ?? ""}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={s.strong}>{task.title} — {task.customerName}</Text>
        <MeterCapture last={action === "finish" ? line.startOdometer : null} shot={shot} onShot={setShot} value={value} onValue={setValue} onError={setError} />
        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <Pressable style={[s.button, (busy || !shot) && { opacity: 0.6 }]} onPress={submit} disabled={busy} accessibilityRole="button" testID="submit-task-line">
          <Text style={s.buttonText}>{busy ? t.common.loading : t.driverApp.submit}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
