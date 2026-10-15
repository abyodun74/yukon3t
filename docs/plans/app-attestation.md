# Device attestation for native sign-up/sign-in — implementation plan

Status (2026-10-15): **Phase 0 deployed and live in `observe` mode on Vercel and Netlify**; Phase 1 (native plugin) not built and blocked by the native build hold; Phase 2 (enforce) not started. Server verification uses Google's REST endpoint, **not** `firebase-admin/app-check` (see "Incident" below). Phase 1 needs a native release, which is on hold until the owner lifts the native build hold.

**Short version:** use **Firebase App Check**. Native builds with the new plugin send a single-use App Check token in a hidden form field. The server accepts that token **instead of** a Turnstile token. Nothing else ever replaces Turnstile, so claiming to be the app gets you nothing.

**What this buys, honestly:** while web sign-up exists, Turnstile stays the lowest bar a bot has to clear, because the server can't tell a native request from a browser one without a valid token. This is a **UX upgrade for genuine app users (no "Verify you're human" tap) plus a strong trust signal**. It does not raise the system-wide bot floor.

---

## 1. Recommendation and rationale

Use **Firebase App Check** via `@capacitor-firebase/app-check@8.5.2` (exact pin). It wraps Play Integrity (Android) and App Attest (iOS). The server verifies by POSTing the token to `verifyAppCheckToken` (the call `firebase-admin` makes) from `src/lib/app-check-rest.ts`, **not** via `firebase-admin/app-check` (see Incident); `firebase-admin` (^14.2.0) is already a dependency, used by `src/lib/fcm.ts`.

| | App Check | Direct (Play Integrity decode + App Attest CBOR) |
|---|---|---|
| Native code | One npm plugin + ~40-line patch | Two hand-written local plugins (Java + Swift); Swift one needs `packageClassList` handling |
| Server | One `verifyToken` call, existing Firebase service account | Google API client for `decodeIntegrityToken`, App Attest CBOR/X.509 chain checks vs Apple root CA, new Prisma table for per-device keys/counters, a challenge endpoint |
| Replay protection | `consume: true` → `alreadyConsumed` | Build it: nonce store + counter checks |
| Request binding | No | Yes (`requestHash` / `clientDataHash`) |
| Cost / quota | Free; each limited-use token = one Play Integrity call (default 10k/day, raisable) | Same quota |
| Failure modes | Client exchange fails → Turnstile | Same, plus our own crypto to maintain |

Request binding is marginal: anyone farming tokens from a real device can produce request-bound tokens too (and can farm Turnstile tokens the same way). The direct route roughly triples the surface for it.

**Patch needed** (verified in package source): 8.5.2 only exposes `getToken`, `initialize`, `setTokenAutoRefreshEnabled` — no `getLimitedUseToken`. Add it with `patch-package` (same pattern as `patches/@capacitor+share+8.0.1.patch`):
- Android (`FirebaseAppCheck.java`, `FirebaseAppCheckPlugin.java`): `@PluginMethod getLimitedUseToken` → `FirebaseAppCheck.getInstance().getLimitedUseAppCheckToken()`.
- iOS (`FirebaseAppCheck.swift`, `FirebaseAppCheckPlugin.swift`): wrapper over `AppCheck.appCheck().limitedUseToken(completion:)`, and add `CAPPluginMethod(name: "getLimitedUseToken", …)` to `pluginMethods` (iOS refuses unlisted methods).

Don't use cached `getToken()` tokens — ~1h lifetime, reusable within it. Also send the method upstream as a PR.

---

## 2. Architecture

### Trust rule (security invariant)
`passesBotGate(formData)` = **(valid, unconsumed App Check token with allowlisted `appId` AND mode is `enforce`) OR `verifyTurnstile(formData)`**.

