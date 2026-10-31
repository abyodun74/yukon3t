// Only ever imported from src/instrumentation.ts, which already checked
// SENTRY_DSN is set before importing this file.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Errors only: tracing is compiled out of every bundle (__SENTRY_TRACING__
  // in next.config.ts), so there is no tracesSampleRate to set.
});
