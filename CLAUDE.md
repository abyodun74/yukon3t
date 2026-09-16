# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev              # Next.js dev server (localhost:3000)
npm run build            # production build
npm run lint              # eslint
npm run typecheck         # tsc --noEmit
npm test                  # vitest run (all tests, once)
npm run test:watch        # vitest watch mode
npx vitest run src/lib/utils.test.ts   # run a single test file
npx vitest run -t "test name"          # run tests matching a name

npm run db:migrate                     # prisma migrate dev
npm run db:generate                    # prisma generate (custom output, see below)
npm run db:studio                      # prisma studio
npm run db:seed                        # tsx prisma/seed.ts
npm run db:backfill-embeddings         # tsx scripts/backfill-embeddings.ts
npm run db:backfill-group-discoverable
```

Tests are co-located `*.test.ts` files next to the source they cover (e.g. `src/lib/utils.test.ts`), run by Vitest in `node` environment — see `vitest.config.ts`.

### Mobile (Capacitor — Android/iOS wrapper)

```bash
npx cap sync android     # after changing native plugins/capacitor.config.ts
cd android && ./gradlew assembleDebug    # debug APK for sideloading/testing
cd android && ./gradlew bundleRelease    # signed AAB for Play Store (needs android/keystore.properties, gitignored)
```

**Native plugin patches**: `patch-package` (`postinstall` script) reapplies anything in `patches/` after every `npm install` — durable across reinstalls/CI, unlike hand-editing `node_modules` directly. Currently patches `@capacitor/share`'s Android plugin (`patches/@capacitor+share+8.0.1.patch`): its `isPresenting` flag only ever clears when the share sheet's own activity-result callback fires, which doesn't always happen if a share gets abandoned mid-flow (backgrounding/killing the app while the chooser or picked target app is on screen) — every subsequent `Share.share()` call then fails immediately with `"Can't share while sharing is in progress"`, regardless of which post or how much later it's retried. The patch resets the flag in `handleOnStart()` instead, so returning to the app always clears any stale pending share. **Like any native change, this only reaches real users through a new Play Store release** — `src/lib/native-share.ts` also has a web-deployable stopgap (a clearer, actionable message instead of the plugin's raw error text) for the currently-live app in the meantime. If `node_modules/@capacitor/share/android/build/` ever reappears from a local Gradle run, delete it before touching `patches/` again — `patch-package`'s git diff chokes on Windows over the resulting long build-artifact paths.

**Critical**: `capacitor.config.ts` sets `server.url: "https://yukon3t.com"` — the native app's WebView loads the **live deployed site directly**, it does not bundle a local copy of `src/`/`public/`. This means:
- Any change to `src/` reaches mobile users the instant it's deployed to the web (Netlify), no app update needed. **`yukon3t.com` itself resolves to Netlify, not Vercel** (confirmed via response headers — `Server: Netlify`) — when testing a fix on a real device, a `vercel --prod` alone does nothing for it; wait for Netlify's deploy (`git push` auto-triggers it) to reach `state: "ready"` for the right commit.
- Changes to `android/app/src/main/AndroidManifest.xml` (permissions, etc.) or any other native code are baked into the APK/AAB at build time and **only reach real users through a new Play Store release** — pushing to `master` does nothing for these. Bump `versionCode` in `android/app/build.gradle` on every release build (comment there explains the current floor).

## Architecture

**Stack**: Next.js 16 App Router (Server Components + Server Actions), NextAuth v5, Prisma 7 + Postgres (Neon in prod), Tailwind 4, Vitest. Deployed in parallel to **both Vercel and Netlify** off the same repo — see "Dual deployment" below.

### Server Actions are the primary write path

Almost all mutations live in `src/app/actions/*.ts` (one file per domain: `posts.ts`, `messages.ts`, `circles.ts`, `calls.ts`, etc.), not API routes. `src/app/api/` exists mainly for webhooks, cron, and things that must be a real HTTP endpoint (auth callbacks, push). Every action follows the same shape: re-derive the actor from the session server-side, check ownership/membership (`src/lib/auth-guards.ts` + per-file checks), validate input with Zod (`src/lib/validations.ts`), then touch Prisma. Don't skip any of these three steps when adding a new action — it's the established pattern the whole app relies on for authorization.

### Prisma client has a custom output path

`prisma/schema.prisma`'s `generator client` outputs to `src/generated/prisma`, not the default `@prisma/client` location. Import as `@/generated/prisma/client` (or whatever's re-exported from `src/lib/prisma.ts`), not `@prisma/client` directly. This directory is gitignored — `npm install` runs `prisma generate` via `postinstall`, but a fresh clone or a CI target without that hook needs `npm run db:generate` before anything typechecks.

### `src/proxy.ts` is the middleware

Next.js 16 renamed `middleware.ts` → `proxy.ts` with a renamed export (`proxy`, not `middleware`) — this is a breaking change from older Next.js training data (see `AGENTS.md`). It sets a per-request CSP nonce and builds `connect-src`/`media-src` dynamically from `R2_ACCOUNT_ID`/`R2_PUBLIC_URL` so the CSP only opens up once media upload env vars are actually configured.

### Auth: dual sign-in methods sharing one session mechanism

NextAuth v5 (Resend magic link) is the default, but `src/app/actions/password-auth.ts` implements a **fully custom** username/password path — not NextAuth's Credentials provider, because Credentials doesn't support the status/verification-gated login logic this app needs. Sessions use the **`"jwt"` strategy** (`src/lib/auth.ts`) — despite the schema having a `Session` table (kept for the Prisma adapter's other uses), neither sign-in path writes a row to it. `issueSessionCookie` (`src/lib/session-token.ts`) hand-encodes a JWT identical in shape/secret/cookie-name to the one Auth.js's own `jwt`/`session` callbacks would produce for magic-link/OAuth, so `auth()` reads either path's cookie identically. Because JWTs are stateless, there's no server-side token to revoke on logout or ban/suspend — `requireUser()` (`src/lib/auth-guards.ts`) instead checks `User.sessionInvalidatedAt` against the token's own `issuedAt` claim on every request; setting `sessionInvalidatedAt` (done on password reset and password change) is what actually forces re-authentication, not deleting anything. If you touch session/cookie logic, both paths need to keep working, and any new "kill this session" feature must go through `sessionInvalidatedAt`, not the `Session` table.

### Media uploads: direct browser → R2, never through the Next server

Avatars, post images, and videos upload straight from the browser to Cloudflare R2 via short-lived presigned PUT URLs (`src/lib/storage.ts` mints them server-side; `src/lib/upload-client.ts` does the client-side PUT with retry/timeout logic). This is deliberate — it avoids serverless request-body limits, and images are resized **client-side via `<canvas>`** before upload rather than server-side (no `sharp`/libvips in the untrusted-image path — see `SECURITY.md`). `resizeImageFile`/`captureVideoFrame` in `upload-client.ts` read the canvas output into a plain `ArrayBuffer` before wrapping it in a `File` — this isn't stylistic, it works around a real Android WebView bug where a `canvas.toBlob()` Blob can be backed by an already-invalid temp file, failing instantly with `net::ERR_UPLOAD_FILE_CHANGED` on both the upload PUT and even a same-page `<img>` preview of it.

Real file size is re-verified server-side after upload (`HeadObjectCommand`); a presigned PUT alone can't cap size.

### Moderation gate

Post/bio/message text goes through OpenAI's moderation endpoint before being stored visible (`src/lib/moderation.ts`); flagged text is stored as `FLAGGED`, not shown. Images and video-thumbnail frames go through the same endpoint's image moderation and are rejected/deleted outright (stricter than text — no pending state). New user-generated text or media surfaces should go through this, not bypass it.

Post videos over Hive's 60s scan limit (`HIVE_VIDEO_MODERATION_MAX_SECONDS`, `src/lib/storage.ts`) publish hidden (`moderationStatus FLAGGED`) and get a second, separate automated pass: `src/lib/video-review.ts`, driven by the `moderate-long-videos` cron. This deliberately does **not** run ffmpeg (or any native media binary) on the untrusted uploaded file — same reasoning as avoiding `sharp`/libvips on untrusted images (see `SECURITY.md`), just for video's larger CVE surface. Instead `src/lib/cloudflare-stream.ts` uploads the video to Cloudflare Stream, which is the actual decode boundary; this app's own code only ever touches Stream's own well-formed API output (thumbnail-at-timestamp images fed straight into `moderateImage`, and an AI-generated WebVTT transcript fed into `moderateText` plus a plain wordlist profanity check in `src/lib/profanity-wordlist.ts`, since OpenAI's moderation categories don't cover mere cursing). A flagged video is deleted outright (`removeModeratedContent`), matching the existing strict media policy — not left in the admin queue like a caption/thumbnail flag; the uploader is told why via `notifyVideoModerationFailed` (`src/lib/video-moderation-notice.ts`), naming the specific violation type(s).

This pipeline is tuned to reach a verdict as close to real time as Cloudflare's own copy/encode/caption processing allows: `createPost` (`src/app/actions/circles.ts`) kicks off the Cloudflare Stream copy the moment the post is created rather than waiting for the cron to discover it, and the cron route (`src/app/api/cron/moderate-long-videos/route.ts`) actively polls each claimed post's progress for up to ~4.5 minutes per tick (`reviewOnePost`) instead of advancing one step and returning — so most videos reach a verdict within a single tick. The cron itself runs every minute and is now just the backstop that resumes a review still in progress past its tick's budget, or one whose eager kick-off never landed — not the primary driver of latency the way it was when it ran every 5 minutes and advanced exactly one post by one step per tick.

### Calls: Daily.co, embedded as an iframe

`src/lib/daily.ts` (server) creates/tokens Daily.co rooms via their REST API; `src/components/call-frame.tsx` embeds Daily's prebuilt call UI via `DailyIframe.createFrame()` — there's no hand-rolled WebRTC. Because the call UI lives in a cross-origin `*.daily.co` iframe, both `next.config.ts`'s `Permissions-Policy` (must use `camera=*, microphone=*`, not `(self)` — Permissions-Policy can't wildcard subdomains the way CSP can) and `src/proxy.ts`'s CSP `frame-src` need to allow it, or calls silently break.

Video calls also have a front/back camera flip button (`cycleCamera()`, wired up in both `call-frame.tsx` and the 1:1 `direct-call-frame.tsx`). **Don't gate its visibility on `enumerateDevices()` device-count or `track.getCapabilities().facingMode`** — confirmed live on a real Samsung phone that both are unreliable: some Android camera HALs collapse front+back into a single `videoinput` entry that switches facing mode via constraints instead of exposing two devices, and Android Chrome's `getCapabilities().facingMode` reporting is itself incomplete (a known Chromium/Android gap) — `cycleCamera()` worked fine on that exact hardware while both signals under-reported it, hiding the button entirely. The button is now gated on `Capacitor.isNativePlatform()` instead: this app's real mobile audience is the Capacitor wrapper (see below), where a front+back pair is a given, so there's no "dead click" risk to hide it against. The device-count/capabilities checks are kept only as best-effort fallbacks for a plain browser tab. If you touch this again, test on **real hardware** — a desktop browser's device emulation won't reproduce this (it just proxies the one physical webcam).

### Domain model (see `prisma/schema.prisma`)

- **Circles** (communities) → **Channels** → `ChannelVoiceParticipant` for live voice
- **Posts/Comments/Likes/Stories** — standard social graph
- **Collab** — `CollabBoardPost`/`CollabParticipant`/`CollabSessionParticipant`, a separate live-collaboration feature from Circles/posts
- **Connections** (follow/friend) + **Conversations/Messages** — conversations are always exactly 2 people (no group-DM join table; `deliveredAt`/`readAt` are plain nullable columns on `Message`), with ~3s polling instead of WebSocket/SSE (deliberate, see `SECURITY.md`)
- **Report/AuditLog/Block** — trust & safety; every moderation action writes an `AuditLog` row
- **PushSubscription/FcmToken** — web push + Firebase Cloud Messaging (mobile) live side by side

### Dual deployment: Vercel + Netlify, different mechanisms

Both are live off this repo, same Neon database. **Netlify auto-deploys on `git push` to `master`.** Vercel does **not** auto-deploy from this repo config — it needs an explicit `vercel --prod`. A change isn't "live everywhere" until both have happened. Env vars must be set separately on each platform (`vercel env add` / `netlify env:set`) — a var only present in local `.env` silently leaks into a Vercel build (Next's own env loading finds it) but is simply absent on Netlify. See `SECURITY.md` for the full incident history on this, including a Windows-specific `netlify deploy --prod` bundling bug (use git-push/build-hook deploys instead of the local CLI on Windows) and a GitHub-cross-account webhook mixup.

Both platforms' production builds run `scripts/migrate-if-production.sh` before `next build` (wired into `package.json`'s `build` script for Vercel, and directly into `netlify.toml`'s `command` for Netlify, since Netlify's build bypasses `package.json`'s `build` script entirely). That script runs `prisma migrate deploy` only when `VERCEL_ENV`/`CONTEXT` is `production` — a preview/branch build or local `npm run build` skips it, so an unmerged migration never touches the shared prod database early. Before this existed, a schema migration applied to local dev only (via `npm run db:migrate`) would deploy code that silently 500'd in production until someone applied the migration to Neon by hand — if you ever bypass this script (e.g. deploying a prebuilt artifact), apply the migration to production yourself first.

`SECURITY.md` also documents the full list of implemented security controls (CSP nonce, rate limiting via Upstash, SSRF-guarded remote image fetch, etc.) and known accepted gaps — read it before changing anything auth/upload/moderation-adjacent.

### Automated database backups

A daily encrypted logical backup of every table runs via the `backup-database` cron (`src/lib/db-backup.ts`), same Netlify Scheduled Function pattern as every other cron. It uploads to a **separate, private** R2 bucket (`BACKUP_R2_BUCKET_NAME`) — never the public media bucket (`R2_BUCKET_NAME`), which serves every object under it to anyone via `R2_PUBLIC_URL`. The cron no-ops (503) until `BACKUP_R2_BUCKET_NAME`/`BACKUP_ENCRYPTION_KEY` are actually configured; see `SECURITY.md`'s "Automated database backups" section for the full threat model and one-time setup steps. Restore is manual and deliberate only: `npm run db:restore-backup` (`scripts/restore-database-backup.ts`), never automatic.

### Scalability pass (2026-09-14)

A concurrent-user-focused audit (not a security one) found and fixed the real bottlenecks, in priority order:

- **Nav badge polling consolidated 4→1.** Messages/connections/notifications/announcements unread-counts used to be 4 independent `usePolling` loops (`src/components/nav.tsx`, `notification-bell.tsx`, `whats-new-bell.tsx`), each re-running `requireUser()`'s own DB lookup, all mounted for every signed-in user on every page. Now one `/api/badge-counts` route (`requireUser()` once, 4 count queries in `Promise.all`) backs one shared `useNavBadges` poll (`src/lib/use-nav-badges.ts`); `NotificationBell`/`WhatsNewBell` are now presentational, taking `count`/`unread` as props instead of self-polling. `post-feed-section.tsx`/`live-stream-strip.tsx`/`incoming-call-listener.tsx` were deliberately left as their own separate polls — each already just one poller with genuinely different data/latency needs (incoming-call in particular is latency-critical at 5s), so merging them would've added coupling risk without reducing request count.
- **Unbounded reaction/comment/story-viewer queries fixed.** `toggleLike`/`toggleCommentReaction` used to ship one row per reactor on every single like/react click — a viral post's full reactor list re-downloaded by every subsequent click. Now aggregated in Postgres via `groupBy` (`emoji`, `_count`) instead, returning `{emoji, count, reactedByMe}[]` (`src/lib/reactions.ts`) — correct at any scale, not just capped. `getPostComments`/the standalone `/post/[id]` page share one helper now (`src/lib/comments-data.ts`) that also batches this aggregation across every comment on the post in one query, and caps comment load at 500 (oldest-first — safe, since a reply's parent always precedes it, so `buildCommentTree` never orphans one). `getStoryViewers` similarly capped at 200. Message reactions were deliberately left untouched — a conversation is always exactly 2 people (see below), so a message can never have more than 2 reactions; genuinely unbounded growth isn't possible there. `ReactionBar` (shared by posts/comments/messages) now renders pre-aggregated summaries; `chat-thread.tsx` adapts its still-raw 2-row-max message reactions via `summarizeReactionRows` at render time rather than duplicating the DB-side aggregation for a case that doesn't need it.
- **Open question, unverified**: whether production `DATABASE_URL` (Vercel/Netlify) actually uses Neon's pooled (`-pooler`) endpoint rather than a direct connection. `src/lib/prisma.ts`'s own comment already flags this as what actually caps concurrent capacity in a serverless deployment — each function instance gets its own small connection pool (`max` defaults to 5), and without a real pooler in front, enough concurrent instances will exhaust Postgres's own connection limit regardless of how small each instance's pool is. Check both platforms' `DATABASE_URL` against Neon's dashboard connection string (the pooled one has `-pooler` in the hostname) before assuming this is handled.
