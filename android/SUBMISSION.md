# YuKon3t — Android (Capacitor) setup & Play Store submission guide

What's already done in this repo, and everything you still need to do
yourself. Read the **"Existing TWA app" warning** in section 0 before you do
anything else — it's the one step that can silently break your existing Play
Store listing if skipped.

## 0. Existing TWA app — read this first

`public/.well-known/assetlinks.json` already declares `com.yukon3t.app` as a
verified Android app for this domain, with two SHA-256 cert fingerprints —
that's a **Trusted Web Activity (TWA) app that's already live (or at least
domain-verified) on the Play Store**, built outside this repo. This new
`android/` Capacitor project reuses the exact same `com.yukon3t.app`
application ID (from `capacitor.config.ts`, matching the iOS `appId`) so
Digital Asset Links / deep-linking stay consistent — but that means:

- **You cannot upload a build from this project as an update to the existing
  TWA listing** unless you sign it with the *same* upload keystore the TWA
  app already uses (whichever of the two fingerprints above is the live
  upload key — the other is likely Play App Signing's own re-signing key).
  If you don't have that keystore, Google Play will reject the upload with a
  signature mismatch.
- Your realistic options: (a) locate and reuse the original TWA keystore so
  this Capacitor build can replace the TWA as an in-place update, (b) publish
  this as a genuinely new listing under a different application ID (change
  `appId` in `capacitor.config.ts`, re-run `npx cap sync android`, and update
  `assetlinks.json`'s `package_name` + fingerprints to match), or (c) treat
  this `android/` project as dev/internal-only and keep the TWA as the
  published app for now.
- This mirrors the same category of decision the iOS scaffold already flags
  for its placeholder bundle ID — the difference here is `com.yukon3t.app` is
  a *real, already-registered* identity, not a placeholder.

## 1. What's already in this repo

- `capacitor.config.ts` — native shell config, shared with iOS. `server.url`
  points the WebView at `https://yukon3t.com` (server-rendered app — Server
  Actions, Prisma, auth cookies — so it can't ship as a static bundle).
- `android/app/` — the generated Gradle project (`applicationId
  com.yukon3t.app`, `minSdkVersion`/`targetSdkVersion` from
  `android/variables.gradle`).
- `android/app/src/main/AndroidManifest.xml` — `CAMERA` and
  `POST_NOTIFICATIONS` permissions, plus the FCM notification icon
  meta-data.
- `android/app/src/main/res/mipmap-*` — adaptive icon (accent-color
  background + white mark foreground) and legacy launcher icons, matching
  the iOS App Store icon.
- `android/app/src/main/res/drawable*/splash.png` — dark launch background
  with the centered mark, matching iOS's launch screen and the PWA manifest.
- `android/app/src/main/res/drawable/ic_stat_notify.png` — white silhouette
  notification icon (`@capacitor-firebase/messaging` requires this or FCM
  notifications render as a plain white square/circle in the status bar).
- `android/app/build.gradle` — already conditionally applies the
  `com.google.gms.google-services` Gradle plugin *only if*
  `android/app/google-services.json` exists, so the project builds fine
  before you've done the Firebase step below.
- `src/components/capacitor-bridge.tsx` — registers for push through the
  *same* `FcmToken` table and `registerFcmToken` action as iOS and the
  existing Android TWA (see `fcm-token-bridge.tsx` for the TWA's separate
  query-param handoff — Capacitor doesn't need that since its WebView shares
  the page's own session cookie).
- `scripts/gen-android-assets.mjs` — regenerate the icon/splash/notification
  icon if the brand mark or accent color ever change (`node
  scripts/gen-android-assets.mjs`).

## 2. Prerequisites

- **Android Studio** (includes the Android SDK, platform tools, and an
  emulator) — free, any OS. Unlike iOS, this doesn't require a Mac.
- A **Google Play Console** developer account — **$25 one-time** fee,
  registered at [play.google.com/console](https://play.google.com/console).
- **JDK 21** (Android Studio bundles a compatible JDK; Gradle in this project
  targets whatever `android/gradle/wrapper/gradle-wrapper.properties`
  specifies).

## 3. First build

```bash
git pull
npm install
npx cap sync android     # re-copies capacitor.config.ts + web assets into the native project
npx cap open android      # opens Android Studio, or: studio android/
```

In Android Studio: let Gradle sync finish, pick a device/emulator, hit Run to
confirm the app launches and loads `yukon3t.com` inside the WebView.

Command-line alternative (no Android Studio UI needed once the SDK is
installed):

```bash
cd android
./gradlew assembleDebug    # ./gradlew.bat on Windows without Git Bash
```

## 4. Wire up push notifications (Firebase)

The app talks to the same Firebase project the iOS build and server's
`lib/fcm.ts` already use (`FIREBASE_PROJECT_ID`):

1. In the [Firebase console](https://console.firebase.google.com), open that
   project → **Project settings** → add an Android app (if not already
   there) using application ID `com.yukon3t.app` and the SHA-256 signing
   certificate fingerprint of whichever keystore you'll actually sign
   release builds with (see the section 0 warning above — this determines
   whether it's the existing TWA's fingerprint or a new one).
2. Download the generated `google-services.json` and place it at
   `android/app/google-services.json` (already covered by
   `android/.gitignore`'s intent, but double check it isn't committed if you
   consider it sensitive — Firebase client configs aren't secret keys, just
   like iOS's `GoogleService-Info.plist`, but some teams still prefer not to
   commit them).
3. Re-run `npx cap sync android` and rebuild — `android/app/build.gradle`
   will now apply the Google Services plugin automatically since the file
   exists.

Until this is done, permission prompts and the plugin itself still work (see
`capacitor-bridge.tsx`), but no token will be issued and no push will be
delivered.

## 5. Signing & Play App Signing

Unlike iOS (Apple issues you a distribution certificate), Android release
builds need a keystore you generate and control:

```bash
keytool -genkeypair -v -keystore yukon3t-upload.jks -keyalias yukon3t -keyalg RSA -keysize 2048 -validity 10000
```

Store this file and its passwords somewhere durable (a password manager or
secrets vault, **not** committed to git) — losing it means losing the
ability to publish updates under whatever app listing it's tied to. Play App
Signing (opt-in during your first upload) lets Google hold the actual
signing key and re-sign your app for distribution, using this keystore only
as your "upload key" — recommended, since Google can then help recover a
lost upload key, unlike a fully self-managed keystore.

Configure `android/app/build.gradle`'s `signingConfigs`/`buildTypes.release`
to reference this keystore before running `./gradlew bundleRelease` (Android
Studio's **Build → Generate Signed Bundle** wizard does this for you
interactively and is the easier path for a first release).

## 6. Required assets and metadata

- **App icon** — already generated (`mipmap-*/ic_launcher*.png`); Play
  Console pulls it from the uploaded bundle.
- **Feature graphic** (1024×500) and **screenshots** (min 2, per supported
  device type) — capture from a real running build; not something that can
  be generated without the app actually running.
- **Short description** (80 chars) / **full description** (4000 chars) —
  match the site's positioning ("Connect across cultures, interests, and
  borders").
- **Privacy Policy URL** — `https://yukon3t.com/legal/privacy` (same one
  used for iOS).
- **App category / tags**, **contact email**, **content rating
  questionnaire** — answer based on the app's actual open messaging/calls
  between strangers, same reasoning as the iOS 17+ age-rating note in
  `ios/SUBMISSION.md` section 8.

## 7. Data safety section

Google Play's **Data safety** form (Play Console → App content) asks the
same category of questions as Apple's Nutrition Label — reuse the table
already drafted in `ios/SUBMISSION.md` section 7 as your starting point, and
verify it against current data practices yourself before submitting; it's a
legal declaration to Google, not something to take on this doc's word alone.

## 8. Release tracks

New Play Console apps are required to go through **closed testing with at
least 12 testers opted in for 14 days** before Google allows a production
release (Google's "new developer" policy). Start with an **Internal
testing** track to sanity-check the build, then move to **Closed testing**
to satisfy that requirement, then **Production**.

## 9. Target API level

Play Console enforces a minimum `targetSdkVersion` (whatever Google's
current policy requires — typically the latest or previous Android major
version) at upload time. Check `android/variables.gradle`'s
`targetSdkVersion` against [Play's current
requirement](https://developer.android.com/google/play/requirements/target-sdk)
before your first submission; Capacitor 8's default should already be
current as of this scaffold's creation, but Play's requirement moves forward
roughly yearly.
