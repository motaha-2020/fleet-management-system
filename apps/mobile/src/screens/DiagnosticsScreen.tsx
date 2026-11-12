import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { clock, type ClockReading } from "../clock";
import { cipherVersion, localDb } from "../localdb";
import { colors } from "../theme";

/**
 * M3 spike (docs/M3_Offline_Design.md, build step 0): proves on a real phone that
 * 1) the native monotonic clock keeps counting across app restarts and ignores phone time changes,
 * 2) SQLCipher is linked and fast enough on a low-end device.
 * How to test: open, note the values, close the app, change the phone's time by +3 h,
 * wait a minute, open again: "monotonic elapsed" ≈ 1 min while "wall elapsed" ≈ 3 h.
 */
const LAST = "fleet.spike.last";

type Last = { reading: ClockReading; wall: number };

export function DiagnosticsScreen({ onBack }: { onBack: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const log = (s: string) => setLines((l) => [...l, s]);

  useEffect(() => {
    void (async () => {
      // --- clock ---
      log(`native clock: ${clock.native ? "yes" : "NO (Expo Go / web)"}`);
      const now = clock.read();
      if (now) {
        log(`monotonic: ${Math.round(now.monotonicMs / 1000)} s since boot · bootId ${now.bootId}`);
        const raw = await SecureStore.getItemAsync(LAST);
        if (raw) {
          const last = JSON.parse(raw) as Last;
          const mono = clock.elapsedSince(last.reading);
          log(`since last launch → monotonic: ${mono === null ? "unknown (rebooted)" : fmt(mono)} · wall: ${fmt(Date.now() - last.wall)}`);
        } else {
          log("first launch: close the app, change the phone time, reopen");
        }
        await SecureStore.setItemAsync(LAST, JSON.stringify({ reading: now, wall: Date.now() } satisfies Last));
      }

      // --- SQLCipher ---
      try {
        const db = await localDb("spike.db");
        const v = await cipherVersion(db);
        log(`SQLCipher: ${v ? `yes (${v})` : "NO — database is NOT encrypted"}`);
        await db.execAsync("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);");
        const payload = JSON.stringify({ vehicleId: "0193", odometer: 123456, quantity: 40.5, amountMinor: 52000, note: "x".repeat(200) });
        const t0 = Date.now();
        await db.withTransactionAsync(async () => {
          for (let i = 0; i < 1000; i++) await db.runAsync("INSERT INTO t (payload) VALUES (?)", payload);
        });
        const t1 = Date.now();
        const row = await db.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM t");
        const t2 = Date.now();
        log(`1000 inserts: ${t1 - t0} ms · count(${row?.n}): ${t2 - t1} ms`);
        await db.execAsync("DELETE FROM t;");
      } catch (e) {
        log(`SQLCipher error: ${(e as Error).message}`);
      }
    })();
  }, []);

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>M3 spike</Text>
      {lines.map((l, i) => <Text key={i} style={s.line} selectable>{l}</Text>)}
      <View style={{ height: 16 }} />
      <Pressable style={s.btn} onPress={onBack}><Text style={s.btnText}>رجوع</Text></Pressable>
    </ScrollView>
  );
}

function fmt(ms: number) {
  const m = Math.round(ms / 60000);
  return m < 120 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 8 },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink },
  line: { fontSize: 14, color: colors.ink, writingDirection: "ltr", textAlign: "left", fontFamily: "monospace" },
  btn: { backgroundColor: colors.accent, padding: 14, borderRadius: 10, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
});
