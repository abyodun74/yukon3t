// One-time setup script — NOT meant to be re-run once the ShareExtension
// target exists in ios/App/App.xcodeproj/project.pbxproj (running it twice
// would create a second, duplicate target). Registers the app extension
// target for ios/App/ShareExtension/ (see ios/SHARE_EXTENSION_PLAN.md and
// ShareViewController.swift's own doc comment for what it does) using the
// `xcode` npm package — the same library Capacitor's own CLI uses to edit
// this file — rather than hand-editing the generated .pbxproj format
// directly, which CLAUDE.md flags as fragile/error-prone to do by hand.
//
// Usage: node scripts/add-ios-share-extension-target.mjs
// Afterwards: open the project in Xcode on a Mac (or run a Codemagic build)
// to verify it actually compiles and signs — this script gets the target
// wired up correctly in the project graph, but nothing in this repo can
// run xcodebuild to confirm it end to end without a Mac.
import xcode from "xcode";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pbxprojPath = path.join(repoRoot, "ios", "App", "App.xcodeproj", "project.pbxproj");

const project = xcode.project(pbxprojPath);
project.parseSync();

const TARGET_NAME = "ShareExtension";
const BUNDLE_ID = "com.yukon3t.app.ShareExtension";
const DEVELOPMENT_TEAM = "3465L6ZHRJ"; // same team as the App target — see project.pbxproj
const DEPLOYMENT_TARGET = "15.0"; // matches the App target's IPHONEOS_DEPLOYMENT_TARGET

if (project.pbxTargetByName(`"${TARGET_NAME}"`)) {
  console.log(`"${TARGET_NAME}" target already exists — nothing to do. Delete it in Xcode first if you need to re-run this.`);
  process.exit(0);
}

// This library's addTargetDependency (called internally by addTarget,
// below) silently no-ops — adding neither a PBXTargetDependency nor a
// PBXContainerItemProxy, and leaving App's own `dependencies` array empty —
// on a project that has never had more than one target before, because it
// only populates those two sections when they already exist (confirmed by
// reading its source; this project had a single target and neither section
// until now). Pre-creating them empty is enough for its own logic to fill
// them in correctly.
project.hash.project.objects.PBXTargetDependency ??= {};
project.hash.project.objects.PBXContainerItemProxy ??= {};

// Creates: the PBXNativeTarget itself, its product (.appex) file reference,
// its own Debug/Release XCBuildConfigurations (with INFOPLIST_FILE already
// pointed at ShareExtension/ShareExtension-Info.plist, matching this
// script's naming convention, and PRODUCT_BUNDLE_IDENTIFIER from BUNDLE_ID),
// the App target's "Copy Files"/Embed-App-Extensions build phase + this
// product's membership in it, and a PBXTargetDependency from App onto this
// new target — see addTarget's own source for the exact mechanics.
const target = project.addTarget(TARGET_NAME, "app_extension", TARGET_NAME, BUNDLE_ID);

// addTarget does NOT create Sources/Resources/Frameworks build phases for
// the *new* target itself (only the host target's embed phase) — without
// these, there's nowhere to attach ShareViewController.swift or any future
// resource, and Xcode would show the target as having no build phases.
project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

// Info.plist and the entitlements file are referenced only via build
// settings (INFOPLIST_FILE / CODE_SIGN_ENTITLEMENTS below), never added to
// a build phase — Xcode errors ("Multiple commands produce Info.plist") if
// Info.plist itself is also listed as a build phase member. addPbxGroup
// still creates real PBXFileReference entries for both so they show up
// under the new group in Xcode's navigator.
const group = project.addPbxGroup(
  [`${TARGET_NAME}-Info.plist`, `${TARGET_NAME}.entitlements`],
  TARGET_NAME,
  TARGET_NAME,
);

// addPbxGroup registers the group in the project's objects hash but does
// NOT attach it under the main group itself — do that by hand, the same
// child shape addPbxGroup uses internally (pbxGroupChild).
const mainGroup = project.getPBXGroupByKey(project.getFirstProject().firstProject.mainGroup);
mainGroup.children.push({ value: group.uuid, comment: TARGET_NAME });

// Creates its own PBXFileReference (this file was deliberately left out of
// the addPbxGroup call above, since a file already present in the file
// reference section there would make this call a silent no-op instead of
// actually wiring up the Sources build phase membership this needs).
project.addSourceFile("ShareViewController.swift", { target: target.uuid }, group.uuid);

// Per-config build settings addTarget doesn't set on its own: the
// entitlements path, matching the App target's signing team/deployment
// target/Swift version/device family, and automatic signing (so
// Codemagic's `xcode-project use-profiles` step picks this target up the
// same way it already does for App — see codemagic.yaml).
const nativeTarget = project.pbxNativeTargetSection()[target.uuid];
const configListUuid = nativeTarget.buildConfigurationList;
const configList = project.pbxXCConfigurationList()[configListUuid];
const buildConfigSection = project.pbxXCBuildConfigurationSection();
for (const { value: configUuid } of configList.buildConfigurations) {
  const settings = buildConfigSection[configUuid].buildSettings;
  Object.assign(settings, {
    CODE_SIGN_ENTITLEMENTS: `${TARGET_NAME}/${TARGET_NAME}.entitlements`,
    CODE_SIGN_STYLE: "Automatic",
    DEVELOPMENT_TEAM,
    IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
    SWIFT_VERSION: "5.0",
    TARGETED_DEVICE_FAMILY: '"1,2"',
  });
  // addTarget builds INFOPLIST_FILE via Node's path.join(targetSubfolder,
  // ...) — on this Windows dev machine that emits a backslash separator
  // ("ShareExtension\ShareExtension-Info.plist"), which isn't a valid path
  // separator in an Xcode build setting and would fail to resolve the file
  // at all on the Mac that actually builds this (Codemagic). Same class of
  // bug as the Capacitor Swift Package Manifest one CLAUDE.md already
  // documents for `npx cap sync ios` on Windows — normalize it here too.
  if (typeof settings.INFOPLIST_FILE === "string") {
    settings.INFOPLIST_FILE = settings.INFOPLIST_FILE.replace(/\\/g, "/");
  }
}
project.addTargetAttribute("ProvisioningStyle", "Automatic", target);
project.addTargetAttribute("DevelopmentTeam", DEVELOPMENT_TEAM, target);

// writeSync() only serializes and RETURNS the new file contents — it does
// not touch disk itself, unlike parseSync() reading from this.filepath.
fs.writeFileSync(pbxprojPath, project.writeSync());
console.log(`Added "${TARGET_NAME}" app extension target (uuid ${target.uuid}) to project.pbxproj.`);
