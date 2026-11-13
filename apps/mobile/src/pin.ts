import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import { keystore } from "./keystore";

/**
 * App lock (SEC-005, US-E02 "open the app with PIN/Biometric", works offline):
 *  - a 6-digit PIN, stored only as SHA-256(salt + PIN) in the OS keystore; brute force is bounded by the
 *    attempt limit, and the keystore itself is hardware-protected (web, development only: localStorage)
 *  - 5 wrong attempts wipe the phone's session (a new activation code is needed); warnings from attempt 3
 *  - fingerprint / face as a faster way in when the phone has it enrolled
 *  - locks on launch and after 5 minutes in the background
 */
export const PIN_LENGTH = 6;
export const MAX_ATTEMPTS = 5;
const LOCK_AFTER_MS = 5 * 60_000;

const K = { hash: "fleet.pin.hash", salt: "fleet.pin.salt", attempts: "fleet.pin.attempts", bio: "fleet.pin.biometric" };

async function hashPin(pin: string, salt: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const pin = {
  async isSet() {
    return !!(await keystore.get(K.hash));
  },
  async set(value: string) {
    const salt = hex(Crypto.getRandomBytes(16));
    await keystore.set(K.salt, salt);
    await keystore.set(K.hash, await hashPin(value, salt));
    await keystore.set(K.attempts, "0");
  },
  /** ok, or how many attempts are left; at 0 the caller must wipe the session. */
  async verify(value: string): Promise<{ ok: true } | { ok: false; left: number }> {
    const [hash, salt] = await Promise.all([keystore.get(K.hash), keystore.get(K.salt)]);
    if (!hash || !salt) return { ok: false, left: 0 };
    if ((await hashPin(value, salt)) === hash) {
      await keystore.set(K.attempts, "0");
      return { ok: true };
    }
    const used = Number((await keystore.get(K.attempts)) ?? "0") + 1;
    await keystore.set(K.attempts, String(used));
    return { ok: false, left: Math.max(0, MAX_ATTEMPTS - used) };
  },
  async attemptsLeft() {
    return Math.max(0, MAX_ATTEMPTS - Number((await keystore.get(K.attempts)) ?? "0"));
  },
  async clear() {
    await Promise.all(Object.values(K).map((k) => keystore.delete(k).catch(() => {})));
  },

  // ---------------- fingerprint / face ----------------
  async biometricAvailable() {
    try {
      return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    } catch {
      return false;
    }
  },
  async biometricEnabled() {
    return (await keystore.get(K.bio)) === "1";
  },
  async setBiometric(on: boolean) {
    await keystore.set(K.bio, on ? "1" : "0");
  },
  /** Prompts for fingerprint/face. The PIN stays the fallback, so the system's own PIN fallback is off. */
  async biometric(prompt: string, cancel: string): Promise<boolean> {
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: cancel, disableDeviceFallback: true });
      if (r.success) await keystore.set(K.attempts, "0");
      return r.success;
    } catch {
      return false;
    }
  },
};

/** Locks on launch and when the app returns after LOCK_AFTER_MS in the background. */
class AppLock {
  private locked = true;
  private hiddenAt: number | null = null;
  private listeners = new Set<(locked: boolean) => void>();
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    AppState.addEventListener("change", (s) => {
      if (s === "background") this.hiddenAt = Date.now();
      if (s === "active" && this.hiddenAt && Date.now() - this.hiddenAt > LOCK_AFTER_MS) this.set(true);
      if (s === "active") this.hiddenAt = null;
    });
  }
  get isLocked() { return this.locked; }
  unlock() { this.set(false); }
  lock() { this.set(true); }
  subscribe(l: (locked: boolean) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  private set(v: boolean) {
    this.locked = v;
    for (const l of this.listeners) l(v);
  }
}
export const appLock = new AppLock();
