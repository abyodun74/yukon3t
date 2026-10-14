import { describe, it, expect } from "vitest";
import {
  clientIpFromHeaders,
  deviceIdForRateLimit,
  isDocumentRequest,
  pageLimitChecks,
  rateLimitPage,
  rateLimitPageLocale,
  rateLimitPageText,
} from "@/lib/page-rate-limit";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

const headers = (values: Record<string, string>) => (name: string) => values[name.toLowerCase()] ?? null;

describe("clientIpFromHeaders", () => {
  const both = { "x-nf-client-connection-ip": "203.0.113.7", "x-real-ip": "198.51.100.2", "x-forwarded-for": "9.9.9.9, 10.0.0.1" };

  it("on Netlify, trusts Netlify's own client address and ignores a client-sent x-real-ip", () => {
    expect(clientIpFromHeaders(headers(both), "netlify")).toBe("203.0.113.7");
    expect(clientIpFromHeaders(headers({ "x-real-ip": "6.6.6.6", "x-forwarded-for": "192.0.2.1" }), "netlify")).toBe("192.0.2.1");
  });

  it("on Vercel, trusts x-real-ip and ignores a client-sent Netlify header", () => {
    expect(clientIpFromHeaders(headers(both), "vercel")).toBe("198.51.100.2");
    expect(
      clientIpFromHeaders(headers({ "x-nf-client-connection-ip": "6.6.6.6", "x-forwarded-for": "192.0.2.1" }), "vercel"),
    ).toBe("192.0.2.1");
  });

  it("elsewhere, uses only the first x-forwarded-for hop", () => {
    expect(clientIpFromHeaders(headers(both), "other")).toBe("9.9.9.9");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": " 192.0.2.1 , 10.0.0.1" }), "other")).toBe("192.0.2.1");
  });

  it("returns null, never a shared placeholder, when nothing says", () => {
    for (const platform of ["netlify", "vercel", "other"] as const) {
      expect(clientIpFromHeaders(headers({}), platform)).toBeNull();
      expect(clientIpFromHeaders(headers({ "x-forwarded-for": " , " }), platform)).toBeNull();
    }
  });
});

describe("deviceIdForRateLimit", () => {
  it("accepts the UUID the proxy mints", () => {
    expect(deviceIdForRateLimit("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  });

  it("ignores missing or hand-made values", () => {
    expect(deviceIdForRateLimit(undefined)).toBeNull();
    expect(deviceIdForRateLimit("")).toBeNull();
    expect(deviceIdForRateLimit("anything-i-like")).toBeNull();
    expect(deviceIdForRateLimit("3f2504e0-4f89-41d3-9a0c-0305e82c3301x")).toBeNull();
  });
});

describe("pageLimitChecks", () => {
  const device = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("counts a known device against its own bucket and its network's ceiling", () => {
    expect(pageLimitChecks("203.0.113.7", device)).toEqual([
      { limiter: "pageRequestDevice", identifier: device },
      { limiter: "pageRequestNetwork", identifier: "203.0.113.7" },
    ]);
  });

  it("counts a request with no device against the strict per-address bucket", () => {
    expect(pageLimitChecks("203.0.113.7", null)).toEqual([{ limiter: "pageRequest", identifier: "203.0.113.7" }]);
  });

  it("doesn't count a request with no address", () => {
    expect(pageLimitChecks(null, device)).toEqual([]);
    expect(pageLimitChecks(null, null)).toEqual([]);
  });
});

describe("isDocumentRequest", () => {
  it("is true for a page load", () => {
    expect(isDocumentRequest(headers({ "sec-fetch-dest": "document", accept: "text/html" }))).toBe(true);
    expect(isDocumentRequest(headers({ "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(isDocumentRequest(headers({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
  });

  it("is false for RSC fetches, prefetches, Server Actions and API calls", () => {
    expect(isDocumentRequest(headers({ rsc: "1", accept: "text/html" }))).toBe(false);
    expect(isDocumentRequest(headers({ "next-router-prefetch": "1" }))).toBe(false);
    expect(isDocumentRequest(headers({ "next-action": "abc", "sec-fetch-dest": "document" }))).toBe(false);
    expect(isDocumentRequest(headers({ "sec-fetch-dest": "empty", accept: "*/*" }))).toBe(false);
    expect(isDocumentRequest(headers({ accept: "application/json" }))).toBe(false);
  });
});

describe("rateLimitPage", () => {
  it("has its wording in every language", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const t = rateLimitPageText(locale);
      expect(t.title.trim(), locale).not.toBe("");
      expect(t.body.trim(), locale).not.toBe("");
      expect(t.retry.trim(), locale).not.toBe("");
    }
  });

  it("reloads the same address by itself and links to it, escaped", () => {
    const html = rateLimitPage({ locale: "en", path: '/post/1?x="<b>"', nonce: "n0nce" });
    expect(html).toContain('http-equiv="refresh" content="10;url=/post/1?x=&quot;&lt;b&gt;&quot;"');
    expect(html).toContain('<a href="/post/1?x=&quot;&lt;b&gt;&quot;">');
    expect(html).toContain('<style nonce="n0nce">');
    expect(html).not.toContain("<script");
  });

  it("never points the reload anywhere but this site", () => {
    for (const path of ["https://evil.example/", "//evil.example/", "/\\evil.example/"]) {
      expect(rateLimitPage({ locale: "en", path, nonce: "n" }), path).toContain('url=/"');
    }
  });

  it("is right-to-left in Arabic and follows an explicit theme", () => {
    const html = rateLimitPage({ locale: "ar", path: "/home", nonce: "n", theme: "dark" });
    expect(html).toContain('<html lang="ar" dir="rtl" data-theme="dark">');
    expect(rateLimitPage({ locale: "fr", path: "/home", nonce: "n" })).toContain('<html lang="fr" dir="ltr">');
  });
});

describe("rateLimitPageLocale", () => {
  it("uses the language picker's cookie, then Accept-Language", () => {
    expect(rateLimitPageLocale("a=1; yukon3t.locale=ar; b=2", "fr")).toBe("ar");
    expect(rateLimitPageLocale("a=1", "pt-BR,pt;q=0.9")).toBe("pt");
    expect(rateLimitPageLocale(null, null)).toBe("en");
  });
});
