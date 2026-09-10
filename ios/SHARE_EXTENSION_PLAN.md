# iOS Share Extension — plan (not yet built)

Android now has a working "Share to YuKon3t" target (see
`android/app/src/main/AndroidManifest.xml`'s SEND/SEND_MULTIPLE
intent-filters, `ShareReceiverPlugin.java`, and the JS side —
`src/lib/share-receiver.ts`, `src/lib/share-target-store.ts`,
`src/components/share-target-gate.tsx`). iOS needs the equivalent, but it's
a meaningfully bigger lift than Android's manifest change: it requires a
**separate Xcode target** — something that can't be done safely by hand-
editing text files the way `AndroidManifest.xml`/Gradle files can (the
`.xcodeproj` is a generated, fragile format; this needs to be done in Xcode
itself, on a Mac, same prerequisite as the rest of `ios/SUBMISSION.md`).

## Why this is bigger than Android's version

Android's share target runs *inside* the same app process that's already
running — `MainActivity` just gets handed a different `Intent`. iOS Share
Extensions are a **separate mini-app** with their own process, memory limit
(~120MB, much tighter than the main app), and lifecycle — they can't reach
into the main app's WebView or JS runtime directly at all. The only way
data crosses between them is a shared **App Group** container on disk.

## What it takes

1. **New target in Xcode**: File → New → Target → Share Extension, added to
   the same `App.xcworkspace`. Gets its own `Info.plist` with an
   `NSExtension` dict declaring `NSExtensionActivationRule` (which content
   types it accepts — images, movies, plain text, matching the Android
   intent-filters' `image/*`/`video/*`/`text/plain`).
2. **App Group entitlement**: both the main app target and the new
   extension target need the same App Group ID (e.g.
   `group.com.yukon3t.app.share`) added under Signing & Capabilities. This
   is also an Apple Developer Portal change (registering the App Group ID
   against this app's bundle ID), not just an Xcode setting.
3. **Extension UI**: a minimal SwiftUI/UIKit share sheet — doesn't need to
   look like the full app, just needs to read the shared item(s) via
   `NSExtensionItem`/`NSItemProvider`, write them into the App Group's
   shared container (`FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)`)
   as files (not the Android plugin's base64-over-the-bridge approach —
   there's no bridge to cross here, so writing real files is both simpler
   and doesn't have that approach's memory-doubling problem), and call
   `completeRequest` to dismiss.
4. **Main app pickup**: `capacitor-bridge.tsx`'s native-launch wiring (or a
   new small native plugin, mirroring `ShareReceiverPlugin.java`) checks the
   same App Group container on launch/resume, and if there's a pending
   share, hands it to `ShareTargetGate.tsx` the same way the Android path
   does — that component and everything downstream of it
   (`share-target-store.ts`, the `PostComposer`/`ChatThread` pickup effects)
   is already platform-agnostic and needs no changes for iOS. Only
   `share-receiver.ts`'s `checkForPendingShare()` needs an iOS branch
   alongside its existing Android one.
5. **Provisioning**: the extension needs its own entry in whatever
   provisioning profile/signing setup `ios/SUBMISSION.md` already walks
   through for the main app — one more thing to configure in App Store
   Connect before a build with this can be archived.

## Suggested order, when picked up

Steps 1–3 are pure Xcode/Swift work with no dependency on this repo's web
code. Step 4 only needs `share-receiver.ts`'s existing `isAndroid()` check
generalized to branch on `Capacitor.getPlatform()` — everything else in the
share-target flow already reads through that one function's return value,
so it should be a small, contained change once the native side exists.
