/**
 * Strips secrets that can ride in a URL (password-reset tokens, one-time codes, OAuth codes) before a URL is handed to
 * a third party: PostHog's `before_send` (posthog-client.ts), Sentry's breadcrumbs and events (instrumentation-
 * client.ts) and the page_location given to Google Tag Manager (analytics-scripts.tsx). Client-safe, no dependencies.
 *
 * Both the query string and the fragment are cleaned: a parameter whose name is in SENSITIVE_URL_PARAMS keeps its
 * name with the value replaced by "[redacted]", so analytics still show which page it was.
 */
export const SENSITIVE_URL_PARAMS = [
  "token",
  "reset_token",
  "access_token",
  "id_token",
  "refresh_token",
  "code",
  "otp",
  "secret",
  "password",
  "signature",
] as const;

const SENSITIVE = new Set<string>(SENSITIVE_URL_PARAMS);
const REDACTED = "[redacted]";

function scrubParams(part: string): string {
  if (!part.includes("=")) return part;
  return part
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      let name = pair.slice(0, eq);
      try {
        name = decodeURIComponent(name.replace(/\+/g, " "));
      } catch {
        // Malformed escape: compare the raw name.
      }
      return SENSITIVE.has(name.toLowerCase()) ? `${pair.slice(0, eq)}=${REDACTED}` : pair;
    })
    .join("&");
}

/** Returns `url` with every sensitive query/fragment parameter value redacted. Works on absolute and relative URLs. */
export function scrubSensitiveUrl(url: string): string {
  if (!url) return url;
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? null : url.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? null : beforeHash.slice(queryAt + 1);
  return (
    base + (query === null ? "" : `?${scrubParams(query)}`) + (fragment === null ? "" : `#${scrubParams(fragment)}`)
  );
}

/** Whether `url` carries anything scrubSensitiveUrl would redact. */
export function hasSensitiveUrlParams(url: string): boolean {
  return scrubSensitiveUrl(url) !== url;
}

/**
 * Redacts every string value in a flat property bag that looks like a URL carrying a sensitive parameter
 * ($current_url, $referrer, $initial_referrer, $pathname, ...). Other values are returned untouched.
 */
export function scrubUrlProperties<T extends Record<string, unknown>>(properties: T): T {
  let changed = false;
  const out: Record<string, unknown> = { ...properties };
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string" && (value.includes("?") || value.includes("#"))) {
      const scrubbed = scrubSensitiveUrl(value);
      if (scrubbed !== value) {
        out[key] = scrubbed;
        changed = true;
      }
    }
  }
  return (changed ? out : properties) as T;
}
