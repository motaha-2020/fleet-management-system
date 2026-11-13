import * as SecureStore from "expo-secure-store";

/**
 * Small secrets (refresh token, PIN hash, database key) in the OS keystore: Keychain / Android Keystore,
 * readable only while the phone is unlocked and never copied to another device.
 * The web build resolves keystore.web.ts instead (development only, not secure).
 */
const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const keystore = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value, opts),
  delete: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};
