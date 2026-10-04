// Client-side counterpart to sentry.server.config.ts/sentry.edge.config.ts
// (see src/instrumentation.ts) — Next.js (15.3+; this app is on 16) auto-
// loads a project-root instrumentation-client.ts early in the browser
// bundle itself, no manual import wiring needed the way the server/edge
// configs need instrumentation.ts's register() to import them.
//
// Needs its own, NEXT_PUBLIC_-prefixed DSN (NEXT_PUBLIC_SENTRY_DSN, not the
// server-only SENTRY_DSN — nothing else reaches a client bundle, since
// webpack only inlines NEXT_PUBLIC_ vars into client code) — reusing the
// same actual Sentry project/DSN value under both names is fine, a DSN
// isn't a secret the way an API key is, it only tells the SDK where to
// send events.
//
// Guarded (not just left to Sentry.init's own handling of an empty dsn)
// so this stays the same "zero cost or risk when Sentry isn't configured"
// contract captureError's own doc comment already promises server-side.
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // Same conservative default as the server/edge configs — no live
    // project to tune trace volume against yet.
    tracesSampleRate: 0.1,
  });
}
