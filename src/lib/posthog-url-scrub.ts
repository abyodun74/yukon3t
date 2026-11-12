import type { CaptureResult } from "posthog-js";
import { scrubUrlProperties } from "@/lib/url-scrub";

/**
 * posthog-js `before_send` hook: redacts sensitive URL parameters (password-reset tokens, one-time codes; the list is
 * in url-scrub.ts) in every URL-like property of every event — $current_url, $referrer, $initial_referrer,
 * $initial_current_url, $pathname and the like, in `properties`, `$set` and `$set_once`. Autocapture and replay
 * `$snapshot` batches go through it too. The reset page already removes the token from the address before PostHog
 * loads (reset-token-client.ts); this is the second layer for anything else that ends up in a URL.
 */
export function scrubPostHogUrls(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  const out: CaptureResult = { ...event, properties: scrubUrlProperties(event.properties ?? {}) };
  if (event.$set) out.$set = scrubUrlProperties(event.$set);
  if (event.$set_once) out.$set_once = scrubUrlProperties(event.$set_once);
  return out;
}
