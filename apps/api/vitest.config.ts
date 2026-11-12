import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Nest's DI needs decorator metadata, which esbuild does not emit; SWC does.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
