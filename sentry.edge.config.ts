// Only ever imported from src/instrumentation.ts, which already checked
// SENTRY_DSN is set before importing this file. Covers the proxy/middleware
// runtime (src/proxy.ts), which runs on the Edge runtime, not Node.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
