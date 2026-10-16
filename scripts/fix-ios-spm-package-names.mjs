// `npx cap sync ios` generates ios/App/CapApp-SPM/Package.swift with each
// npm Capacitor plugin referenced as a local path package, e.g.
//   .package(name: "CapacitorFirebaseAppCheck",
//            path: "../../../node_modules/@capacitor-firebase/app-check")
// SwiftPM derives a local package's identity from the LAST PATH COMPONENT
// of that path ("app-check"); the `name:` argument is ignored for identity.
// firebase-ios-sdk depends on the remote google/app-check package, whose
// identity is also "app-check", so the local plugin shadows it and
// `xcodebuild -resolvePackageDependencies` fails with "product 'AppCheckCore'
// ... not found in package 'app-check'". The fix is to copy the (already
// patched) plugin to a directory whose name is not a colliding identity and
// point the manifest there. Run after every cap sync via
// `npm run cap:sync:ios`; see CLAUDE.md's "Native iOS plugins" section.
//
// It also normalizes backslashes inside `path: "..."` strings, which the
// Capacitor CLI writes on Windows (Swift only accepts `/`).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Add another entry here if a future plugin's directory name equals the
// remote package identity of one of its own dependencies.
const RENAMES = [
  {
    name: "CapacitorFirebaseAppCheck",
    from: "node_modules/@capacitor-firebase/app-check",
    to: "ios/App/LocalPackages/CapacitorFirebaseAppCheck",
    // Path as written in ios/App/CapApp-SPM/Package.swift (relative to it).
    originalPath: "../../../node_modules/@capacitor-firebase/app-check",
    newPath: "../LocalPackages/CapacitorFirebaseAppCheck",
  },
];

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "ios", "App", "CapApp-SPM", "Package.swift");

let manifest = readFileSync(manifestPath, "utf8");

// Backslash normalization, only inside path: "..." strings.
manifest = manifest.replace(/path:\s*"([^"]*)"/g, (m, p) => m.replace(p, p.replaceAll(String.fromCharCode(92), "/")));

let failed = false;
for (const r of RENAMES) {
  const src = path.join(root, r.from);
  const dest = path.join(root, r.to);
  if (!existsSync(src)) {
    console.error(`Missing plugin source: ${r.from} (run npm install)`);
    failed = true;
    continue;
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(path.join(src, "Package.swift"), path.join(dest, "Package.swift"));
  cpSync(path.join(src, "ios"), path.join(dest, "ios"), { recursive: true });

  const re = (p) => `.package(name: "${r.name}", path: "${p}")`;
  if (manifest.includes(re(r.newPath))) {
    console.log(`${r.name}: manifest already points at ${r.newPath}`);
  } else if (manifest.includes(re(r.originalPath))) {
    manifest = manifest.replace(re(r.originalPath), re(r.newPath));
    console.log(`${r.name}: manifest rewritten to ${r.newPath}`);
  } else {
    console.error(`${r.name}: .package(name: "${r.name}", path: ...) line not found in ${manifestPath}`);
    failed = true;
  }
}

writeFileSync(manifestPath, manifest);
if (failed) process.exit(1);
