/**
 * The web build exists only to drive the app in a browser during development (Playwright, quick UI work).
 * It has no keystore, no SQLCipher and no hardware device key, so a production web bundle is refused.
 * See docs/M3_Offline_Design.md, "Web build (development only)".
 */
let warned = false;
export function assertDevWeb() {
  if (!__DEV__) throw new Error("The Fleet Driver web build is for development only and is not secure.");
  if (!warned) {
    warned = true;
    console.warn("[fleet] Web development build: secrets in localStorage, local database NOT encrypted. Do not use with real data.");
  }
}
