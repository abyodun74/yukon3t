/**
 * Manual error capture — call from a catch block or a client error
 * boundary. instrumentation.ts only handles Sentry's own server/edge SDK
 * init (instrumentation-client.ts handles the browser one); automatic RSC
 * error capture via the `onRequestError` hook was tried and dropped (it
 * broke `next dev` routing under Turbopack in this Next 16 setup — every
 * route started 404ing right after instrumentation compiled, confirmed by
 * removing just that one export), so this manual path is the only
 * error-reporting mechanism right now. No-op — never imports the SDK at
 * all — until a DSN is set, so this carries zero cost or risk when Sentry
 * isn't configured.
 *
 * Checks both SENTRY_DSN and NEXT_PUBLIC_SENTRY_DSN because this one
 * function is called from both server code (actions/API routes, where only
 * the non-public SENTRY_DSN is readable) and client code (error.tsx,
 * native-share.ts, etc., where only the NEXT_PUBLIC_-prefixed one is —
 * webpack never inlines a bare SENTRY_DSN into a browser bundle, so that
 * check alone would silently always no-op client-side even with
 * instrumentation-client.ts's own Sentry.init already having run).
 */
export async function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Never let error reporting itself become a new source of errors.
  }
}
