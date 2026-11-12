// Publishes an over-the-air update to the channel of an EAS build profile, with that profile's env.
//   pnpm --filter @fleet/mobile update:staging -- "what changed"
// EXPO_PUBLIC_* values are baked into the bundle, so an update must be built with the same API URL as the
// installed app. Taking them from eas.json keeps the two from drifting apart.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const profile = process.argv[2];
const message = process.argv.slice(3).filter((a) => a !== "--").join(" ") || `update ${new Date().toISOString()}`;
const eas = JSON.parse(readFileSync(new URL("../eas.json", import.meta.url), "utf8"));
const p = eas.build[profile];
if (!p?.channel) {
  console.error(`No build profile "${profile}" with a channel in eas.json`);
  process.exit(2);
}
console.log(`Publishing to channel "${p.channel}" with ${JSON.stringify(p.env ?? {})}`);
const r = spawnSync("eas", ["update", "--channel", p.channel, "--message", message, "--non-interactive"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...(p.env ?? {}) },
});
process.exit(r.status ?? 1);
