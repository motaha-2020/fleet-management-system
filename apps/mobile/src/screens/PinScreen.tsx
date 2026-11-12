import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_ATTEMPTS, PIN_LENGTH, appLock, pin } from "../pin";
import { session } from "../session";
import { colors, t } from "../theme";

type Mode = "setup" | "unlock";

/**
 * SEC-005 app lock. setup: choose a 6-digit PIN (twice), then optionally turn on fingerprint.
 * unlock: PIN or fingerprint; from the 3rd wrong try the driver is warned; at 5 the phone's session is
 * wiped and a new activation code is needed (unsent items are lost, which the warning says).
 */
export function PinScreen({ mode, onDone }: { mode: Mode; onDone: () => void }) {
  const P = t.driverApp.pin;
  const [digits, setDigits] = useState("");
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState(false);

  const tryBiometric = useCallback(async () => {
    if (await pin.biometric(P.biometricPrompt, P.usePin)) {
      appLock.unlock();
      onDone();
    }
  }, [P, onDone]);

  useEffect(() => {
    if (mode !== "unlock") return;
    void (async () => {
      const on = (await pin.biometricEnabled()) && (await pin.biometricAvailable());
      setBio(on);
      if (on) void tryBiometric();
    })();
  }, [mode, tryBiometric]);

  const finishSetup = async (value: string) => {
    await pin.set(value);
    appLock.unlock();
    if (await pin.biometricAvailable()) {
      Alert.alert(P.biometricOfferTitle, P.biometricOfferBody, [
        { text: P.notNow, style: "cancel", onPress: onDone },
        { text: P.enable, onPress: () => void (async () => { if (await pin.biometric(P.biometricPrompt, P.usePin)) await pin.setBiometric(true); onDone(); })() },
      ]);
    } else onDone();
  };

  const submit = async (value: string) => {
    setBusy(true);
    try {
      if (mode === "setup") {
        if (!first) { setFirst(value); setDigits(""); return; }
        if (value !== first) { setError(P.mismatch); setFirst(null); setDigits(""); return; }
        await finishSetup(value);
        return;
      }
      const r = await pin.verify(value);
      if (r.ok) { appLock.unlock(); onDone(); return; }
      setDigits("");
      if (r.left <= 0) {
        await session.forget();
        Alert.alert(P.wipedTitle, P.wipedBody);
        return;
      }
      setError(r.left <= 2 ? P.lastTries.replace("{n}", String(r.left)) : P.wrong);
    } finally {
      setBusy(false);
    }
  };

  const press = (k: string) => {
    if (busy) return;
    setError(null);
    if (k === "del") return setDigits((d) => d.slice(0, -1));
    const next = (digits + k).slice(0, PIN_LENGTH);
    setDigits(next);
    if (next.length === PIN_LENGTH) void submit(next);
  };

  const title = mode === "unlock" ? P.unlockTitle : first ? P.confirmTitle : P.setupTitle;
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", bio ? "bio" : "", "0", "del"];

  return (
    <View style={s.wrap}>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      {mode === "setup" && !first && <Text style={s.help}>{P.setupHelp}</Text>}
      <View style={s.dots} accessibilityLabel={`${digits.length} / ${PIN_LENGTH}`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => <View key={i} style={[s.dot, i < digits.length && s.dotOn]} />)}
      </View>
      <Text style={[s.error, !error && { opacity: 0 }]} accessibilityRole="alert">{error ?? " "}</Text>
      <View style={s.pad}>
        {keys.map((k, i) => (
          <Pressable key={i} disabled={!k} onPress={() => (k === "bio" ? void tryBiometric() : press(k))} style={({ pressed }) => [s.key, !k && { opacity: 0 }, pressed && s.keyPressed]}
            accessibilityRole="button" accessibilityLabel={k === "del" ? P.delete : k === "bio" ? P.biometricPrompt : k} testID={`pin-${k || "blank"}`}>
            <Text style={s.keyText}>{k === "del" ? "⌫" : k === "bio" ? "☝" : k}</Text>
          </Pressable>
        ))}
      </View>
      {mode === "unlock" && <Text style={s.forgot}>{P.forgot.replace("{n}", String(MAX_ATTEMPTS))}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  title: { fontSize: 22, fontWeight: "700", color: colors.ink, textAlign: "center" },
  help: { fontSize: 14, color: colors.muted, textAlign: "center" },
  dots: { flexDirection: "row", gap: 14, marginTop: 8, direction: "ltr" },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.accent },
  dotOn: { backgroundColor: colors.accent },
  error: { color: colors.bad, fontWeight: "600", minHeight: 20, textAlign: "center" },
  pad: { width: 280, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 14, direction: "ltr" },
  key: { width: 80, height: 64, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  keyPressed: { backgroundColor: colors.accentSoft },
  keyText: { fontSize: 26, fontWeight: "600", color: colors.ink },
  forgot: { fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 8 },
});
