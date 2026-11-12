import { describe, expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";
import { hasSensitiveUrlParams, scrubSensitiveUrl, scrubUrlProperties } from "@/lib/url-scrub";
import { scrubPostHogUrls } from "@/lib/posthog-url-scrub";
import { scrubSentryBreadcrumb, scrubSentryEvent } from "@/lib/sentry-url-scrub";

describe("scrubSensitiveUrl", () => {
  it("redacts a reset token in the fragment and in the query", () => {
    expect(scrubSensitiveUrl("https://yukon3t.com/reset-password#token=abc123")).toBe(
      "https://yukon3t.com/reset-password#token=[redacted]",
    );
    expect(scrubSensitiveUrl("/reset-password?token=abc&error=invalid")).toBe(
      "/reset-password?token=[redacted]&error=invalid",
    );
  });

  it("covers one-time codes and OAuth tokens, case-insensitively", () => {
    expect(scrubSensitiveUrl("/cb?code=1&state=x#access_token=t&Token=u")).toBe(
      "/cb?code=[redacted]&state=x#access_token=[redacted]&Token=[redacted]",
    );
  });

  it("leaves harmless URLs alone", () => {
    for (const url of ["/home", "/sign-in?error=rate_limited", "https://yukon3t.com/post/1#comments", ""]) {
      expect(scrubSensitiveUrl(url)).toBe(url);
      expect(hasSensitiveUrlParams(url)).toBe(false);
    }
  });

  it("scrubs only URL-like string properties", () => {
    const props = { $current_url: "https://x/reset-password#token=s", $referrer: "https://x/home", count: 3 };
    expect(scrubUrlProperties(props)).toEqual({
      $current_url: "https://x/reset-password#token=[redacted]",
      $referrer: "https://x/home",
      count: 3,
    });
  });
});

describe("scrubPostHogUrls", () => {
  it("redacts properties, $set and $set_once", () => {
    const event = {
      uuid: "1",
      event: "$pageview",
      properties: { $current_url: "https://x/reset-password?token=s" },
      $set: { $current_url: "https://x/a?code=1" },
      $set_once: { $initial_current_url: "https://x/reset-password#token=s" },
    } as unknown as CaptureResult;
    const out = scrubPostHogUrls(event)!;
    expect(out.properties.$current_url).toBe("https://x/reset-password?token=[redacted]");
    expect(out.$set?.$current_url).toBe("https://x/a?code=[redacted]");
    expect(out.$set_once?.$initial_current_url).toBe("https://x/reset-password#token=[redacted]");
    expect(scrubPostHogUrls(null)).toBeNull();
  });
});

describe("Sentry scrubbing", () => {
  it("redacts navigation and fetch breadcrumbs", () => {
    expect(
      scrubSentryBreadcrumb({ data: { from: "/reset-password#token=s", to: "/reset-password" } }).data,
    ).toEqual({ from: "/reset-password#token=[redacted]", to: "/reset-password" });
    expect(scrubSentryBreadcrumb({ data: { url: "/api/x?otp=1", method: "GET" } }).data).toEqual({
      url: "/api/x?otp=[redacted]",
      method: "GET",
    });
  });

  it("redacts the request URL, query string and Referer of an event", () => {
    const out = scrubSentryEvent({
      request: {
        url: "https://x/reset-password?token=s",
        query_string: "token=s&a=1",
        headers: { Referer: "https://x/reset-password?token=s" },
      },
      breadcrumbs: [{ message: "navigated to /reset-password#token=s" }],
    });
    expect(out.request?.url).toBe("https://x/reset-password?token=[redacted]");
    expect(out.request?.query_string).toBe("token=[redacted]&a=1");
    expect(out.request?.headers?.Referer).toBe("https://x/reset-password?token=[redacted]");
    expect(out.breadcrumbs?.[0].message).toBe("navigated to /reset-password#token=[redacted]");
  });
});
