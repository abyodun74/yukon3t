import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEO_LOCALE_HEADER } from "@/lib/seo-locale";

// `?lang=` addresses end to end: the proxy turns a valid parameter on a localized public page into the request
// header (and strips any copy a client sent), and getLocale lets that header win over the cookie and Accept-Language.

// The first dynamic import of the proxy / i18n server module is slow while the whole suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

let cookieLocale: string | undefined;
let requestHeaders = new Headers();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "yukon3t.locale" && cookieLocale ? { value: cookieLocale } : undefined) }),
  headers: async () => requestHeaders,
}));
// The page rate limit would reach Upstash; these tests only look at the headers the proxy forwards.
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));

beforeEach(() => {
  vi.resetModules();
  cookieLocale = undefined;
  requestHeaders = new Headers();
});

async function locale() {
  const { getLocale } = await import("@/lib/i18n/server");
  return getLocale();
}

describe("getLocale with a ?lang= address", () => {
  it("prefers the address's language over the cookie and Accept-Language", async () => {
    cookieLocale = "fr";
    requestHeaders = new Headers({ "accept-language": "de", [SEO_LOCALE_HEADER]: "sw" });
    expect(await locale()).toBe("sw");
  });

  it("works exactly as before without one", async () => {
    cookieLocale = "fr";
    requestHeaders = new Headers({ "accept-language": "de" });
    expect(await locale()).toBe("fr");
    cookieLocale = undefined;
    requestHeaders = new Headers({ "accept-language": "de-AT,en;q=0.5" });
    expect(await locale()).toBe("de");
    requestHeaders = new Headers();
    expect(await locale()).toBe("en");
  });

  it("ignores a header value that isn't a supported language", async () => {
    cookieLocale = "pt";
    requestHeaders = new Headers({ [SEO_LOCALE_HEADER]: "xx" });
    expect(await locale()).toBe("pt");
  });
});

describe("proxy", () => {
  async function forwarded(url: string, headers: Record<string, string> = {}) {
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest(url, { headers }));
    const overridden = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
    return {
      overridden: overridden.includes(SEO_LOCALE_HEADER),
      value: response.headers.get(`x-middleware-request-${SEO_LOCALE_HEADER}`),
    };
  }

  it("sets the header from ?lang= on the landing page and the FAQ", async () => {
    expect((await forwarded("https://yukon3t.com/?lang=ar")).value).toBe("ar");
    expect((await forwarded("https://yukon3t.com/faq?lang=hi")).value).toBe("hi");
  });

  it("never forwards a client's own copy of the header, nor one for another page or an unknown language", async () => {
    const spoofed = { [SEO_LOCALE_HEADER]: "es" };
    expect((await forwarded("https://yukon3t.com/home", spoofed)).value).toBeNull();
    expect((await forwarded("https://yukon3t.com/home?lang=es")).value).toBeNull();
    expect((await forwarded("https://yukon3t.com/?lang=zz", spoofed)).value).toBeNull();
    expect((await forwarded("https://yukon3t.com/faq", spoofed)).value).toBeNull();
    expect((await forwarded("https://yukon3t.com/faq?lang=de", spoofed)).value).toBe("de");
  });
});
