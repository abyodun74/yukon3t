import type { CaptureResult } from "posthog-js";

/**
 * posthog-js `before_send` hook: stamps `$geoip_disable: true` on every
 * outgoing event so PostHog's ingestion skips its GeoIP enrichment (no
 * city/country/lat-long derived from the request IP). Runs for every
 * `capture()` — including `$pageview`, `$identify`, autocapture and session
 * replay's `$snapshot` batches — so the app can truthfully declare no
 * approximate/coarse location collection in its store privacy labels.
 *
 * Kept in its own module (type-only posthog-js import) so it's unit-testable
 * without loading the browser SDK. posthog-js's old `ip: false` init option
 * is a documented no-op in the installed version, so this plus the PostHog
 * project's "Discard client IP data" setting is the real switch.
 */
export function disablePostHogGeoIp(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  return { ...event, properties: { ...event.properties, $geoip_disable: true } };
}
