// Default Expo config plus the WebAssembly file expo-sqlite needs in the web development build
// (docs/M3_Offline_Design.md, "Web build"). Native bundles are unaffected.
// No COOP/COEP headers: SharedArrayBuffer is only used by expo-sqlite's synchronous API, which the app never calls.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes("wasm")) config.resolver.assetExts.push("wasm");

module.exports = config;
