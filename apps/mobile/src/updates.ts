import { useEffect, useState } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

/**
 * Over-the-air updates (EAS Update): JavaScript changes reach installed apps without a new APK.
 * A new build is only needed when native code changes (runtimeVersion "fingerprint" keeps an update
 * from reaching a build it does not fit).
 *
 * The app checks on launch and whenever it returns to the foreground, downloads in the background, and
 * offers a restart; it never restarts by itself in the middle of a form. Offline it simply does nothing.
 */
export function useAppUpdate() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!Updates.isEnabled) return; // development / Expo Go
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await Updates.checkForUpdateAsync();
        if (r.isAvailable) {
          await Updates.fetchUpdateAsync();
          setReady(true);
        }
      } catch {
        // no connection or update server unreachable: try again next time
      } finally {
        busy = false;
      }
    };
    void check();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void check(); });
    return () => sub.remove();
  }, []);

  return { ready, apply: () => Updates.reloadAsync() };
}
