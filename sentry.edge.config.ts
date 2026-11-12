// Only ever imported from src/instrumentation.ts, which already checked
// SENTRY_DSN is set before importing this file. Covers the proxy/middleware
// runtime (src/proxy.ts), which runs on the Edge runtime, not Node.
import * as Sentry from "@sentry/nextjs";
import { scrubSentryBreadcrumb, scrubSentryEvent } from "@/lib/sentry-url-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Errors only: tracing is compiled out of every bundle (__SENTRY_TRACING__
  // in next.config.ts), so there is no tracesSampleRate to set.
  // Reset tokens and one-time codes never reach Sentry inside a URL (src/lib/sentry-url-scrub.ts).
  beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  beforeSend: (event) => scrubSentryEvent(event),
});
