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

Tapping "Share" in Photos (or on a fresh screenshot) / WhatsApp / etc. and
choosing YuKon3t opens `ShareViewController`'s brief "Sharing…" spinner,
which copies the shared item(s) into the App Group container (images and
videos through `loadFileRepresentation`, falling back to the raw data, a
`UIImage`, then `loadItem`; links and text through `loadObject`; at most 10
attachments, in the order they were picked). It then asks the system to open `yukon3t://share`. **Apple only
honours `NSExtensionContext.open` for Today and iMessage extensions**, so for
a Share extension that normally answers `false`; the extension then shows
"Saved. Open YuKon3t to choose where to share it." (in the app's five
languages) instead of silently finishing. No private-API workaround is used
(App Review risk). The main app's `ShareTargetGate` reads the App Group on
launch and on every resume, so the picker (Story / Muse / Home Feed / a
Circle / up to 5 chats) appears as soon as YuKon3t comes forward.

`ios/App/App/ShareReceiverPlugin.swift` + `.m` were on disk but **not in the
App target's Sources build phase** until 2026-11-08 (no iOS build before
that could read a share, whatever the App Group state); they are now listed
in `project.pbxproj` the same way `ScreenCaptureGuardPlugin` is.

## How the app reads the shared files (fixed 2026-11-09)

Build 1.2 (5) moved the files into the app's tmp directory but the page then
tried `fetch(Capacitor.convertFileSrc(path))`, which only works on Android.
On iOS the WebView shows `https://yukon3t.com` (`server.url`), and
convertFileSrc gives `capacitor://localhost/_capacitor_file_/...`: another
origin, not in the site's CSP `connect-src`, and served by Capacitor's
`WebViewAssetHandler` without CORS headers for video (`mov`/`mp4`/`m4v`
answer with a bare `URLResponse`). Every file failed to load. Now
`getPendingShare` returns an opaque `id` + `size` per file and the page reads
it with `readPendingFile({ id, offset, length })` in 2MB base64 chunks
(`src/lib/share-receiver-read.ts`); the plugin only resolves bare ids inside
`tmp/pending_share`, and deletes each file after its last chunk. The share
sheet also holds stale-build reloads while it reads a share (a reload in
that window lost the share, which the native side only hands over once).

## Diagnosing a failing share on a device

Logs: Console.app on the Mac with the iPhone selected (works for TestFlight
builds), or the Xcode console when running from Xcode. Filter
`subsystem:com.yukon3t.app.share`. Every extension line is also written with
NSLog, prefixed `[YuKon3tShare]`, so the Xcode console shows it whatever its
log-level filter. Nothing logged contains a file name or content. Expected
order for one photo:

- `launched`, then `viewDidLoad` (neither: the extension's view controller
  never loaded; check `NSExtensionPrincipalClass` and the target's Sources)
- `start items=1 providers=1 overLimit=0 appGroup=true` (false: the
  extension has no App Group; check the ShareExtension target's App Groups
  capability and provisioning profile. The sheet then says "Couldn't share
  this to YuKon3t")
- `provider[0] types=public.heic,public.jpeg,... plan=image(public.heic)`
- `provider[0] method=fileRepresentation type=public.heic` then
  `provider[0] copy ok bytes=N`. On failure it falls back, logging each step
  with `error=<domain>#<code>`: `dataRepresentation` (`write ok`),
  `loadObject(UIImage)`, then `loadItem`. The system's own
  `nil expectedValueClass allowing {...}` line only means `loadItem` was
  called from Swift; it is not an error.
- `collected files=1 skipped=0 text=false timedOut=false stillLoading=0`
  (loading gives up after 60s; anything still loading counts as skipped)
- `manifest write ok files=1 skipped=0`
- `open host app answered false` (normal for Share extensions), then
  `disposition=saved_notice`; the "Saved. Open YuKon3t" notice follows.
  `disposition=failed reason=<no_app_group|no_attachments|nothing_usable|manifest_write>`
  shows the "Couldn't share" notice instead.
- `completeRequest` once the notice's OK is tapped
- after opening YuKon3t: `[plugin] plugin loaded` (once per launch; missing
  means `ShareReceiverPlugin` is not in `ios/App/App/capacitor.config.json`'s
  `packageClassList`: run `npm run cap:sync:ios`, not plain `npx cap sync`)
- `[plugin] getPendingShare: delivered files=1 skipped=0 text=false`
  (`no manifest`: the app sees a different or empty container;
  `App Group container unavailable`: the App target lacks the entitlement)

JS-side failures go to Sentry with `component: share-receiver` and `stage`
`get_pending_share` or `ios_read_file`.
