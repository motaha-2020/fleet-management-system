import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Device-bound refresh token lives in the OS keystore (Keychain / Android Keystore).
 * The web build (for development only) falls back to localStorage.
 */
const KEY = "fleet.refresh";
const web = Platform.OS === "web";

export async function saveRefreshToken(token: string) {
  if (web) localStorage.setItem(KEY, token);
  else await SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function loadRefreshToken(): Promise<string | null> {
  return web ? localStorage.getItem(KEY) : SecureStore.getItemAsync(KEY);
}
export async function clearRefreshToken() {
  if (web) localStorage.removeItem(KEY);
  else await SecureStore.deleteItemAsync(KEY);
}
