# Security notes

## Controls implemented

- **Passwordless auth** (NextAuth v5 + Resend magic link) — no password table to leak or credential-stuff.
- **CSP with per-request nonce** (`src/proxy.ts`) — `script-src 'self' 'nonce-...' 'strict-dynamic'`, no `unsafe-inline` in production. Plus HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (`next.config.ts`).
- **Input validation** — every server action validates with Zod (`src/lib/validations.ts`) before touching the database.
- **Rate limiting** — Upstash-backed sliding window on sign-in, posts, messages, connection requests, reports, Circle creation (`src/lib/rate-limit.ts`); fails open only on Upstash outages, fails closed (in-memory limiter) in local dev.
- **Authorization / ownership checks** — every mutation re-derives the actor from the session server-side and checks they actually own/are a member of the resource (conversation membership before sending a message, Circle membership before posting, admin flag before resolving reports) — see `src/lib/auth-guards.ts` and each file in `src/app/actions/`.
- **Content moderation gate — status: live and verified.** Bios, posts, Circle descriptions, Collab posts, and messages are passed through OpenAI's moderation endpoint before publish (`src/lib/moderation.ts`); flagged text is stored as `FLAGGED` rather than shown. Photos and video-thumbnail frames go through the same endpoint's image moderation (`moderateImage`/`moderateMedia`); flagged media is rejected outright and deleted from storage, never stored in a pending state — a stricter policy than text, per the zero-tolerance no-sexual-content rule in the Community Guidelines. `OPENAI_API_KEY` is set on both local `.env` and Vercel production, and confirmed on the live site with a real test: explicit text posted through the actual composer on `https://yukon3t.vercel.app` came back `flagged: true` (sexual: 0.78) from OpenAI and was stored as `moderationStatus: FLAGGED` in the production database — never shown in the feed. Benign text was separately confirmed to pass (`flagged: false`). Note: the OpenAI account needed a payment method added before the key would work at all — a bare new key returns a persistent `429 invalid_request_error` (not a normal rate limit) until billing is configured, even though moderation calls themselves are free.
- **No raw SQL** — Prisma parameterized queries throughout.
- **CSRF** — handled by Next.js Server Actions' built-in origin check plus NextAuth's own CSRF token for the auth endpoints.
- **Data control** — free JSON export and hard account delete for every user (`src/app/actions/profile.ts`), with cascading deletes configured in `prisma/schema.prisma` so deletion never fails or gets stuck on FK constraints.
- **Audit trail** — every moderation action (warn, suspend, ban) writes an `AuditLog` row with a reason, so enforcement is always explainable and appealable.
- **Ban vs. suspend** — `UserStatus` distinguishes a temporary `SUSPENDED` from a permanent `BANNED`; both are blocked identically at sign-in (`src/lib/auth.ts`) and on every subsequent page load (`src/lib/auth-guards.ts`, `src/lib/page-guards.ts` reject anything that isn't `ACTIVE`), so a banned session is rejected immediately even if the browser still holds a valid session cookie.
- **Direct-to-storage uploads** — avatars, post photos, and short video clips are uploaded straight from the browser to Cloudflare R2 via short-lived (5 min) presigned PUT URLs (`src/lib/storage.ts`), never through a Next.js server function — avoids routing large files through serverless request-body limits. The real file size is re-verified server-side after upload via `HeadObjectCommand` (a presigned PUT alone can't cap size); oversized objects are deleted immediately. The S3 client is configured with `forcePathStyle: true` so presigned URLs always resolve to `{accountId}.r2.cloudflarestorage.com/{bucket}/...` — the AWS SDK's default virtual-hosted-style (`{bucket}.{accountId}.r2.cloudflarestorage.com`) would silently mismatch the CSP `connect-src` allowlist and get blocked by the browser. **R2 is live and verified working end-to-end** (avatar + image post tested through the real UI).
- **Theme preference** is a non-sensitive, non-httpOnly cookie (`yk3-theme`) — no session or auth implications.

## Known gaps / accepted risk

- **Phone/ID verification was descoped** from the MVP to stay under the $200 budget (SMS OTP costs money per verification). Trust score is computed from free signals only (email verified, account age, profile completeness, report history). See the plan's budget-reconciliation note.
- **Video content is not frame-by-frame scanned.** Only the text caption and a single client-captured thumbnail frame are moderated before a video post is accepted — full video moderation (Hive, AWS Rekognition Video, etc.) costs money per minute processed and is out of budget for this pass. This is the deliberate trade-off behind the zero-tolerance policy: automated screening catches the obvious cases at the point of upload; user reporting plus the admin Ban action are the backstop for anything that gets past it. Revisit if report volume on video content shows this gap is being exploited.
- **No automated strike/escalation system** — a rejected upload just tells the user why and discards it; there's no counter that auto-escalates repeat offenders to a ban. Admins ban manually from the moderation queue based on reports. Worth building once there's real abuse-pattern data to design it against, rather than guessing at thresholds now.
- **Upload size is enforced after the fact** (via `HeadObjectCommand` + delete), not prevented at the presigned-URL level — a small window exists where an oversized file briefly lands in the bucket before being removed. Acceptable given R2's free-tier storage headroom and that this only affects authenticated, rate-limited, trust-scored users.
- **`npm audit` reports 12 high-severity advisories**, all inside Next.js's own bundled build toolchain (`postcss`, `sharp`, and dev-only `eslint`/`minimatch`), not in application code. `npm audit fix --force` wants to downgrade `next` to `9.3.3`, which is not a real fix — Next 16.2.12 is already the latest stable release as of this build. Note this now has *some* live surface: `sharp`'s libvips CVEs are about image processing, and while post/avatar images are served directly from R2 (never through `next/image`/`sharp`), re-run `npm audit` and prioritize a `next` upgrade the moment a patched release ships, given untrusted images are now a real part of the app.
- **`AUTH_SECRET` in `.env` is a dev placeholder** (`dev-only-secret-change-before-deploy-CHANGE-ME`). Generate a real one with `openssl rand -base64 32` before deploying anywhere reachable.
- **In-memory rate limiting fallback** only applies when Upstash env vars are unset (local dev). Production deploys must set `UPSTASH_REDIS_REST_URL`/`TOKEN` or rate limits silently reset per serverless instance.

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

## Deployed to Vercel — status: live

Production is live at **https://yukon3t.vercel.app**, deployed via `vercel --prod` (project `yukon3t`, scope `ainabizpro-6934s-projects`). Real Neon Postgres (migrated), real `AUTH_SECRET`, real Resend, real R2 — sign-in tested end to end against the live deployment (magic-link request → Neon write → Resend send → verify-request page, zero console errors).

**Gotcha hit and fixed during this deploy**: `vercel --prod` deploys whatever's in the local project directory, which includes the local `.env` file — despite `.env*` being in `.gitignore`, Next.js's own build-time env loading (`@next/env`, not Vercel-specific) still finds and loads it from the uploaded source. For any env var **explicitly set** via `vercel env add`, the Vercel-injected value wins (dotenv never overrides an already-set `process.env` value). But for a var that's only defined in the local `.env` and never added to Vercel, the local dev value silently leaks into production. This bit `AUTH_URL` and `NEXT_PUBLIC_APP_URL` specifically — both were still `http://localhost:3000` from local dev, which broke the sign-in redirect (browser tried to navigate to `localhost:3000` and failed) until both were explicitly added as Vercel production env vars and the app was rebuilt (`NEXT_PUBLIC_APP_URL` is inlined at build time, so a rebuild — not just a runtime env change — is required for it to take effect).

**Takeaway for future deploys**: after `vercel env add`-ing the "obvious" secrets, run `vercel env ls production` and diff it against every key in `.env`/`.env.example` — anything present locally but missing from that list is a latent leak waiting to happen the moment it's actually read at runtime or build time.

## Before going to production (or redeploying elsewhere)

1. Set real `AUTH_SECRET`, `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL`/`TOKEN`, `OPENAI_API_KEY`, `DATABASE_URL` (Neon), R2 credentials, `AUTH_URL`, `NEXT_PUBLIC_APP_URL` as **Vercel** env vars — not just in the local `.env` (see gotcha above).
2. Confirm `NODE_ENV=production` so the CSP drops `'unsafe-eval'` — Vercel sets this automatically.
3. Re-run `npm audit` and `npm run build` in the deploy pipeline.
4. ✅ **Done** — first real admin account promoted on the live Neon database (`ainabizpro@gmail.com`, signed in via a real magic-link click, `isAdmin` set directly via Prisma). Verified with a short-lived, separate verification session that the "Moderation" nav link and `/admin/moderation` page both work, then removed that verification session without touching the real one.
5. ✅ **Done** — R2 bucket CORS policy includes `https://yukon3t.vercel.app`, verified with a real upload through the live site (avatar landed in R2, publicly reachable, zero console errors).
6. ✅ **Done** — `OPENAI_API_KEY` is live on production and verified actually blocking flagged content (see above), not just present.
