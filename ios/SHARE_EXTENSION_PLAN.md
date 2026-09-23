# iOS Share Extension — status

Android's "Share to YuKon3t" target (SEND/SEND_MULTIPLE intent-filters in
`AndroidManifest.xml`, `ShareReceiverPlugin.java`, and the JS side —
`src/lib/share-receiver.ts`, `src/components/share-target-gate.tsx`) now has
an iOS counterpart, built entirely from this repo (no Xcode/Mac needed for
this part):

- `ios/App/ShareExtension/` — the extension target's own files:
  `ShareViewController.swift` (reads whatever the OS handed over — image(s),
  a movie, plain text, or a URL — and writes it into a shared App Group
  container), `ShareExtension-Info.plist` (declares which content types
  activate it, mirroring Android's `image/*`/`video/*`/`text/plain`), and
  `ShareExtension.entitlements` (the App Group).
- `ios/App/App/ShareReceiverPlugin.swift` + `.m` — the main app's own
  Capacitor plugin, registered under the exact same `"ShareReceiver"` /
  `getPendingShare()` name Android's plugin uses, so
  `src/lib/share-receiver.ts`'s `checkForPendingShare()` needs only a
  platform check, not two different code paths. Reads the App Group
  container the extension wrote to, then deletes it — consumed exactly
  once, same contract as the Android plugin.
- `ios/App/App/App.entitlements` — same App Group added to the main target
  too (both sides of the hand-off need it).
- `ios/App/App/Info.plist` — registers the `yukon3t://` URL scheme, which
  `ShareViewController.swift` opens via `extensionContext.open(...)` (the
  sanctioned way for a Share Extension to bring its host app to the
  foreground — there's no `UIApplication` inside an extension to call
  `openURL` on directly).
- `scripts/fix-ios-package-class-list.mjs` — `ShareReceiverPlugin` added to
  `LOCAL_PLUGIN_CLASSES`, so `npm run cap:sync:ios` keeps registering it in
  `capacitor.config.json`'s `packageClassList` the way it already does for
  `ScreenCaptureGuardPlugin`/`NativeCallKitPlugin` (see CLAUDE.md's
  "packageClassList gotcha").
- **The Xcode project target itself is registered** —
  `ios/App/App.xcodeproj/project.pbxproj` now has a `ShareExtension` app
  extension target (product type `com.apple.product-type.app-extension`),
  wired up via `scripts/add-ios-share-extension-target.mjs`, which used the
  `xcode` npm package (the same library `@capacitor/cli` itself uses to edit
  this file) rather than hand-editing the format directly. It's already run
  once — the target, its Sources/Resources/Frameworks build phases, the
  App target's "Copy Files" (Embed App Extensions) phase + dependency on it,
  and all the relevant build settings (bundle id
  `com.yukon3t.app.ShareExtension`, entitlements path, matching team/
  deployment target/Swift version) are all committed. **Don't re-run that
  script** — it has no update path, only a "does this target already exist"
  guard, and running it again would create a duplicate target.
  - Two real bugs in that library surfaced and were worked around in the
    script (both documented inline there): `addTargetDependency` silently
    no-ops on a project that never had more than one target before (the
    two sections it needs don't exist yet — the script pre-creates them
    empty), and `addTarget`'s `INFOPLIST_FILE` value is built with Node's
    `path.join`, which emits a **backslash** on this Windows dev machine —
    not a valid Xcode path separator — so the script normalizes it back to
    `/` afterward. Confirmed by re-parsing the written file with the same
    library multiple times and inspecting the object graph (target
    dependencies, build phases, group membership, build settings) — see
    that script's own comments for the exact checks. This is as much
    verification as is possible without a Mac.

## What still needs a person with Apple Developer Portal / Xcode access

None of this needs hand-editing the `.xcodeproj` anymore — it's just
account-level configuration Codemagic's automatic signing depends on:

1. **Register the App Group.** In Xcode (`ios/SUBMISSION.md` step 3) or
   directly in the [Apple Developer
   portal](https://developer.apple.com/account) → Identifiers → App Groups,
   create `group.com.yukon3t.app.share` and associate it with both the
   `com.yukon3t.app` and `com.yukon3t.app.ShareExtension` App IDs. Both
   entitlements files in this repo already reference this exact group id.
2. **Register the ShareExtension App ID** (`com.yukon3t.app.ShareExtension`)
   if it doesn't already exist as a byproduct of step 1 — same portal
   section, Identifiers → App IDs.
3. **A Codemagic run.** `codemagic.yaml`'s existing `ios-testflight`
   workflow builds the whole scheme, which now includes ShareExtension —
   `xcode-project use-profiles` should pick up a matching profile for it
   automatically via the App Store Connect integration once steps 1–2 are
   done, the same way it already does for the App target. This is also the
   first real compile-and-sign check this new target gets, since nothing in
   this dev environment can run `xcodebuild`.
4. **Standard native-release rules still apply**: per the standing hold on
   native builds/releases (see the project's own memory on this), don't
   trigger that Codemagic run or submit a build until asked — this doc and
   the committed source are enough to have the feature *ready*, not shipped.

## What happens once it reaches a device

Tapping "Share" in Photos/Instagram/TikTok/WhatsApp/etc. and choosing
YuKon3t opens `ShareViewController`'s brief "Sharing…" spinner, which reads
the shared item(s), writes them into the App Group container, then hands off
to the main app — which shows the exact same `ShareTargetGate` picker
(Story / Muse / Feed / a friend) Android already gets, since that component
and everything downstream of it (`share-target-store.ts`, the upload/
publish flows) was already platform-agnostic — only `share-receiver.ts`'s
platform check needed to widen from Android-only to Android-or-iOS, which
it now does.
