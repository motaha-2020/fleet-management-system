import { Alert } from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { uuidv7 } from "@fleet/domain";
import { store } from "./store";
import { t } from "./theme";

export const appVersion = () => Constants.expoConfig?.version ?? null;

/**
 * PRV-002 / US-E19-04: before the OS permission prompt, the app explains why it needs the permission and records
 * the driver's decision (kept locally, sent with the next sync). A "no" only disables what needs the permission:
 * the driver can still choose a photo from the gallery or record without one.
 */
export async function ensureConsent(kind: "camera" | "photos" | "location"): Promise<boolean> {
  const prev = await store.getConsent(kind);
  if (prev?.decision === "granted") return true;
  const C = t.m6.consent;
  const decision = await new Promise<"granted" | "denied">((resolve) => {
    Alert.alert(C.title[kind], C.body[kind], [
      { text: C.deny, style: "cancel", onPress: () => resolve("denied") },
      { text: C.allow, onPress: () => resolve("granted") },
    ], { cancelable: false });
  });
  const id = uuidv7(Date.now(), Crypto.getRandomBytes(10));
  await store.setConsent(kind, { id, decision, at: new Date().toISOString() });
  return decision === "granted";
}
