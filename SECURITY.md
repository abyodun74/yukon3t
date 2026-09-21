# Security notes

## Controls implemented

- **Dual auth**: NextAuth v5 + Resend magic link (no password to leak), *or* an optional username/password. See "Username/password auth" below for why the password path bypasses NextAuth's own Credentials provider.
- **CSP with per-request nonce** (`src/proxy.ts`) — `script-src 'self' 'nonce-...' 'strict-dynamic'`, no `unsafe-inline` in production. Plus HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (`next.config.ts`).
- **Input validation** — every server action validates with Zod (`src/lib/validations.ts`) before touching the database.
- **Rate limiting** — Upstash-backed sliding window on sign-in, posts, messages, connection requests, reports, Circle creation (`src/lib/rate-limit.ts`); fails open only on Upstash outages, fails closed (in-memory limiter) in local dev.
- **Bot protection** — three layers on the public, pre-auth forms. (1) Honeypot field + 1.2s minimum time-since-render (`src/lib/bot-protection.ts`) on sign-up, forgot-password and ad booking. (2) **Cloudflare Turnstile** (`src/lib/turnstile.ts`, `src/components/turnstile-widget.tsx`) on sign-up, password login, magic-link request, forgot-password, Google sign-in, email-OTP/device-challenge send and resend, ad booking, and **every phone-verification SMS send** (first send, "Resend code", and the automatic resend on revisit — `requestPhoneVerification` / `requestSignupPhoneVerification`, client side via `src/components/use-turnstile-gate.tsx`; an SMS costs real money, so this is the abuse-costly surface; confirming a code sends nothing and isn't gated) — token verified server-side against Cloudflare's siteverify API before the rate limiter runs. Opt-in: it is fully off (no widget, no CSP change, nothing enforced) until **both** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set, so a deploy without them can never lock anyone out; the site key is inlined at build time, so set both on Vercel and Netlify *before* deploying. Fails open (logged) if Cloudflare's siteverify is unreachable or 5xx — same infra-outage stance as the rate limiter — but fails closed on a missing or rejected token. Tokens are single-use, so the widget refetches one after every submit; without that a second wrong-password attempt on the same page would resubmit a spent token. (3) Per-action Upstash rate limits, above.
- **Authorization / ownership checks** — every mutation re-derives the actor from the session server-side and checks they actually own/are a member of the resource (conversation membership before sending a message, Circle membership before posting, admin flag before resolving reports) — see `src/lib/auth-guards.ts` and each file in `src/app/actions/`.
- **Content moderation gate — status: live and verified.** Bios, posts, Circle descriptions, Collab posts, and messages are passed through OpenAI's moderation endpoint before publish (`src/lib/moderation.ts`); flagged text is stored as `FLAGGED` rather than shown. Photos and video-thumbnail frames go through the same endpoint's image moderation (`moderateImage`/`moderateMedia`); flagged media is rejected outright and deleted from storage, never stored in a pending state — a stricter policy than text, per the zero-tolerance no-sexual-content rule in the Community Guidelines. `OPENAI_API_KEY` is set on both local `.env` and Vercel production, and confirmed on the live site with a real test: explicit text posted through the actual composer on `https://yukon3t.vercel.app` came back `flagged: true` (sexual: 0.78) from OpenAI and was stored as `moderationStatus: FLAGGED` in the production database — never shown in the feed. Benign text was separately confirmed to pass (`flagged: false`). Note: the OpenAI account needed a payment method added before the key would work at all — a bare new key returns a persistent `429 invalid_request_error` (not a normal rate limit) until billing is configured, even though moderation calls themselves are free.
- **No raw SQL** — Prisma parameterized queries throughout.
- **CSRF** — handled by Next.js Server Actions' built-in origin check plus NextAuth's own CSRF token for the auth endpoints.
- **Data control** — free JSON export and hard account delete for every user (`src/app/actions/profile.ts`), with cascading deletes configured in `prisma/schema.prisma` so deletion never fails or gets stuck on FK constraints.
- **Audit trail** — every moderation action (warn, suspend, ban) writes an `AuditLog` row with a reason, so enforcement is always explainable and appealable.
- **Ban vs. suspend** — `UserStatus` distinguishes a temporary `SUSPENDED` from a permanent `BANNED`; both are blocked identically at sign-in (`src/lib/auth.ts`) and on every subsequent page load (`src/lib/auth-guards.ts`, `src/lib/page-guards.ts` reject anything that isn't `ACTIVE`), so a banned session is rejected immediately even if the browser still holds a valid session cookie.
- **Direct-to-storage uploads** — avatars, post photos, and short video clips are uploaded straight from the browser to Cloudflare R2 via short-lived (5 min) presigned PUT URLs (`src/lib/storage.ts`), never through a Next.js server function — avoids routing large files through serverless request-body limits. The real file size is re-verified server-side after upload via `HeadObjectCommand` (a presigned PUT alone can't cap size); oversized objects are deleted immediately. The S3 client is configured with `forcePathStyle: true` so presigned URLs always resolve to `{accountId}.r2.cloudflarestorage.com/{bucket}/...` — the AWS SDK's default virtual-hosted-style (`{bucket}.{accountId}.r2.cloudflarestorage.com`) would silently mismatch the CSP `connect-src` allowlist and get blocked by the browser. **R2 is live and verified working end-to-end** (avatar + image post tested through the real UI).
- **Theme preference** is a non-sensitive, non-httpOnly cookie (`yk3-theme`) — no session or auth implications.
- **SSRF-guarded remote image fetch** (`src/lib/fetch-remote-image.ts`) — "add an image from a URL" in the post composer has our server fetch a user-supplied URL, so it's the one place this app makes an outbound request to an address a user picks. Guarded by: resolving DNS ourselves and refusing to connect to any private/loopback/link-local/CGNAT/multicast/reserved address (including `169.254.169.254`, the cloud metadata endpoint) before ever calling `fetch()`; `redirect: "manual"` so a public-looking URL can't 302 into an internal one; content-type allowlist (JPEG/PNG/WebP only); and a streamed size cap that aborts mid-download rather than buffering an oversized response first. Documented residual gap: this doesn't pin the TCP connection to the exact IP we checked, so it isn't fully DNS-rebinding-proof — `fetch()` re-resolves the hostname itself at connect time, after our check already passed. Accepted as the realistic threat-model tradeoff for this app; a fully pinned connection would need a custom low-level dispatcher.
- **Video embeds (YouTube/Vimeo) don't route through our moderation** — a pasted video link is parsed into a `provider` + `videoId` pair via a strict per-host allowlist (`src/lib/video-embed.ts`); nothing else about the URL (query params, path beyond the ID) is ever stored or trusted, and the iframe `src` is always rebuilt server-side from just those two values — never the raw pasted string — so no attacker-controlled string can become an iframe src. The linked video's actual content is moderated by YouTube/Vimeo, not by this app's `moderateMedia`; only the post's own caption text goes through our moderation gate. CSP `frame-src` (`src/proxy.ts`) is locked to exactly `youtube-nocookie.com` and `player.vimeo.com`.

## Security sweep — 2026-08-19: findings and fixes

A full-app review (auth/session, every `src/app/actions/*.ts` for IDOR,
every API route/webhook, mobile manifest) turned up and fixed:

- **Private Circle posts were readable via direct `/post/[id]` URL**,
  bypassing Circle membership entirely — that page's `canView` only checked
  the author's global `postsVisibility` and connection status, never
  `post.circleId`, unlike the feed's `getVisiblePostsWhere` (`src/lib/post-visibility.ts`).
  A signed-in non-member who got a post id from a notification, share link,
  or by guessing could view a private Circle's post and comments. Fixed by
  wiring the page to `getVisiblePostsWhere` directly; added a `canViewPost`
  helper (same file) and applied it to `toggleLike`, `createComment`,
  `toggleRsvp`, `repost`, and both `recordShare`/`shareToCircle` — none of
  those previously verified Circle access before acting on a client-supplied
  `postId`, and `repost`/`shareToCircle` specifically could have republished
  a private Circle's post outside it.
- **`getCollabRecordingLink`/`getLiveStreamRecordingLink` didn't verify a
  `recordingId` belonged to the caller's own room** before minting a Daily
  download link — any participant of *any* collab/stream (or, for the
  live-stream variant, any verified user at all — the function took no room
  parameter) could pass in a `recordingId` scoped to a different, possibly
  private session. Fixed by cross-checking against `listRoomRecordings` for
  that specific room first; `getLiveStreamRecordingLink` now requires
  `liveStreamId` as a parameter.
- **`unsubscribeFromPush` deleted any `PushSubscription` row matching the
  given `endpoint`, with no owner check** — fixed to scope by `userId` too,
  matching `unregisterFcmToken`'s existing pattern.
- **`setPassword` let a hijacked/stolen session cookie be escalated into a
  durable password-login backdoor** — updating an *existing* password
  required no re-authentication and didn't invalidate other sessions or
  notify anyone. An attacker with only transient session access (XSS,
  malware, a shared device) could set a password of their choosing and
  retain account access indefinitely, long after the original stolen cookie
  expired or the victim "logged out." Fixed: changing an existing password
  now requires the current password (rate-limited) and sets
  `sessionInvalidatedAt`, forcing every other session — including any
  attacker-held copy of the stolen cookie — to re-authenticate. See "Session
  revocation" above.
- **IP-scoped auth rate limiters used the raw, unparsed `x-forwarded-for`
  header** instead of the app's own `getClientIp()` (which takes only the
  first hop) — inconsistent with the safer pattern already used for
  `/advertise`. Unified onto `getClientIp()` for sign-in, password login/
  signup/reset-request.
- **Android `allowBackup="true"`** meant the WebView's cookie storage
  (including the live session cookie, since the native app is a thin WebView
  over `https://yukon3t.com` — see CLAUDE.md) was eligible for Android's
  default app-data backup/restore, a session-jacking vector via device
  backup/migration or `adb backup` on older Android versions. Set to
  `"false"` in `android/app/src/main/AndroidManifest.xml`. **Native-code
  change — only reaches real users through a new Play Store release**, per
  the mobile note in CLAUDE.md.
- Corrected stale docs (this file and `CLAUDE.md`) claiming sessions use the
  Prisma `"database"` strategy — the app actually uses `"jwt"` for both
  sign-in paths; neither ever writes to the `Session` table. Left uncorrected
  documentation like this is itself a risk: it invites a future change to
  assume DB-row deletion revokes a session, when only `sessionInvalidatedAt`
  does.

**Reviewed and found sound, no changes made**: webhook signature
verification (Stripe, cron `Authorization: Bearer` via `timingSafeEqual`),
the SSRF guard in `fetch-remote-image.ts` (DNS-resolved-IP blocklist checked
before connecting, `redirect: "manual"`, streamed size cap), presigned
upload key scoping in `storage.ts`, CSP/HSTS/frame headers, cookie flags and
session-fixation resistance on both sign-in paths, CSRF (Server Actions'
built-in origin check), user-supplied URL rendering (`linkUrl` fields are
scheme-restricted to `http`/`https` before ever reaching an `<a href>`),
Android/iOS network security config (no ATS exceptions, no cleartext, no
custom trust anchors), `npm audit` (0 findings, prod and dev). Every other
`src/app/actions/*.ts` file — messages, connections, circles, channels,
collab, comment edit/delete/hide, calls, blocks, reports/moderation,
profile, and all `requireAdmin`-gated actions — correctly re-derives the
actor and checks ownership/membership before writing.

## Device-based step-up verification — status: built locally, pending migration + deploy (2026-09-14)

**What it does**: recognizes the browser/app-install a user normally signs in from, and requires an emailed one-time code before allowing three sensitive actions from a device it doesn't recognize: signing in (password *or* magic-link/Google OAuth), changing an existing password, and creating a post. Built in response to an explicit ask to treat new-device sign-in, new-device password changes, and new-device posting as suspected social-engineering/session-jacking risk and gate them behind identity re-verification, rather than just alerting after the fact.

- **Device identity**: `src/proxy.ts` mints a long-lived (1 year), httpOnly, random `yk3-device` cookie the first time a request arrives without one — no signing needed (it carries no trust by itself, it's only a lookup key, and httpOnly+Secure already stops client JS/a network attacker from setting or reading it). Threaded through as an `x-device-id` request header too, so the very first request can read the id it was just issued before the browser has stored and resent the Set-Cookie. Deliberately edge-safe (no Prisma/DB access in proxy.ts, matching the existing CSP-nonce logic there) — the constants live in `src/lib/device-id-constants.ts` specifically so `next/headers` (Server Component/Action-only) never gets pulled into the edge middleware bundle.
- **`KnownDevice`** (`prisma/schema.prisma`) records a `(userId, deviceId)` pair once it's proven itself. **The account's very first-ever device is auto-trusted** (`evaluateDevice` in `src/lib/device-trust.ts`) — nothing to compare against yet, so this never blocks a brand-new signup's first sign-in, and (since the table starts empty) it also means **no existing user gets challenged on their very next login after this ships** — their current device becomes their first KnownDevice row transparently. A real caveat of that: a user who was already signed in on *two* devices before this shipped (say a laptop and a phone) will have their first gated action from whichever device hits one first auto-trusted, and then get challenged on the other the first time *it* hits a gated action — a one-time rollout friction cost, not a bug.
- **`SecurityChallenge`** is the pending step-up itself — a 6-digit code (same generation/hashing as the existing signup email OTP, `src/lib/otp.ts`), 10-minute TTL, 5 max attempts, emailed via the existing Resend integration (`src/lib/email.ts`) — **no SMS/Twilio cost added**, per the explicit choice to keep this free for every user regardless of phone-verification status. `PASSWORD_CHANGE` challenges stash the already-computed new bcrypt hash on the row (`newPasswordHash`) so the settings form doesn't need to re-collect the password after the redirect to the code-entry step — never plaintext.
- **Password login** (`loginWithPassword`, `src/app/actions/password-auth.ts`): on an unrecognized device, pauses *before* `issueSessionCookie` — creates the challenge, sets a short-lived signed pending-challenge cookie (same pattern as `src/lib/pending-verification.ts`), and redirects to `/sign-in/verify-device`. `confirmLoginDeviceChallenge` there verifies the code, trusts the device, and only then issues the real session.
- **Magic-link and Google OAuth** (`signIn` callback, `src/lib/auth.ts`): same challenge/cookie/redirect mechanism, wired into NextAuth's `signIn` callback returning the verify-device URL instead of `true` — this aborts session issuance for that attempt without letting the (already single-use-consumed) magic-link token or OAuth code be replayed. **Wrapped fail-open in a try/catch**: this is the app's primary sign-in method, and a bug or transient issue in this brand-new subsystem must never be able to lock every magic-link/OAuth user out — on any unexpected error it logs and falls through to allowing the sign-in, same as this app's existing "infra outage fails open" pattern for rate limiting.
- **Password change** (`setPassword`, `src/app/actions/profile.ts`): only gated on the *existing*-password-change branch (an "add a password" from a magic-link-only account has nothing to re-prove, unchanged). Directly closes the gap SECURITY.md already called out for this action: the existing current-password requirement stops a hijacked session from installing a password backdoor only if the attacker doesn't already have the real current password (e.g. via a phished/keylogged session) — a device they've never used is the one signal that scenario can't fake.
- **Posting** (`createPost`, `src/app/actions/circles.ts`): held before any upload-size verification/moderation runs, so nothing partial needs unwinding. Returns `{ error: "device_verification_required", challengeId }` instead of redirecting (this action is called from a client component, not a form post) — `post-composer.tsx` shows an inline 6-digit code field without losing the draft or already-uploaded media, and on success resubmits the *exact same* `createPost(fd)` call, which now sails through since the device is freshly trusted. `confirmPostDeviceChallenge` deliberately only trusts the device and reports back rather than creating the post itself, to avoid duplicating `createPost`'s validation/moderation pipeline a second time.
- Every send/check is rate-limited (`deviceChallengeSend`/`deviceChallengeCheck`, `src/lib/rate-limit.ts`, same send-vs-check split as the existing email/phone OTP limiters) and logged to `AnalyticsEvent` (`DEVICE_CHALLENGE_SENT/PASSED/FAILED`, `DEVICE_TRUSTED`) — visible on `/admin/analytics`.
- **Migration `20260914070000_add_device_trust_security_challenge` is written but not yet applied to any database**, and none of this has been deployed — `npx prisma generate` was run locally (safe, no DB connection) so the app typechecks/builds/lints/tests clean (`npm run typecheck`, `npm run lint`, `npm test` — 93/93 passing, `npm run build` succeeds including the edge middleware bundle), but `prisma migrate deploy` (or `dev`) was deliberately **not** run against the shared Neon database per an explicit decision to check in before touching production for this change. Apply the migration and deploy (`git push` for Netlify, `vercel --prod` for Vercel — see "Dual deployment" in CLAUDE.md) only once reviewed.
- **Deliberately out of scope for this pass** (flag for a future request, don't assume these are covered): messages/comments/reposts/shares aren't device-gated (only login, password change, and posts, per the specific ask); the `resetPassword` forgot-password flow isn't gated (a reset token is already equivalent-strength proof to a magic link, and it already invalidates every other session on completion); and there's no mid-session anomaly detection (e.g. the same session JWT suddenly presenting a different device cookie — a heuristic worth building, but a legitimate false-positive source, e.g. a cleared cookie jar, made it too risky to ship as a blocking check without more design time). A device-management UI ("sign out this device", listing `KnownDevice` rows) doesn't exist yet either.

### Content-from-other-apps moderation — audited, no gap found (2026-09-14)

Re-verified the existing moderation gate (`src/lib/moderation.ts`, `src/app/actions/*.ts`) specifically against "share to YuKon3t from another app": the native Android Share sheet path (`src/lib/share-receiver.ts` → `share-target-store.ts`) does nothing but populate the exact same client-side composer/chat state a manually-attached photo, video, or typed caption would — it's consumed once, then flows through the same `createPost`/`sendMessage` server actions as everything else, which already run every post/comment/message/bio through OpenAI's text+image moderation before publish (see "Content moderation gate" above), with flagged media rejected and deleted outright, never stored pending. No separate code path exists for shared-in content to bypass. The two documented, deliberate exceptions to that gate — GIFs (trusted via Giphy's own pre-moderated catalog, gated by `isGiphyUrl`'s host check) and linked-video embeds (the video itself is moderated by YouTube/Vimeo, not this app) — apply identically regardless of whether the GIF/link was picked from this app's own pickers or arrived via the share sheet; both were already deliberate, budget/API-driven decisions recorded above, not left unreviewed.

## Secret chats (end-to-end encrypted message text) — status: built, verified in a browser, 2026-09-20

Opt-in, **1:1 conversations only**, and **text only**. Both people turn it on; until both have, the chat is an
ordinary (scanned) chat and the UI says so. Groups are never secret.

**Design** (`src/lib/e2ee/`, browser Web Crypto only — no third-party crypto code):
- One long-lived ECDH **P-256** identity key pair per user. For a conversation both sides derive the same 256-bit key:
  `HKDF-SHA256(ECDH(myPrivate, theirPublic), salt = conversationId, info = "yukon3t-secret-chat-v1")`.
- Each message: **AES-256-GCM**, fresh random 96-bit IV, AAD = `conversationId + senderId`, so a ciphertext can't be
  replayed into another conversation or attributed to another sender. Stored in `Message.content` as
  `e2ee:v1:<iv>:<ciphertext>` — no message-table schema change.
- The private key is backed up encrypted under the user's **recovery passphrase** (PBKDF2-HMAC-SHA256, 600,000
  iterations, → AES-256-GCM, AAD = user id) in `UserEncryptionKey.wrappedPrivateKey`. The server holds the public key and
  that opaque blob; it never holds anything that decrypts either.
- On the device the private key lives in IndexedDB as a **non-extractable** `CryptoKey` (`key-store.ts`).

**What the server enforces** (`secret-chat.ts`, applied in `sendMessage` / `editMessage`, unit-tested):
- In a secret chat, non-empty text **must** be well-formed ciphertext — plaintext is refused (`plaintext_in_secret_chat`).
- In a chat that is **not** secret, ciphertext-looking text is refused (`not_a_secret_chat`). Without this the
  `e2ee:v1:` prefix would be a way to skip text moderation, since the server never scans ciphertext.
- Nothing from a secret chat reaches the moderation API; push previews say "New secret message"; the inbox says
  "🔒 Secret message"; story replies are declined there; corrections are not offered. The client also refuses (throws)
  rather than ever falling back to plaintext when it can't encrypt.
- Reporting a message from a secret chat attaches the **reporter's decrypted text** as `Report.evidenceText`. The admin
  queue labels it reporter-supplied and unverifiable. `fileReport` now also verifies the reporter is in the
  message's conversation and derives the accused from the message.

**What is NOT protected — by design or by limitation:**
- **No forward secrecy.** The identity key is long-lived; anyone who obtains a device's unlocked key can decrypt that
  chat's stored history. (A double-ratchet protocol was considered and declined for now.)
- **The server delivers public keys**, so a malicious or compromised server could substitute one (a man-in-the-middle).
  Mitigations: the **security code** (both people compare it out of band) and trust-on-first-use **key-change
  warnings** per conversation. Neither helps a user who never compares codes.
- **Metadata is visible to us:** who talks to whom, when, message sizes and counts, that a chat is secret.
- **Media is not encrypted** (photos, videos, voice notes, GIFs) and is still scanned — a deliberate choice, not a bug.
- **Anything sent before both people opted in stays plaintext**, and turning secret chat off returns to scanned plaintext.
- **A stolen session can fetch the passphrase-encrypted backup** and guess offline. PBKDF2 at 600k iterations and a
  12-character minimum (the real protection is a long passphrase) slow that; the fetch is rate-limited
  (`e2eeBackupFetch`, 10/h). It cannot be prevented.
- **Page XSS** cannot read the non-extractable key out, but could ask the browser to use it while the page is open.
- **Forgetting the passphrase is unrecoverable.** `resetEncryptionKeys` deletes the keys; messages under the old key can
  then never be read again by either person, and the user's secret chats switch off.
- Length is not hidden (no padding); a secret message is capped at 2,900 bytes so ciphertext fits the 4,000-char column.

## Known gaps / accepted risk

- **Phone/ID verification was descoped** from the MVP to stay under the $200 budget (SMS OTP costs money per verification). Trust score is computed from free signals only (email verified, account age, profile completeness, report history). See the plan's budget-reconciliation note.
- **Video content is not frame-by-frame scanned.** Only the text caption and a single client-captured thumbnail frame are moderated before a video post is accepted — full video moderation (Hive, AWS Rekognition Video, etc.) costs money per minute processed and is out of budget for this pass. This is the deliberate trade-off behind the zero-tolerance policy: automated screening catches the obvious cases at the point of upload; user reporting plus the admin Ban action are the backstop for anything that gets past it. Revisit if report volume on video content shows this gap is being exploited.
- **No automated strike/escalation system** — a rejected upload just tells the user why and discards it; there's no counter that auto-escalates repeat offenders to a ban. Admins ban manually from the moderation queue based on reports. Worth building once there's real abuse-pattern data to design it against, rather than guessing at thresholds now.
- **Upload size is enforced after the fact** (via `HeadObjectCommand` + delete), not prevented at the presigned-URL level — a small window exists where an oversized file briefly lands in the bucket before being removed. Acceptable given R2's free-tier storage headroom and that this only affects authenticated, rate-limited, trust-scored users.
- **2026-09-08 security sweep**: `npm audit` found a **critical unauthenticated RCE in Next.js** (GHSA-p293-qw3h-jr36, Windows-hosted servers; plus GHSA-2xp9-vwfh-vxw4, RCE via the Image Optimization API with AVIF files), both fixed upstream in `16.3.3`/`16.3.4` — upgraded `next` from `16.2.12` to `16.3.4` (also bumped `eslint-config-next` to match, avoiding lint-rule/framework version drift). Also fixed: `sharp` (`^0.35.3` → `^0.35.4`, libheif CVEs GHSA-g89c-p67h-r497/GHSA-2jg2-4ch7-h545) and `js-yaml` (indirect, ReDoS-shaped CWE-400/407, via `npm audit fix`). All four were real production-facing findings, now clean. **Deferred**: `vitest`/`@vitest/mocker`/`@vitest/ui` (moderate, a path-traversal in a test-mocking redirect feature) needs a major `vitest` 4→5 bump that hit an unrelated peer-dependency conflict with `@capacitor/cli`'s toolchain; left unfixed since this is dev/test-only tooling that never ships to production and the vulnerability requires local control over test inputs to matter at all — re-attempt once Capacitor's own tooling updates past that conflict, don't force it blind before then.
- **`AUTH_SECRET` in `.env` is a dev placeholder** (`dev-only-secret-change-before-deploy-CHANGE-ME`). Generate a real one with `openssl rand -base64 32` before deploying anywhere reachable.
- **In-memory rate limiting fallback** only applies when Upstash env vars are unset (local dev). Production deploys must set `UPSTASH_REDIS_REST_URL`/`TOKEN` or rate limits silently reset per serverless instance.
- **GIF attachments (messages/posts/comments) skip this app's own moderation pipeline entirely**, trusting Giphy's pre-moderated catalog instead — deliberate, since Giphy's search API returns no way to fetch the underlying file for our own OpenAI/Hive moderation to inspect, and re-hosting every result through R2 first just to moderate it would add real cost/latency for content already moderated upstream. `isGiphyUrl` (`src/lib/giphy.ts`) is the only gate: it validates the attached URL's host is actually `giphy.com`/`*.giphy.com` before accepting it, which is what stops a client from smuggling an arbitrary external URL through this path — never widen that check to a generic `https:` allowlist. (Originally built against Tenor; swapped to Giphy after discovering Google had frozen new Tenor API registrations in Jan 2026.)

## Username/password auth, age verification, real-time-ish chat — status: live

**Username/password auth** (`src/app/actions/password-auth.ts`) is additive to
the existing magic-link flow, not a replacement — either method signs into
the same account. It's implemented as fully custom server actions, not
NextAuth's own Credentials provider, because Auth.js's Credentials provider
doesn't support this app's status/verification-gated login logic (locked-out/
unverified/suspended accounts, etc.). Sessions use the **`"jwt"` strategy**
(`src/lib/auth.ts`) for both sign-in methods — despite the schema having a
`Session` table (kept for the Prisma adapter's other uses), neither path
writes a row to it. Instead, `loginWithPassword` hand-encodes a JWT cookie
identical in shape/secret/name to the one Auth.js's own callbacks would
produce (`src/lib/session-token.ts`, cookie name from `src/lib/auth-cookie.ts`
computed from whether `AUTH_URL` is `https://`) — verified compatible with
`auth()` everywhere else in the app via real end-to-end tests (signup →
verify → login → `page-guards` onboarding redirect all worked without
touching a single other file). Passwords are hashed with `bcryptjs` (12
rounds, pure JS — no native build step, chosen specifically to avoid Windows
dev-machine native-module pain). Email verification is a single-use token in
the same `VerificationToken` table NextAuth's adapter uses; login is rejected
until `emailVerified` is set. Existing magic-link-only users can add a
username/password from Settings (`setPassword` action) without needing
their old password (there isn't one) — just proves ownership via their
existing session; changing an *existing* password now re-requires the
current password and invalidates every other session
(`sessionInvalidatedAt`) — see "Session revocation" below.

**Session revocation, since JWTs are stateless**: there is no server-side
token to delete on logout, ban, suspend, or password change. `requireUser()`
(`src/lib/auth-guards.ts`) instead checks `User.sessionInvalidatedAt` against
the JWT's own `issuedAt` claim on every request — any token issued before
that timestamp is rejected and the user must sign in again. This is set on
password reset (`resetPassword`) and on password change (`setPassword`);
plain `signOut()` only clears the local cookie and does **not** set
`sessionInvalidatedAt` (a captured/replayed copy of the cookie stays valid
until its `maxAge` naturally expires — the same tradeoff most stateless-JWT
apps make, since there's no per-device session identity to revoke
individually). Any future "log out this device" or "kill session" feature
must go through `sessionInvalidatedAt` (or a real per-session revocation
list), not the unused `Session` table.

**Age verification**: `User.birthDate`, required at password sign-up and
at onboarding (for magic-link users), enforced via `isOldEnough()` in
`src/lib/validations.ts` — minimum age 13, self-declared, no paid ID-check
service (consistent with the project's existing budget-driven trust-score
design — see "phone/ID verification descoped" above). **Not retroactive**:
existing users who onboarded before this shipped are not forced to
re-verify. `legal/terms` eligibility section updated to 13+
(with a parent/guardian clause for under-18s) — it previously said 18+,
left over from the original boilerplate; reconciled to match the actual
enforced age, per an explicit choice made when this was built, not an
oversight.

**Real-time-ish chat with delivered/read receipts**: originally no
WebSocket/SSE infrastructure — deliberately short-interval (~3s) polling
instead, to stay on the "no added paid services" budget line the rest of
this project followed at the time. Superseded on 2026-09-16: chat (and
every other polling-based "live" surface in the app — nav badges, calls,
live streams, Circle voice, Collab sessions, the Home feed) now runs on
Supabase Realtime Broadcast instead of polling — see CLAUDE.md's "Realtime
layer" section for the design (public signal-only channels, no Supabase
Auth/Postgres involved) and `src/lib/realtime-server.ts`/`realtime-client.ts`.
`Message.deliveredAt`/`readAt` (nullable, two separate columns —
conversations here are always exactly 2 people, so no join table needed)
are unchanged.
**Real bug found and fixed during testing**: the first implementation
called the read-marking mutation directly inside the `/messages/[id]`
Server Component's render. Next.js prefetches `<Link>` targets that are
merely visible in a list (e.g. every conversation row on `/messages`, or
the nav's own `/messages` link on every page) — this silently marked
messages "read" before the user ever opened the thread, just from the link
being on screen. Fixed by moving both the read-marking (`ChatThread`, on
mount) and delivered-marking (`MarkDelivered`, on the `/messages` list) to
client-only `useEffect` calls, which only run after real hydration in a
live browser — never during SSR or prefetch. Worth remembering for any
future "mark as seen"-style feature: never mutate on the server-rendered
path of a page that could be a `<Link>` prefetch target.

**Emoji picker** (`emoji-picker-react`, wired into both chat and post
composer) uses `EmojiStyle.NATIVE` — renders actual Unicode glyphs via the
system font — instead of the library's default, which fetches emoji
images from `cdn.jsdelivr.net` per render. The CSP's `img-src` already
permits any `https:` source so the CDN images wouldn't have been blocked,
but native rendering avoids the third-party requests (and the associated
IP-address leakage to jsdelivr on every emoji hover) entirely, and loads
instantly with no network round trip.

**Bottom tab bar** (mobile only, `<md`): Discover/Circles/Collab/Messages/
Profile, Instagram/WhatsApp/TikTok-style. Connections moved into the
secondary hamburger menu to keep the bar to 5 items — the hamburger drawer
still exists on mobile for Connections + Settings + Moderation + Theme +
Sign out.

## Media uploads (Cloudflare R2) — status: live

R2 is configured in `.env` (bucket `yukon3t-media`) and verified working end to end through the real running app (not just the SDK): avatar upload, an image post, and a short video post (real 4-second MP4, generated with ffmpeg and pushed through the actual composer UI) all landed correctly in the bucket, rendered from the public `r2.dev` URL, and — for the video — played back correctly with the client-captured thumbnail as the poster frame. `isStorageConfigured()` still gates every upload path so the app degrades gracefully to a "not set up yet" message if these env vars are ever unset (e.g. in a fresh environment/deploy target that hasn't been configured yet).

To reproduce this setup elsewhere (a new deploy target, a teammate's machine):

1. Create a Cloudflare account and an R2 bucket.
2. Create an R2 API token (Object Read & Write, scoped to that bucket). Copy the Access Key ID and Secret Access Key immediately — R2 shows the secret once. If a `SignatureDoesNotMatch` error shows up when testing, it almost always means one of these two values got mistyped in transcription — regenerate the token rather than trying to guess the typo.
3. Enable public access on the bucket (R2.dev subdomain or a custom domain) to get a public base URL.
4. **Configure CORS on the bucket** to allow direct browser uploads — without this, the client's presigned PUT will be blocked by the browser:
   ```json
   [{"AllowedOrigins": ["https://your-domain.com"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["Content-Type"]}]
   ```
   (add `http://localhost:3000` too for local testing)
5. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` in `.env`.
6. Restart the dev server — `src/proxy.ts` reads `R2_ACCOUNT_ID`/`R2_PUBLIC_URL` at request time to open the CSP's `connect-src`/`media-src`/`img-src` only as far as needed.

### QuickTime (.mov) uploads and their conversion (2026-09-21)

Every video upload kind accepts `video/quicktime` (an iPhone's default; storage.ts `CONTENT_TYPE_ALLOWLIST`). An iPhone's
HEVC `.mov` plays only in Safari/hardware-HEVC browsers, so the `convert-mov-videos` cron (`src/lib/video-convert.ts`,
`video-convert-db.ts`, `api/cron/convert-mov-videos`, state in `VideoConversion`) re-encodes each one to an H.264 MP4 and
swaps the stored URL. Consistent with the no-ffmpeg-on-untrusted-bytes policy above, the decode/encode happens on
**Cloudflare Stream** (copy the R2 object in → request the MP4 download → stream Stream's own output back into R2 next to the
`.mov`, same owner path segment → update every row holding the URL → delete the `.mov` and the Stream copy). Our code only
handles URLs and Stream's well-formed output; it refuses a download URL that isn't `https://*.cloudflarestream.com`. Fail-soft:
after 3 failed attempts the original `.mov` is left in place. Until the swap lands, viewers get the `.mov` (plays wherever it
always did). Needs `CLOUDFLARE_STREAM_*` + R2 configured, else the cron does nothing. Not covered: thumbnails are still
captured in the uploader's own browser, so a browser that cannot decode an HEVC `.mov` still cannot create a thumbnail for it.

## Automated database backups — status: built, pending bucket setup (2026-09-16)

A daily encrypted logical backup of every table (`src/lib/db-backup.ts`, driven by the `backup-database` cron — same Netlify Scheduled Function pattern as every other `src/app/api/cron/*` route, see `netlify/functions/backup-database.mts`) uploads to a dedicated R2 bucket. `restore-database-backup.ts` (`npm run db:restore-backup`) is the corresponding manual, deliberate restore path — it is never run automatically.

**Threat model / why this isn't just the media bucket:** a full data dump includes password hashes, emails, and private message content. The existing `yukon3t-media` R2 bucket (`R2_BUCKET_NAME`) is bound to a public URL (`R2_PUBLIC_URL`) that serves every object under it to anyone — writing backups there, even under a `backups/` prefix, would make the entire user database downloadable by anyone who found or guessed the URL pattern. Backups instead require a **separate `BACKUP_R2_BUCKET_NAME`** with no public access/custom domain configured at all, ideally with its own R2 API token scoped only to it (falls back to the media bucket's `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` if `BACKUP_R2_*` equivalents aren't set, for a minimal one-token setup). On top of that, the payload itself is encrypted (AES-256-GCM, keyed by `BACKUP_ENCRYPTION_KEY`) before it ever leaves the process — defense in depth in case the bucket or its credentials are ever misconfigured.

This is a logical (row-level JSON, gzip'd) backup, not a `pg_dump` binary dump — there's no Postgres client-tools binary available in a Vercel/Netlify serverless function, and schema is already fully version-controlled via `prisma/migrations` (restorable with `prisma migrate deploy`), so only the data needs its own backup path.

**Not yet live** — the cron is a no-op (503, logged, never a crash) until all of `BACKUP_R2_BUCKET_NAME`/`BACKUP_ENCRYPTION_KEY` (and `BACKUP_R2_ACCOUNT_ID`/`ACCESS_KEY_ID`/`SECRET_ACCESS_KEY` or their `R2_*` fallback) are actually set. To turn it on:

1. Create a **new, separate** Cloudflare R2 bucket — do not enable public access or bind a custom domain to it.
2. Optionally create a second R2 API token scoped only to that bucket (Object Read & Write) — otherwise the existing media token needs read/write on both buckets.
3. Generate an encryption key: `openssl rand -hex 32`. Store it somewhere durable outside this app (password manager, secrets vault) — losing it makes every existing backup unrecoverable, and it can never be recovered from the backups themselves.
4. Set `BACKUP_R2_BUCKET_NAME`, `BACKUP_ENCRYPTION_KEY`, and (if using a separate token) `BACKUP_R2_ACCOUNT_ID`/`BACKUP_R2_ACCESS_KEY_ID`/`BACKUP_R2_SECRET_ACCESS_KEY` on both Vercel and Netlify (env vars set on one platform don't reach the other — same gotcha as every other env var in this app, see "Dual deployment" in `CLAUDE.md`). `BACKUP_RETENTION_DAYS` defaults to 30 if unset.
5. The cron runs daily at 03:00 UTC once configured — no restart or redeploy needed beyond the env vars actually being set (Netlify Scheduled Functions read env at invocation time).

## Deployed to Vercel — status: live

Production is live at **https://yukon3t.vercel.app**, deployed via `vercel --prod` (project `yukon3t`, scope `ainabizpro-6934s-projects`). Real Neon Postgres (migrated), real `AUTH_SECRET`, real Resend, real R2 — sign-in tested end to end against the live deployment (magic-link request → Neon write → Resend send → verify-request page, zero console errors).

**Gotcha hit and fixed during this deploy**: `vercel --prod` deploys whatever's in the local project directory, which includes the local `.env` file — despite `.env*` being in `.gitignore`, Next.js's own build-time env loading (`@next/env`, not Vercel-specific) still finds and loads it from the uploaded source. For any env var **explicitly set** via `vercel env add`, the Vercel-injected value wins (dotenv never overrides an already-set `process.env` value). But for a var that's only defined in the local `.env` and never added to Vercel, the local dev value silently leaks into production. This bit `AUTH_URL` and `NEXT_PUBLIC_APP_URL` specifically — both were still `http://localhost:3000` from local dev, which broke the sign-in redirect (browser tried to navigate to `localhost:3000` and failed) until both were explicitly added as Vercel production env vars and the app was rebuilt (`NEXT_PUBLIC_APP_URL` is inlined at build time, so a rebuild — not just a runtime env change — is required for it to take effect).

**Takeaway for future deploys**: after `vercel env add`-ing the "obvious" secrets, run `vercel env ls production` and diff it against every key in `.env`/`.env.example` — anything present locally but missing from that list is a latent leak waiting to happen the moment it's actually read at runtime or build time.

## Deployed to Netlify — status: live (second, parallel deployment)

Production is also live at **https://yukon3t.netlify.app** (site `yukon3t`, same Neon database as Vercel — deliberately a second deployment, not a replacement, per the user's choice). Git-connected to `github.com/abyodun74/yukon3t` (`master` branch) with auto-deploy on push. Same full verification as Vercel: landing page clean, CSP nonce header confirmed present and correctly built from env vars (proves `src/proxy.ts` genuinely runs under Netlify's Edge Functions, not just that the build succeeded), real sign-in email sent (Neon write + Resend send), real avatar upload through the live site (R2 + CORS), and a real code change (category list edit) confirmed to reach the live site through the full webhook → build → deploy pipeline.

**Three real problems hit and fixed getting here — all worth knowing before touching this again:**

1. **Local Windows-only Netlify CLI bug.** `netlify deploy --prod` (which builds and bundles locally before uploading) fails bundling the middleware/proxy as an Edge Function, with a telltale malformed path in the error (`file:///Users/...C:/Users/...` — two path styles concatenated). Reproduced identically with both Turbopack and webpack builds, so it's not a bundler-format issue — it's Netlify CLI's edge-runtime module resolver mishandling Windows paths. **Fix**: never use local `netlify deploy` for this project on Windows; rely on Git-connected builds, which run on Netlify's own Linux servers and never hit this path.
2. **GitHub authorization went to the wrong account.** The user has two GitHub accounts; the dashboard "Link repository" flow authorized against `ainabizpro-eng` and auto-created an empty placeholder repo there, instead of connecting to the real `abyodun74/yukon3t` repo. Root-caused by inspecting `getSite`'s `build_settings.repo_path`/`repo_owner_type` via `netlify api` and cross-checking against `gh auth status`. **Fixed** by directly `updateSite`-ing the correct `repo_path`/`repo_branch`, then — since that bypassed the GitHub App's own authorization — generating a Netlify deploy key (`createDeployKey`) and adding it as a read-only Deploy Key on the GitHub repo via `gh repo deploy-key add`, and finally linking it with `deploy_key_id` on the site.
3. **Auto-deploy-on-push silently didn't work**, even after the repo was correctly connected — because the manual API-based reconnection never registered a GitHub webhook (that's normally created automatically by the proper OAuth/GitHub-App flow, which this project's cross-account mixup prevented). Confirmed via `gh api repos/.../hooks` returning empty. **Fixed** by creating a Netlify Build Hook (`createSiteBuildHook`) and registering it as a GitHub webhook (`gh api repos/.../hooks`, event `push`) pointing at that hook URL — verified with a real webhook delivery (200) and a real end-to-end push → auto-build → live site check.
4. Separately (not Netlify-specific): `src/generated/prisma` is gitignored, and Vercel silently auto-runs `prisma generate` for Prisma projects but Netlify doesn't — this broke the Netlify build with `Module not found: Can't resolve '@/generated/prisma/client'` until a `postinstall: prisma generate` script was added to `package.json`. This fix benefits Vercel too (removes reliance on undocumented platform magic) and any future CI target.

**Operational note**: Vercel (`vercel --prod`) and Netlify (Git push) now have **different deploy mechanisms** — pushing to `master` auto-deploys Netlify, but Vercel needs an explicit `vercel --prod` run. A change isn't "live everywhere" until both have happened.

### Custom domain: yukon3t.com

`yukon3t.com` (registered through Netlify Domains) is linked to the Netlify
site as its primary custom domain, TLS auto-provisioned by Netlify, `www`
also DNS-mapped to the same site. `AUTH_URL`/`NEXT_PUBLIC_APP_URL` on
Netlify point at `https://yukon3t.com` (updated via `netlify env:set
--context production`, then a build re-triggered to bake the new
`NEXT_PUBLIC_APP_URL` into the client bundle). Verified live: `http://` →
`https://` redirect (301) works, and a real `curl` against
`https://yukon3t.com/` returns 200 with the correct page title. **Note**:
on this Windows dev machine, `curl`/schannel can fail the TLS handshake
with `CRYPT_E_NO_REVOCATION_CHECK` if the network can't reach the CA's OCSP
responder — that's a local network/OS quirk, not a site problem; retest
with `curl --ssl-no-revoke` (or just a browser) before assuming the
certificate is broken.

R2 bucket CORS includes `https://yukon3t.com` alongside the
`.vercel.app`/`.netlify.app`/`localhost` origins — verified with a real
cross-origin `PUT` from a page actually loaded at `https://yukon3t.com`
(not just a curl request), confirming the browser's CORS preflight against
R2 succeeds for this origin.

### Resend sandbox mode blocked all real sign-ins (fixed)

After the custom domain went live, sign-in broke for everyone: NextAuth
showed a generic `/api/auth/error?error=Configuration` page (Auth.js
deliberately hides the real error from the browser for any error type not
on its small client-safe allowlist — this generic page can mean almost
anything). The real cause only appears in server logs
(`netlify logs --source functions`, need to `--follow` and retrigger live,
since historical function logs aren't otherwise fetchable): `EMAIL_FROM`
was still `onboarding@resend.dev`, Resend's shared sandbox address, which
**only accepts sending to the Resend account's own verified email** — every
other recipient gets rejected with a `validation_error`, surfaced to users
as the same generic Configuration page.

**Fix**: verified `yukon3t.com` as a real sending domain on Resend
(DKIM TXT on `resend._domainkey`, SPF via an MX + TXT on `send`, DMARC TXT
on `_dmarc` — added directly to the Netlify-hosted DNS zone via
`netlify api createDnsRecord`, `zone_id` + `body` shape, confirmed
resolving with Google's DoH resolver before verifying in Resend), then
updated `EMAIL_FROM` to `YuKon3t <noreply@yukon3t.com>` on both Netlify and
Vercel, redeployed both (Netlify via build hook, Vercel via `vercel --prod`
— env var changes need a redeploy on both platforms), and confirmed with a
real sign-in email that was actually received.

**Takeaway**: a NextAuth `Configuration` error on production is close to
meaningless on its own — always check function logs for the real
`[auth][error]` line before assuming what's broken.

### Manual/fallback deploy: `netlify-manual-deploy/`

A small folder with a script (`trigger-deploy.mjs`) and README for
redeploying Netlify on demand without a new commit — e.g. right after
changing an env var. It calls `netlify deploy --trigger --prod`, which
builds remotely on Netlify's Linux servers (same mechanism as the webhook),
deliberately avoiding the local Windows Edge Function bundling bug in
problem #1 above. The everyday path remains a plain `git push`.

## Before going to production (or redeploying elsewhere)

1. Set real `AUTH_SECRET`, `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL`/`TOKEN`, `OPENAI_API_KEY`, `DATABASE_URL` (Neon), R2 credentials, `AUTH_URL`, `NEXT_PUBLIC_APP_URL` as env vars on **every** deploy target (Vercel *and* Netlify) — not just in the local `.env` (see gotcha above; the Vercel gotcha applies to any platform that reads a locally-present `.env` during build).
2. Confirm `NODE_ENV=production` so the CSP drops `'unsafe-eval'` — both Vercel and Netlify set this automatically.
3. Re-run `npm audit` and `npm run build` in the deploy pipeline.
4. ✅ **Done** — first real admin account promoted on the live Neon database (`ainabizpro@gmail.com`, signed in via a real magic-link click, `isAdmin` set directly via Prisma). Verified with a short-lived, separate verification session that the "Moderation" nav link and `/admin/moderation` page both work, then removed that verification session without touching the real one.
5. ✅ **Done** — R2 bucket CORS policy includes `https://yukon3t.vercel.app`, `https://yukon3t.netlify.app`, and `http://localhost:3000` — verified with real uploads through both live sites.
6. ✅ **Done** — `OPENAI_API_KEY` is live on both deploys and verified actually blocking flagged content (see above), not just present.
