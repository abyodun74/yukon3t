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

// What a client left behind by a deploy throws when a request of its lands
// on the new build: Safari/WKWebView's and Chrome's wording for a fetch that
// died, and Next's for a Server Action answered with something other than
// an action result. None of them says "stale" in itself (see
// lib/stale-build.ts), so they are only dropped after asking the server
// which build it is on — the same message from a client on the current
// build is a real failure and is still reported.
const DEPLOY_SKEW_MESSAGES = [
  /^Load failed$/,
  /^Failed to fetch$/,
  /An unexpected response was received from the server/,
];
const BUILD_ID_TIMEOUT_MS = 3_000;

async function isBehindServerBuild(): Promise<boolean> {
  const clientBuildId = process.env.APP_BUILD_ID;
  if (!clientBuildId) return false;
  try {
    const res = await fetch("/api/build-id", { cache: "no-store", signal: AbortSignal.timeout(BUILD_ID_TIMEOUT_MS) });
    if (!res.ok) return false;
    const { buildId } = (await res.json()) as { buildId?: unknown };
    return typeof buildId === "string" && buildId !== "" && buildId !== clientBuildId;
  } catch {
    return false;
  }
}

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // Same conservative default as the server/edge configs — no live
    // project to tune trace volume against yet.
    tracesSampleRate: 0.1,
    async beforeSend(event) {
      const message = event.exception?.values?.[0]?.value ?? "";
      if (DEPLOY_SKEW_MESSAGES.some((re) => re.test(message)) && (await isBehindServerBuild())) {
        return null;
      }
      return event;
    },
  });
}