- The only native signal trusted is a cryptographically valid App Check token. Its `appId` gives Android vs iOS; it does **not** carry the app version.
- Everything else (user agent, `yk-app-meta`, the fallback cookie) is untrusted — used only for telemetry or to choose *more* friction.
- A request that claims to be native without the plugin, sends no tokens, or sends a garbage attestation token goes straight to `verifyTurnstile` → false without a Turnstile token (today's behaviour).
- Honeypot/timing (`bot-protection.ts`) and every `checkRateLimit` call stay on both paths.

### App version
The server can't know it unspoofably (App Check doesn't expose `versionCode`). `yk-app-meta` (platform + build from `@capacitor/app`'s `App.getInfo()`) is for adoption metrics only — new web code reaches old builds instantly, so even plugin-less builds report. A "minimum version" can only be a client-side update prompt; claiming an old version gains an attacker nothing, since that path still needs Turnstile.

### Token transport
Hidden form fields next to `cf-turnstile-response`, names in `src/lib/app-attest-shared.ts`:
- `yk-app-attest` — limited-use App Check JWT.
- `yk-app-meta` — untrusted JSON, e.g. `{p:"android",b:"29",plugin:true}`.

### Modes
`NEXT_PUBLIC_APP_ATTEST_MODE` = `off` | `observe` | `enforce` (read by client and server, so they can't drift within a deploy). Server also needs existing `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` and new `FIREBASE_APP_CHECK_APP_IDS`. Anything missing → inert + one `console.error` (same as `turnstile.ts`'s half-config warning).

| Mode | Client (native app with plugin) | Server |
|---|---|---|
| off | Turnstile as today | Ignores `yk-app-attest` |
| observe | Turnstile button as today; also fetches an attestation token on the tap and sends it if ready by submit (never holds the submit) | Verifies + consumes, records outcome, **decides on Turnstile only** |
| enforce | No button; fetches a token at submit (or first focus, to hide latency) | Valid token passes; otherwise falls through to Turnstile |

### Failure handling (server, in `passesBotGate`)
- **Invalid / expired / consumed / wrong `appId`:** don't accept. Set cookie `yk-attest-fallback=1` (not httpOnly, `SameSite=Lax`, `Secure`, 30 min). Fall through to Turnstile; with no Turnstile token the action returns its existing `captcha` error.
- **App Check backend unreachable / timed out** (5s `Promise.race`): "unavailable", **not** pass. `captureError`, throttled to one per 10 min per kind (as in `rate-limit.ts`). Set fallback cookie, fall through to Turnstile. **Never fail open on attestation** — the next layer is Turnstile, which keeps its own fail-open on Cloudflare outages. (The admin SDK maps JWKS fetch failures to `invalid-argument` too; classification affects telemetry only.)
- **Cookie spoofing:** the cookie only switches the client to the Turnstile UI; forging it can only add friction.

### Client
- **New `src/lib/app-attest-client.ts`:**
  - `canAttest()`: mode ≠ off, `Capacitor.isNativePlatform()`, `Capacitor.isPluginAvailable("FirebaseAppCheck")`, no fallback cookie.
  - `getAttestationToken()`: dynamically imports the plugin (as `capacitor-bridge.tsx` does for messaging, so browsers never load it); `initialize({ isTokenAutoRefreshEnabled: false })` once per page via a module-level promise, swallowing "already initialized"; **never passes `debugToken`**; calls patched `getLimitedUseToken` with an 8s timeout. Error/timeout → `null` → caller switches to Turnstile. Only unexpected errors go to `captureError` (integrity failures on rooted devices are expected).
- **`turnstile-widget.tsx`** handles the mode internally so the ~10 in-form call sites don't change:
  - New phase `"attest"`: hidden `<input name="yk-app-attest">` + a small "Checking your device…" line instead of the button.
  - Submit listener in attest phase: no token yet → `preventDefault()`, `await getAttestationToken()`, write it into the input, `form.requestSubmit(e.submitter)`; token present → let it through, then clear (single-use); fetch fails → switch to `"idle"` (button) and show `strings.wait`.
  - Fill `yk-app-meta` on every submit, every mode.
  - Render nothing until mounted (SSR can't know it's in the app; avoids the button flashing in the app).
- **`use-turnstile-gate.tsx`:** `attach` becomes async; in enforce mode it fetches a token. Update the three call sites in `phone-verification-form.tsx` / `signup-phone-verification-form.tsx`.
- **`ad-booking-form.tsx`:** Turnstile-only in v1 (own `onToken` wiring; advertisers rarely book from the app). Server gate still accepts attestation if sent.

### CSP (`src/proxy.ts`)
No change: the SDK runs natively outside the WebView; JWKS/consume calls are server-side; the plugin's web implementation is never loaded.

---

## 3. Files

**New**
- `src/lib/app-attest-shared.ts` — field/cookie names, `appAttestMode()` (defaults `off`), `MAX_ATTEST_TOKEN_LENGTH` (4096).
- `src/lib/firebase-admin.ts` — the `initializeApp`/`cert` singleton extracted from `src/lib/fcm.ts`; used by `fcm.ts` and `app-attest.ts`.
- `src/lib/app-attest.ts` (server-only) — `isAppAttestEnabled()` + half-config warning; `verifyAppAttestation(formData)` → `{ outcome: "ok"|"absent"|"malformed"|"invalid"|"expired"|"consumed"|"wrong_app"|"unavailable", platform? }` (length/type check, 5s race, `verifyToken(..., {consume:true})`, `appId` allowlist).
- `src/lib/bot-gate.ts` — `passesBotGate(formData, ip, action)`: trust rule, fallback cookie, `track("APP_ATTESTATION", null, {action, mode, outcome, platform, meta, turnstile})` when a token or meta is present and mode ≠ off.
- `src/lib/app-attest.test.ts`, `src/lib/bot-gate.test.ts` — Vitest, mocking `@/lib/app-check-rest` (style of `turnstile.test.ts`); cases in §6.
- `src/lib/app-attest-client.ts` — above.
- `patches/@capacitor-firebase+app-check+8.5.2.patch` — delete `node_modules/@capacitor-firebase/app-check/android/build/` before generating (Windows long paths, per CLAUDE.md).
- Prisma migration adding `APP_ATTESTATION` to `enum AnalyticsEventType` — `prisma migrate dev --create-only` and **strip any `DROP INDEX` lines** (HNSW gotcha, CLAUDE.md).

**Changed — server (replace `verifyTurnstile` with `passesBotGate`, 13 sites)**
- `src/app/actions/password-auth.ts`: `signUpWithPassword`, `resendEmailOtp`, `loginWithPassword`, `confirmLoginDeviceChallenge`, `resendLoginDeviceChallenge`, `requestPasswordReset`.
- `src/app/sign-in/page.tsx`: `sendMagicLink`.
- `src/app/actions/apple-auth.ts`: `startAppleSignIn`.
- `src/app/actions/ads.ts`: `createAdCampaign`.
- `src/app/actions/profile.ts`: `confirmPasswordChangeDeviceChallenge`, `resendPasswordChangeDeviceChallenge`.
- `src/app/actions/phone-verification.ts`: `requestPhoneVerification`.
- `src/app/actions/signup-phone-verification.ts`: `requestSignupPhoneVerification`.
- `src/lib/turnstile.ts`: logic unchanged; only caller becomes `bot-gate.ts` (update comment).

**Changed — client:** `turnstile-widget.tsx`, `use-turnstile-gate.tsx`, `phone-verification-form.tsx`, `signup-phone-verification-form.tsx`; `src/lib/i18n/{en,es,fr,pt,ar}/shared.ts` add `turnstile.checkingDevice`.

**Changed — data/config:** `prisma/schema.prisma` + `src/lib/analytics.ts` (event type); `src/lib/fcm.ts` (shared admin app); `package.json` (`"@capacitor-firebase/app-check": "8.5.2"`); `.env.example`.

**Changed — native (release build only, after the hold lifts)**
- `npx cap sync android`; `npm run cap:sync:ios` (**fix Windows backslashes** in `ios/App/CapApp-SPM/Package.swift` before committing). npm plugins auto-register — no `MainActivity` change, no `packageClassList` handling.
- `android/app/build.gradle`: bump `versionCode` past the current value and `versionName`; note no new permission / Play declaration.
- `android/app/proguard-rules.pro`: no change expected (standard `@CapacitorPlugin`; existing `-keepattributes …Annotations` + `-dontoptimize`; Firebase/Play Integrity ship consumer rules) — **must still be verified on a minified release build on Android 13+**.
- `ios/App/App/App.entitlements`: `com.apple.developer.devicecheck.appattest-environment` = `production`.
- `codemagic.yaml` line 41: `npx cap sync ios` → `npm run cap:sync:ios`. **Pre-existing gap** independent of this work: CI currently drops the local iOS plugins (`ScreenCaptureGuardPlugin`, `NativeCallKitPlugin`, `ShareReceiverPlugin`) from the generated `capacitor.config.json`. Confirm against the last TestFlight build.

**Changed — docs/legal/FAQ:** `src/app/legal/privacy/page.tsx`, `src/app/faq/page.tsx`, `src/app/faq/ids.ts`, `src/app/faq/content/{es,fr,pt,ar}-*.ts`, `SECURITY.md` (bot-protection bullet), a short "Device attestation" section in `CLAUDE.md`.

---

## 4. Env vars and one-time setup

### 4a. Env vars (both Vercel and Netlify, then redeploy both)
- `NEXT_PUBLIC_APP_ATTEST_MODE` — `observe` to start.
- `FIREBASE_APP_CHECK_APP_IDS` — comma-separated Firebase App IDs: Android `mobilesdk_app_id` in `android/app/google-services.json`; iOS `GOOGLE_APP_ID` in `ios/App/App/GoogleService-Info.plist`.
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — exist for FCM; confirm set on both.

### 4b. Consoles
- **Google Cloud (Firebase project):** enable Firebase App Check API (`firebaseappcheck.googleapis.com`) and Play Integrity API. Grant the FCM service account **Firebase App Check Token Verifier** if `consume` returns `permission-denied`.
- **Play Console → Test and release → App integrity:** link the same Cloud project for Play Integrity; copy the App signing key SHA-256 (Play-managed) and upload key SHA-256.
- **Firebase console:** Project settings → Android app: add both SHA-256s. App Check → Android: register **Play Integrity** (require app recognized + device integrity; **don't require "licensed"**). App Check → iOS: register **App Attest** (needs Apple Team ID). **Don't turn on App Check enforcement for any Firebase product.**
- **Apple Developer Portal:** App ID `com.yukon3t.app` → enable **App Attest**. Confirm Codemagic's `xcode-project use-profiles` picks up a profile including it; a stale profile fails signing with "entitlement not in profile" — delete it.

### 4c. Privacy and store forms
- **Privacy policy** (English only): add a bullet "Firebase App Check (Google), Google Play Integrity and Apple App Attest" — in the apps, on the same actions Turnstile covers, the app asks Google (Android) or Apple and Google (iOS) to confirm it is the genuine app on a genuine device; they process app/device integrity signals under their own policies; we receive only a pass/fail token, store no device identifier, record only the outcome. Edit the Turnstile bullet: browsers, and in the app when the device check is unavailable. Bump "Last updated". Separately, the FCM bullet says "Android app" only — check whether iOS also uses FCM via `@capacitor-firebase/messaging` (it appears to).
- **FAQ:** entry such as `why-verify-human-app` — why app users usually don't see "Verify you're human", why they sometimes still do (emulator, rooted device, outdated app, check unavailable), and that updating the app removes the tap. Add to `FAQ_IDS`, English JSX, es/fr/pt/ar (`content.test.ts` enforces parity).
- **Play Data Safety:** copy Google's published guidance for Play Integrity / Firebase App Check — don't guess. Likely device/app integrity info, collected, "Fraud prevention, security, and compliance", not shared, encrypted in transit.
- **App Store privacy labels:** App Attest is Apple first-party; check Firebase's iOS data-disclosure page — most likely no new label, or "not linked to identity, not used for tracking".

---

## 5. Phased rollout

**Phase 0 — web/server only, safe under the build hold.**
Ship everything in §3 except native sync, entitlements and versionCode (the npm dep + patch are inert on web — dynamic import only when native and plugin available). Deploy with mode unset (`off`), then set `observe` with the Firebase env vars. Live builds have no plugin, so nobody's UX changes; you start collecting `APP_ATTESTATION` rows with `yk-app-meta` (native platform/build distribution today). Update `SECURITY.md`/`CLAUDE.md` now; privacy/FAQ can wait for Phase 1.

**Phase 1 — native release, when the hold lifts.**
*Moved here from Phase 0 (deliberate deviation):* adding `"@capacitor-firebase/app-check": "8.5.2"` to `package.json` and creating `patches/@capacitor-firebase+app-check+8.5.2.patch`. Phase 0's `src/lib/app-attest-client.ts` doesn't import the npm package at all: it reaches the native plugin with `registerPlugin("FirebaseAppCheck")` from `@capacitor/core` and a local interface for exactly `initialize({ isTokenAutoRefreshEnabled: false })` and `getLimitedUseToken(): Promise<{ token: string }>`, and only calls it when `Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("FirebaseAppCheck")`. So the patched method **must be named `getLimitedUseToken`** and return `{ token }`, and the plugin must register as `FirebaseAppCheck`. Also the fallback cookie is only set in `enforce` (in `observe` the app shows the button anyway).
Console setup (§4b); `npm i` (applies patch), `npx cap sync android`, `npm run cap:sync:ios` (fix backslashes), entitlement, versionCode bump. AAB → internal testing; Codemagic → TestFlight. Real-device tests (§6), then production rollout (recorded Play Console flow). Update privacy/FAQ/store forms in the same window. Stay in `observe` 1–2 weeks. Go/no-go: `ok` rate on plugin builds ≥ ~98% per platform, `unavailable` ≈ 0, no crash spike.

**Phase 2 — enforce (web deploy only).**
Set `NEXT_PUBLIC_APP_ATTEST_MODE=enforce` on both platforms, redeploy both. Plugin builds lose the tap; nothing else changes. Rollback = flip to `observe`/`off` and redeploy, no native change. Draft the "what's new" announcement (confirm with owner first — it pushes to everyone).

**Phase 3 (optional) — client-only update prompt.**
When native but `isPluginAvailable("FirebaseAppCheck")` is false, show a soft "update the app" banner, timed using `yk-app-meta` adoption data. Never server-enforced.

---

## 6. Test plan

**Vitest**
- off: `verifyToken` never called; behaviour = Turnstile.
- observe + valid token: still requires Turnstile; outcome recorded.
- enforce + valid allowlisted token: passes **without** Turnstile.
- enforce + consumed / expired / invalid / wrong `appId`: falls to Turnstile, sets fallback cookie, false without Turnstile token.
- `verifyToken` throws network error or times out: `captureError`, falls to Turnstile, never passes.
- Oversized token: rejected, no network call.
- **Spoof:** `yk-app-meta` claims Android build 999, app UA, no tokens → false.
- Half-configured env: inert, logs once.
- Turnstile disabled: true, as today.

**Android, real device (adb)**
- Install from the **internal testing track** (Play-signed required; a local/debug build won't be "app recognized" and should fall back to Turnstile — itself a test).
- Minified release on Android 13+: watch `adb logcat | grep -iE "AppCheck|Capacitor|AndroidRuntime"` for the R8 reflection crash class.
- Via the adb + Chrome DevTools Protocol recipe: form posts `yk-app-attest`; an `APP_ATTESTATION` row appears with `outcome: ok`. Enforce can only be tested on prod (`server.url` is prod) right after the Phase 2 flip, with someone ready to roll back.
- Negatives: debug APK / emulator → button; airplane mode during check → button after 8s; replay a captured token → `consumed` → `captcha` error, then button.
- Old installed build: unchanged Turnstile flow; meta rows show `plugin:false`.

**iOS:** TestFlight on a real iPhone, same checks via Safari Web Inspector; Simulator → App Attest unsupported → Turnstile; watch Firebase App Check metrics.

**Web:** desktop and mobile browsers exactly as today — button, no `yk-app-attest`.

**App review:** Turnstile runs before the user lookup in `loginWithPassword`, so the `isAppReviewDemo` bypass doesn't touch it. **Add no demo-account attestation bypass.** Reviewers on real devices should pass; otherwise they get today's Turnstile tap. Google pre-launch (Test Lab) devices will likely fall back to Turnstile.

---

## 7. Risks and open questions

1. **iOS provider-factory ordering — verify first on TestFlight.** Firebase documents `setAppCheckProviderFactory` as needing to run before `FirebaseApp.configure()`; the plugin configures on load and sets the factory later in `initialize()`. If iOS tokens fail with "no provider installed", fix with a native `AppDelegate` change setting the App Attest factory before configure. Safe failure mode either way: Turnstile.
2. **The patch is a fork.** Pin 8.5.2; any plugin upgrade needs the patch regenerated or an upstream method.
3. **No server-side version, no hard floor.** Inherent and acceptable — nobody should read "native is attested" as "bots can't sign up".
4. **Quota/latency.** One Play Integrity call per gated submit, far under 10k/day now; request an increase before growth. First-call latency 1–3s, hidden by fetching on first focus.
5. **Rooted devices, custom ROMs, phones without Google Play services:** fail attestation → Turnstile (no lockout). App Attest doesn't detect jailbreaks — jailbroken iPhones pass.
6. **Pre-existing CI gap** in `codemagic.yaml` (plain `npx cap sync ios`) — confirm and fix in the same release.
7. **Owner decisions:** approve Phase 0 now (observability only); observe → enforce threshold (suggested ≥98% `ok` per platform over 7 days); ad booking attestation (recommended: no); whether to build the Phase 3 update banner.


---

## Incident: production 500s from `firebase-admin/app-check` (2026-10-15)

**Impact:** from ~19:02 UTC (Netlify deploy of commit `149953f`) until the fix went live ~19:56 UTC, most routes on yukon3t.com returned 500 (Netlify serves real traffic and the native app's WebView). Vercel's separate runtime was not affected the same way.

**Cause:** `src/lib/app-attest.ts` imported `firebase-admin/app-check` at module top. That pulls in `jwks-rsa`, which `require()`s the ESM-only `jose`; on Netlify's function runtime that throws at module load (`require() of ES Module .../jose/dist/webapi/index.js`), so every route importing `bot-gate.ts` crashed. It was not caused by turning on `observe` mode; the import alone was enough. The Vitest suite mocked the module, so it could not catch a load-time failure, and I reported Phase 0 as live without loading a real route on Netlify.

**Fix (two steps):**
1. `0360d70`: lazy `import()` of `firebase-admin/app-check` inside the verify call. Stopped the crashes.
2. `fbce8e8`: removed `firebase-admin/app-check` entirely. `src/lib/app-check-rest.ts` decodes the claims (`sub` = app id, `exp`), then POSTs `{ app_check_token }` to `https://firebaseappcheck.googleapis.com/v1beta/projects/{projectId}:verifyAppCheckToken` with the service account's access token (`app.options.credential.getAccessToken()`). Google verifies signature/expiry/project and returns `alreadyConsumed`; HTTP 400 maps to `invalid`, any other failure to `unavailable` (falls to Turnstile). `src/lib/no-jwks-rsa-imports.test.ts` fails if app code imports `firebase-admin/app-check` or `/auth`.

**Why `firebase-admin/app` and `/messaging` are safe:** in `firebase-admin` only the app-check, auth and phone-number-verification token verifiers import `jwks-rsa`. FCM (`fcm.ts`) only uses `app` and `messaging` and has run on Netlify for months.

**Rollout lesson:** after any change to what a server module imports, deploy with the feature flag off, confirm real routes return 200 and the `___netlify-server-handler` logs are clean, then flip the flag. The Netlify rollback was blocked by the permission classifier during the incident, so the fix went forward.

## Current status (2026-10-15)

- Live: `passesBotGate` on all 13 gated actions; `NEXT_PUBLIC_APP_ATTEST_MODE=observe` and `FIREBASE_APP_CHECK_APP_IDS` (Android + iOS app ids) set on Vercel and Netlify production; `APP_ATTESTATION` enum migration applied.
- Effect: none for users. Live builds have no plugin, so only `yk-app-meta` rows (platform/build) are recorded; no attestation tokens arrive yet.
- Unproven until Phase 1: the REST call has not run against a real token. A 403 would mean the FCM service account lacks the **Firebase App Check Token Verifier** role (add it); it classifies as `unavailable` and falls back to Turnstile, so it cannot lock anyone out.
- Next: lift the native hold, ship Phase 1 (plugin + patch, entitlements, versionCode, console setup in section 4b), watch `ok` rate in observe for 1-2 weeks, then Phase 2.

## Verification log

- **2026-10-15, first live observe row confirmed.** After Clear Cache and a password/magic-link sign-in in the Android app, admin analytics "App device checks" went from 0/0/0 to 1/1/1 (24h/7d/30d). This proves the full Phase 0 path in production: the cached web bundle was refreshed, the native WebView sent `yk-app-meta`, `passesBotGate` ran in `observe` mode, and `track("APP_ATTESTATION")` wrote to the database without changing the Turnstile decision. The row's contents (outcome `absent`, meta platform/build) were not inspected; only the count was. Until a Phase 1 build ships, every row will read `absent`.
- **2026-10-15, Phase 1 native build started** (owner go-ahead). See the next section for what rode along in it.

## Phase 1 build (2026-10-15)

Built under the owner's explicit go-ahead to lift the native hold and roll every pending native change into one release.

**Android � built, signed, not yet uploaded.** `versionCode` 28 -> 29, `versionName` 1.25 -> 1.26. `android/app/build/outputs/bundle/release/app-release.aab` (signed with the real `CN=YuKon3t` release key; `jarsigner` verified). `FirebaseAppCheckPlugin.getLimitedUseToken` survives R8 unobfuscated (checked in `mapping.txt`); it is also the first Android build with Capacitor 8.5.2. The plugin adds `firebase-appcheck-playintegrity`/`-debug` 19.0.1; no manifest or permission change. Still to verify on a real device from the internal testing track (section 6).

**iOS � source ready, not built.** The Mac/Codemagic build cannot run from this Windows machine. Done in source: plugin synced into `ios/App/CapApp-SPM/Package.swift` (backslashes fixed), `com.apple.developer.devicecheck.appattest-environment = production` in `App.entitlements`, `codemagic.yaml` now runs `npm run cap:sync:ios` (the pre-existing local-plugin gap). Blocked on the owner: (1) enable **App Attest** on the `com.yukon3t.app` App ID; (2) register the `group.com.yukon3t.app.share` App Group on `com.yukon3t.app` and `com.yukon3t.app.ShareExtension` � the Share Extension target is already in the Xcode project, so every iOS build needs it to sign; (3) trigger the `ios-testflight` workflow in Codemagic.

**What else rides in this release** (all native, previously held):
- iOS only: `@capacitor/haptics` has never shipped on iOS (the Android release went out as v1.25; iOS was held in review and the approved build predates it).
- iOS only: Capacitor iOS 8.5.2 sync plus the missing `CapacitorHaptics` entry in `Package.swift`.
- iOS only: `ScreenCaptureGuardPlugin` reads capture state from the window scene instead of `UIScreen.main` (commit `61f995b`).
- iOS only: the Share Extension (`ios/App/ShareExtension`, `ShareReceiverPlugin`), built 2026-09-23, never in a shipped build; needs the App Group registered first.
- Android: Capacitor 8.5.2 (security fix) and the latest dependency set; no Android native source changed since v1.25.

**Deliberately not in this build:** the lock-screen widget / watch surface for ambient presence (needs real Xcode/Android Studio widget work), region-gated CallKit (China mainland was removed from availability instead), and camera cold-start work (a different kind of change, not started).

**After release:** keep `NEXT_PUBLIC_APP_ATTEST_MODE=observe` for 1-2 weeks and watch `APP_ATTESTATION` outcomes per platform. If every row is `unavailable`, check that the FCM service account has the **Firebase App Check Token Verifier** role. Go/no-go for enforce is section 5.
