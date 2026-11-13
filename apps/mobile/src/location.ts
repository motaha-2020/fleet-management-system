import * as Location from "expo-location";
import { ensureConsent } from "./consent";

export type GeoFix = { lat: number; lng: number; accuracyM: number | null };
export type LocationResult = { status: "ok"; point: GeoFix } | { status: "denied" | "unavailable"; point: null };

/**
 * Where the phone is now, for the odometer photo (owner decision, 13 Nov 2026). Asked only while recording a
 * reading, never in the background. "No" or no fix (indoors, GPS off) does not block the reading: it is sent as
 * denied / unavailable. A recent last-known position is used when a fresh fix is slow.
 */
export async function currentLocation(timeoutMs = 10_000): Promise<LocationResult> {
  try {
    if (!(await ensureConsent("location"))) return { status: "denied", point: null };
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { status: "denied", point: null };
    if (!(await Location.hasServicesEnabledAsync())) return { status: "unavailable", point: null };
    const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const pos = (await Promise.race([fresh, timeout])) ?? (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }));
    if (!pos) return { status: "unavailable", point: null };
    return { status: "ok", point: { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude), accuracyM: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null } };
  } catch {
    return { status: "unavailable", point: null };
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
