// `npx cap sync ios` regenerates ios/App/App/capacitor.config.json's
// packageClassList purely from npm-installed @capacitor/* packages' own
// iOS source files (see node_modules/@capacitor/cli/dist/util/iosplugin.js)
// — it has no notion of this app's own local, non-npm plugins
// (ScreenCaptureGuardPlugin, NativeCallKitPlugin, both declared directly in
// ios/App/App/ via the classic CAP_PLUGIN macro). Capacitor iOS refuses to
// call a plugin not listed there at all ("plugin is not implemented on
// ios"), so every sync silently breaks both of these until this list is
// patched back in. See CLAUDE.md's "Native iOS plugins" section for the
// full story; this script is what makes that fix durable instead of a
// manual step someone has to remember after every `cap sync ios`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const LOCAL_PLUGIN_CLASSES = ["ScreenCaptureGuardPlugin", "NativeCallKitPlugin", "ShareReceiverPlugin"];

const configPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "ios",
  "App",
  "App",
  "capacitor.config.json",
);

const config = JSON.parse(readFileSync(configPath, "utf8"));
const existing = new Set(config.packageClassList ?? []);
let changed = false;
for (const className of LOCAL_PLUGIN_CLASSES) {
  if (!existing.has(className)) {
    existing.add(className);
    changed = true;
  }
}

if (changed) {
  config.packageClassList = Array.from(existing);
  writeFileSync(configPath, JSON.stringify(config, null, "\t") + "\n");
  console.log(`Added missing local plugin classes to packageClassList: ${LOCAL_PLUGIN_CLASSES.join(", ")}`);
} else {
  console.log("packageClassList already includes all local plugin classes.");
}
