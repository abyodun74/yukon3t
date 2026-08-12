# YuKon3t — iOS App Store submission guide

What's already done in this repo, and everything you still need to do
yourself — most of it requires a Mac, which this scaffold was necessarily
built without. Read this end to end before your first submission; a couple
of steps (APNs/Firebase wiring, the App Review risk note) are easy to miss
and will cost you a rejection cycle if skipped.

## What's already in this repo

- `capacitor.config.ts` — native shell config. Points at `https://yukon3t.com`
  (the app is server-rendered — Server Actions, Prisma, auth cookies — so it
  can't ship as a static bundle the way most Capacitor apps do).
- `ios/App/` — the generated Xcode project.
- `ios/App/App/Info.plist` — camera/microphone/photo-library usage
  descriptions and the background push mode.
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/` — the 1024×1024 App
  Store icon (opaque, brand-accent background, matches the Android icon).
- `ios/App/App/Assets.xcassets/Splash.imageset/` + `LaunchScreen.storyboard`
  — dark launch background instead of the Xcode default white, matching the
  PWA manifest fix.
- `src/components/capacitor-bridge.tsx` — registers for push notifications
  through the *same* `FcmToken` table and `registerFcmToken` action the
  Android app already uses, hides the native splash once the page has
  hydrated, and sets the status bar style.
- `scripts/gen-ios-assets.mjs` — regenerate the icon/splash if the brand
  mark or colors ever change (`node scripts/gen-ios-assets.mjs`).

## 1. Prerequisites

- A Mac (Apple Silicon or Intel) with a current version of **Xcode**
  installed from the Mac App Store. Nothing here can be built, signed, or
  submitted without one — if you don't have access to a physical Mac, a
  cloud Mac rental (MacStadium, MacinCloud, etc.) works too.
- An **Apple Developer Program** membership — $99/year, enrolled at
  [developer.apple.com](https://developer.apple.com), tied to your own
  Apple ID. This is required before you can register an App ID, generate
  push certificates, or submit anything to App Store Connect.

## 2. First build on the Mac

```bash
git pull                  # get this scaffold
npm install
npx cap sync ios          # re-copies capacitor.config.ts + web assets into the native project
open ios/App/App.xcodeproj
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities** → set your Team
   (from your Apple Developer account) and confirm/adjust the **Bundle
   Identifier** (currently `com.yukon3t.app` — must be globally unique; if
   you change it, also update `appId` in `capacitor.config.ts` and re-run
   `npx cap sync ios`).
2. Add the **Push Notifications** capability (`+ Capability` → search
   "Push Notifications") and the **Background Modes** capability with
   **Remote notifications** checked (Info.plist already declares this, but
   Xcode also needs the capability added to the project's entitlements).
3. Pick a physical device or simulator and hit Run to confirm it launches
   and loads yukon3t.com inside the app shell.

## 3. Wire up push notifications (APNs + Firebase)

The app already talks to the same Firebase project/`FcmToken` table the
Android app uses (see `capacitor-bridge.tsx`), but iOS push additionally
needs Apple's own APNs key registered with that Firebase project before any
push will actually arrive on a device:

1. In the [Apple Developer portal](https://developer.apple.com/account) →
   **Certificates, Identifiers & Profiles** → **Keys**, create a new key
   with the **Apple Push Notifications service (APNs)** capability enabled.
   Download the `.p8` file — **Apple only lets you download it once**, so
   store it somewhere safe immediately.
2. In the [Firebase console](https://console.firebase.google.com), open the
   project already used for `FIREBASE_PROJECT_ID` (same one the server's
   `lib/fcm.ts` sends through) → **Project settings** → **Cloud Messaging**
   → **Apple app configuration** → upload that `.p8` key, along with your
   Key ID and Team ID (both shown on the Apple key's detail page).
3. In the same Firebase console, add an iOS app to the project (if not
   already there) using the exact bundle ID from step 2 above. Download the
   generated `GoogleService-Info.plist` and drag it into
   `ios/App/App/` in Xcode (check "Copy items if needed" and add it to the
   App target) — `@capacitor-firebase/messaging` requires this file to be
   present; the app will fail to initialize Firebase without it.

Until all three of those are done, push permission prompts and token
registration in the app will still work (they only need the client-side
plugin), but no actual notification will be delivered — the send path in
`sendFcmDataToUser` (`src/lib/fcm.ts`) needs Firebase to know how to reach
APNs for this bundle ID.

**Not covered by this scaffold:** true instant-wake VoIP-style call
notifications (matching CallKit's full-screen incoming-call UI even when
the app is force-quit) need PushKit + CallKit, which requires native Swift
work beyond what a Capacitor plugin provides out of the box. What's wired
up now (`apns-push-type: background`) is a solid best-effort background
push — reliable while the app is backgrounded, but iOS can throttle or
delay it more than Android once the app is fully terminated.

## 4. The single biggest App Review risk

Apple's App Review Guideline **4.2 (Minimum Functionality)** rejects apps
that are "simply a repackaged website" with no meaningful native value.
Because this app loads its content from a remote URL rather than shipping a
bundled UI, this is the most likely rejection reason on a first submission
if reviewers don't immediately see native-feeling functionality.

What already helps the case: native push notifications, native camera/photo
library access (once wired into the relevant upload flows — currently only
the plugin is installed; the web upload components still use the browser
file input, which works fine inside the WebView but doesn't route through
the native camera picker unless explicitly switched over), and a real
native app icon/launch/splash experience instead of a bare browser window.

If you get a 4.2 rejection anyway: reply in Resolution Center pointing to
the specific native capabilities (push, calls, camera) rather than
resubmitting unchanged, or consider adding a couple more visibly-native
touches (haptics on key actions, a native share sheet) before resubmitting.

## 5. Register the app in App Store Connect

1. [App Store Connect](https://appstoreconnect.apple.com) → **Apps** → **+**
   → **New App**. Platform: iOS. Bundle ID: the one you registered in step
   2 (must already exist under Certificates, Identifiers & Profiles before
   it shows up here).
2. **Pricing and Availability** — free, unless you're monetizing directly
   in the app (the existing Stripe integration is for advertisers booking
   ad placements, not an in-app purchase — that distinction matters:
   Apple's 30% commission and in-app purchase requirements apply to digital
   goods/services *consumed within the app*, not to this kind of
   business-side billing, but this is worth double-checking against
   Apple's current guidelines yourself before submitting, since misreading
   this is a common rejection cause).

## 6. Required assets and metadata

- **Screenshots** — required for at minimum the largest device size in each
  supported family (Apple auto-scales for others, but larger requires
  actual captures at minimum for iPhone 6.9" and iPad 13" if you support
  iPad). Take these from the real app once it's running on a Mac/device —
  I can't generate authentic in-app screenshots without one.
- **App Store icon** — already in the Xcode project (`AppIcon.appiconset`);
  App Store Connect pulls it from the build automatically.
- **App name / subtitle** — e.g. "YuKon3t" / "Connect across cultures &
  interests" (subtitle max 30 characters).
- **Description, keywords, promotional text** — write to match the site's
  actual positioning ("Connect across cultures, interests, and borders").
- **Support URL** — needs a real page; `yukon3t.com/faq` already exists and
  works for this.
- **Privacy Policy URL** — `https://yukon3t.com/legal/privacy` already
  exists and is genuinely detailed — use it directly.
- **Marketing URL** (optional) — `https://yukon3t.com`.

## 7. App Privacy ("Nutrition Label") questionnaire — draft

Based on what's actually in `src/app/legal/privacy/page.tsx` and the schema
today. **Verify this yourself against your current data practices before
submitting** — this is a legal declaration to Apple, and it's your
responsibility to get it right, not something to take on my word alone.

| Data type | Collected? | Linked to identity? | Used for tracking? |
|---|---|---|---|
| Email Address | Yes | Yes | No |
| Name (display name/username) | Yes | Yes | No |
| Photos or Videos | Yes (posts, messages, profile pic) | Yes | No |
| Audio Data | Yes (voice/video calls) | Yes | No |
| User ID | Yes | Yes | No |
| Device ID (push token) | Yes | Yes | No |
| Precise Location | No | — | — |
| Coarse Location | No (only a self-entered "country" field — not device geolocation) | — | — |
| Payment Info | Only for advertisers booking ads, via Stripe — never full card numbers | Yes (advertiser contact) | No |
| Product Interaction / Usage Data | Yes (sign-up, posts, calls, etc. — analytics events) | Yes | No |
| Crash Data / Diagnostics | Yes (Sentry is configured) | Depends on your Sentry PII settings | No |

None of this is currently used for cross-app/cross-site **tracking** (as
Apple defines it under ATT) based on the existing privacy policy's "we
never sell your data" language — if that's accurate, you can answer "No" to
the App Tracking Transparency prompt requirement. If you ever add
third-party ad-attribution SDKs, revisit this.

## 8. Age rating

The app has open messaging, calls, and user-generated media between
strangers (Discover/connections), which typically lands in Apple's
**17+** age rating band for "Unrestricted Web Access" / user-generated
content with limited moderation visibility to Apple — even though yukon3t
does have real moderation (reports, trust scores, content screening). Work
through Apple's actual age-rating questionnaire in App Store Connect
carefully; answer based on what the app actually allows, not what's
typical, filed under moderation. You already have a Community Guidelines
page and account age-gating (birth date at sign-up) which helps here.

## 9. Before you submit: TestFlight

Upload a build via Xcode (**Product → Archive → Distribute App → App Store
Connect**) and run it through **TestFlight** first — invite yourself and a
few others, actually use it on real devices, confirm push notifications
work end-to-end (after step 3 above), confirm calls work, confirm the
splash/launch sequence looks right. Only submit for App Review once that's
solid.

## 10. App Review notes field

When you submit, use the "Notes for Review" field in App Store Connect to
give reviewers a working demo account (email + password) and a one-line
explanation of what makes this a real app, not just a website — this
measurably reduces 4.2 rejections for exactly this kind of app.
