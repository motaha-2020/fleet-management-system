import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { session } from "./session";
import { store } from "./store";
import { ensureConsent } from "./consent";

/**
 * NTF-001 mobile push. Alerts addressed to the driver (e.g. a rejected defect report) arrive as a notification;
 * opening it, or receiving it while the app is open, refreshes the in-app notices through a sync round.
 * Registration: explain first (PRV-002), then the OS prompt, then the Expo push token goes to the server for
 * this activated device. Web and simulators have no push.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let started = false;

export async function startPush(onAlert: () => void): Promise<() => void> {
  const subs = [
    Notifications.addNotificationReceivedListener(() => onAlert()),
    Notifications.addNotificationResponseReceivedListener(() => onAlert()),
  ];
  const off = () => subs.forEach((s) => s.remove());
  if (started || Platform.OS === "web" || !Device.isDevice) return off;
  started = true;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("alerts", { name: "Alerts", importance: Notifications.AndroidImportance.HIGH });
    }
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain && (await ensureConsent("notifications"))) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return off;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if ((await store.getPushToken()) !== token) {
      await session.api.call("registerPushToken", { body: { token } });
      await store.setPushToken(token);
    }
  } catch (e) {
    // Next start tries again; push is a convenience, the in-app notices still arrive with sync.
    started = false;
    console.warn("push registration failed", (e as Error).message);
  }
  return off;
}

/** Before signing out: this device should stop receiving pushes for this driver. */
export async function stopPush() {
  if (Platform.OS === "web") return;
  await session.api.call("registerPushToken", { body: { token: null } }).catch(() => {});
  await store.setPushToken(null);
  started = false;
}
