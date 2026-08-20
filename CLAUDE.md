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

**Critical**: `capacitor.config.ts` sets `server.url: "https://yukon3t.com"` — the native app's WebView loads the **live deployed site directly**, it does not bundle a local copy of `src/`/`public/`. This means:
- Any change to `src/` reaches mobile users the instant it's deployed to the web (Netlify), no app update needed.
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

### Calls: Daily.co, embedded as an iframe

`src/lib/daily.ts` (server) creates/tokens Daily.co rooms via their REST API; `src/components/call-frame.tsx` embeds Daily's prebuilt call UI via `DailyIframe.createFrame()` — there's no hand-rolled WebRTC. Because the call UI lives in a cross-origin `*.daily.co` iframe, both `next.config.ts`'s `Permissions-Policy` (must use `camera=*, microphone=*`, not `(self)` — Permissions-Policy can't wildcard subdomains the way CSP can) and `src/proxy.ts`'s CSP `frame-src` need to allow it, or calls silently break.

### Domain model (see `prisma/schema.prisma`)

- **Circles** (communities) → **Channels** → `ChannelVoiceParticipant` for live voice
- **Posts/Comments/Likes/Stories** — standard social graph
- **Collab** — `CollabBoardPost`/`CollabParticipant`/`CollabSessionParticipant`, a separate live-collaboration feature from Circles/posts
- **Connections** (follow/friend) + **Conversations/Messages** — conversations are always exactly 2 people (no group-DM join table; `deliveredAt`/`readAt` are plain nullable columns on `Message`), with ~3s polling instead of WebSocket/SSE (deliberate, see `SECURITY.md`)
- **Report/AuditLog/Block** — trust & safety; every moderation action writes an `AuditLog` row
- **PushSubscription/FcmToken** — web push + Firebase Cloud Messaging (mobile) live side by side

### Dual deployment: Vercel + Netlify, different mechanisms

Both are live off this repo, same Neon database. **Netlify auto-deploys on `git push` to `master`.** Vercel does **not** auto-deploy from this repo config — it needs an explicit `vercel --prod`. A change isn't "live everywhere" until both have happened. Env vars must be set separately on each platform (`vercel env add` / `netlify env:set`) — a var only present in local `.env` silently leaks into a Vercel build (Next's own env loading finds it) but is simply absent on Netlify. See `SECURITY.md` for the full incident history on this, including a Windows-specific `netlify deploy --prod` bundling bug (use git-push/build-hook deploys instead of the local CLI on Windows) and a GitHub-cross-account webhook mixup.

`SECURITY.md` also documents the full list of implemented security controls (CSP nonce, rate limiting via Upstash, SSRF-guarded remote image fetch, etc.) and known accepted gaps — read it before changing anything auth/upload/moderation-adjacent.
