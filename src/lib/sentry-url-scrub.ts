import { scrubSensitiveUrl } from "@/lib/url-scrub";

/**
 * Sentry hooks (instrumentation-client.ts, sentry.server.config.ts, sentry.edge.config.ts) that redact sensitive URL
 * parameters (password-reset tokens, one-time codes; list in url-scrub.ts) from breadcrumbs (navigation from/to,
 * fetch/xhr urls) and from an event's request (url, query string, Referer). Structural types, so this has no Sentry
 * import and runs in any runtime.
 */

type BreadcrumbLike = { message?: string; data?: Record<string, unknown> };

function scrubValue(value: unknown): unknown {
  return typeof value === "string" ? scrubSensitiveUrl(value) : value;
}

export function scrubSentryBreadcrumb<T extends BreadcrumbLike>(breadcrumb: T): T {
  const out = { ...breadcrumb };
  if (typeof out.message === "string") out.message = scrubSensitiveUrl(out.message);
  if (out.data) {
    const data = { ...out.data };
    for (const key of ["from", "to", "url"]) {
      if (key in data) data[key] = scrubValue(data[key]);
    }
    out.data = data;
  }
  return out;
}

type EventLike = {
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, string>;
  };
  breadcrumbs?: BreadcrumbLike[];
};

export function scrubSentryEvent<T extends EventLike>(event: T): T {
  const out = { ...event };
  if (out.request) {
    const request = { ...out.request };
    if (typeof request.url === "string") request.url = scrubSensitiveUrl(request.url);
    if (typeof request.query_string === "string") {
      request.query_string = scrubSensitiveUrl(`?${request.query_string}`).slice(1);
    } else if (request.query_string !== undefined) {
      // Array/object forms: dropped rather than parsed.
      request.query_string = "[redacted]";
    }
    if (request.headers) {
      const headers = { ...request.headers };
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === "referer") headers[name] = scrubSensitiveUrl(headers[name]);
      }
      request.headers = headers;
    }
    out.request = request;
  }
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map(scrubSentryBreadcrumb);
  return out;
}
