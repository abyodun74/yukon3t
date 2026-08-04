/**
 * Manual error capture — call from a catch block or a client error
 * boundary. instrumentation.ts only handles Sentry's own SDK init;
 * automatic RSC error capture via the `onRequestError` hook was tried and
 * dropped (it broke `next dev` routing under Turbopack in this Next 16
 * setup — every route started 404ing right after instrumentation compiled,
 * confirmed by removing just that one export), so this manual path is the
 * only error-reporting mechanism right now. No-op — never imports the SDK
 * at all — until SENTRY_DSN is set, so this carries zero cost or risk when
 * Sentry isn't configured.
 */
export async function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Never let error reporting itself become a new source of errors.
  }
}
