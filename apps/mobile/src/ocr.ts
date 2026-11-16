/**
 * Owner decision (14 Nov 2026): read the number from the meter photo on the phone (no internet needed); the driver
 * confirms or corrects it, and what the phone read is sent too, so the approver sees "matches the photo" or not.
 *
 * The text recognizer is a native module (expo-text-extractor: ML Kit on Android). It is loaded lazily so an app
 * update that arrives over the air before the new APK still works: without the module, nothing is read and the
 * driver types the number as before.
 */
type Extractor = { isSupported: boolean; extractTextFromImage: (uri: string) => Promise<string[]> };
let extractor: Extractor | null | undefined;

function load(): Extractor | null {
  if (extractor !== undefined) return extractor;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("expo-text-extractor") as Extractor;
    extractor = m.isSupported ? m : null;
  } catch {
    extractor = null;
  }
  return extractor;
}

export const ocrAvailable = () => !!load();

/**
 * The odometer value read from the photo, or null. Meter photos show other numbers too (trip, clock, temperature),
 * so the candidates are runs of 3–7 digits; the best one is the closest at or above the last known reading, else the
 * longest.
 */
export async function readMeter(uri: string, last: number | null): Promise<number | null> {
  const ex = load();
  if (!ex) return null;
  try {
    const lines = await ex.extractTextFromImage(uri);
    const found = lines.flatMap((l) => (l.replace(/[Oo]/g, "0").replace(/[\s.,]/g, "").match(/\d{3,7}/g) ?? [])).map((d) => parseInt(d, 10));
    return pickReading(found, last);
  } catch {
    return null;
  }
}

export function pickReading(candidates: number[], last: number | null): number | null {
  const ok = candidates.filter((n) => Number.isFinite(n) && n >= 0);
  if (!ok.length) return null;
  if (last != null) {
    const ahead = ok.filter((n) => n >= last && n - last < 5_000).sort((a, b) => a - b);
    if (ahead.length) return ahead[0]!;
  }
  return ok.sort((a, b) => String(b).length - String(a).length || b - a)[0]!;
}
