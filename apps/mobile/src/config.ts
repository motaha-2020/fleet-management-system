import Constants from "expo-constants";

/**
 * API base URL. Set EXPO_PUBLIC_API_URL for a device on the LAN (e.g. http://192.168.1.10:4000);
 * an Android emulator reaches the host at http://10.0.2.2:4000.
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "http://localhost:4000";
