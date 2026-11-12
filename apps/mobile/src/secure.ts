import { keystore } from "./keystore";

/**
 * Device-bound refresh token lives in the OS keystore (Keychain / Android Keystore).
 * The web build (for development only) uses keystore.web.ts, which is localStorage.
 */
const KEY = "fleet.refresh";

export const saveRefreshToken = (token: string) => keystore.set(KEY, token);
export const loadRefreshToken = (): Promise<string | null> => keystore.get(KEY);
export const clearRefreshToken = () => keystore.delete(KEY);
