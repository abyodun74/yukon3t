// Only ever imported from src/instrumentation.ts, which already checked
// SENTRY_DSN is set before importing this file.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Conservative default — trace volume can be raised once real usage is
  // observed against a live project; there's no live project to tune
  // against yet.
  tracesSampleRate: 0.1,
});
