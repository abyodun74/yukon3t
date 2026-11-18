import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";
import {
  FAQ_JSON_LD_MAX_CHARS,
  FAQ_JSON_LD_MAX_ENTRIES,
  OPEN_GRAPH_LOCALE,
  PLAY_STORE_URL,
  appStoreUrl,
  faqPageJsonLd,
  landingJsonLd,
  languageAlternates,
  localizedPageMetadata,
  serializeJsonLd,
  siteUrl,
} from "@/lib/seo";
import { LOCALIZED_SEO_PATHS, isLocalizedSeoPath, localizedSeoPath, seoLocaleFromUrl } from "@/lib/seo-locale";

const BASE = "https://yukon3t.com";

describe("search titles and descriptions", () => {
  it.each(SUPPORTED_LOCALES)("%s: every page's title is 60 characters at most and its description 140 to 160", (locale) => {
    const { seo } = DICTIONARIES[locale];
    for (const [page, text] of Object.entries(seo)) {
      expect(text.title.trim(), `${page} title`).toBe(text.title);
      expect(text.title.length, `${page} title: ${text.title}`).toBeLessThanOrEqual(60);
      expect(text.title.length, `${page} title`).toBeGreaterThan(20);
      expect(text.description.length, `${page} description: ${text.description}`).toBeGreaterThanOrEqual(140);
      expect(text.description.length, `${page} description: ${text.description}`).toBeLessThanOrEqual(160);
      // The brand is in every title (they are absolute, so the layout's "| YuKon3t" template doesn't add it).
      expect(text.title, page).toContain("YuKon3t");
    }
  });

  it.each(SUPPORTED_LOCALES)("%s: the landing page names its features, each with a heading and a sentence", (locale) => {
    const { features } = DICTIONARIES[locale].landing;
    expect(features.heading.trim()).not.toBe("");
    expect(features.intro.trim()).not.toBe("");
    expect(features.items).toHaveLength(DICTIONARIES.en.landing.features.items.length);
    for (const item of features.items) {
      expect(item.title.trim()).not.toBe("");
      expect(item.body.length).toBeGreaterThan(40);
    }
    expect(new Set(features.items.map((item) => item.title)).size).toBe(features.items.length);
  });

  it("states the live-stage cap the app enforces", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const { landing, seo } = DICTIONARIES[locale];
      expect(landing.features.items[4].title, locale).toContain("10");
      expect(seo.landing.description, locale).toContain("10");
    }
  });
});

describe("localizedPageMetadata", () => {
  const text = DICTIONARIES.es.seo.landing;

  it("canonicalises the plain address to itself and lists every language plus x-default", () => {
    const metadata = localizedPageMetadata({ path: "/", locale: "es", seoLocale: null, text, base: BASE });
    expect(metadata.title).toEqual({ absolute: text.title });
    expect(metadata.description).toBe(text.description);
    expect(metadata.alternates?.canonical).toBe(`${BASE}/`);
    const languages = metadata.alternates?.languages as Record<string, string>;
    expect(Object.keys(languages).sort()).toEqual(["x-default", ...SUPPORTED_LOCALES].sort());
    expect(languages["x-default"]).toBe(`${BASE}/`);
    expect(languages.es).toBe(`${BASE}/?lang=es`);
  });

  it("canonicalises a ?lang= address to itself, never to the plain address", () => {
    const metadata = localizedPageMetadata({ path: "/faq", locale: "ar", seoLocale: "ar", text, base: BASE });
    expect(metadata.alternates?.canonical).toBe(`${BASE}/faq?lang=ar`);
    expect(metadata.openGraph?.url).toBe(`${BASE}/faq?lang=ar`);
  });

  it("gives Open Graph the page's own locale and every other one as an alternate", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const metadata = localizedPageMetadata({ path: "/", locale, seoLocale: null, text, base: BASE });
      const og = metadata.openGraph as { locale: string; alternateLocale: string[]; images: unknown[] };
      expect(og.locale).toBe(OPEN_GRAPH_LOCALE[locale]);
      expect(og.alternateLocale).toHaveLength(SUPPORTED_LOCALES.length - 1);
      expect(og.alternateLocale).not.toContain(og.locale);
      expect(og.images).toHaveLength(1);
      expect(og.locale).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
    }
  });

  it("builds hreflang alternates only for the pages that really have language versions", () => {
    for (const path of LOCALIZED_SEO_PATHS) {
      const alternates = languageAlternates(path, BASE);
      for (const locale of SUPPORTED_LOCALES) expect(alternates[locale]).toBe(`${BASE}${localizedSeoPath(path, locale)}`);
    }
    expect(isLocalizedSeoPath("/legal/privacy")).toBe(false);
  });
});

describe("seoLocaleFromUrl", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("reads one supported language on the landing page and the FAQ", () => {
    expect(seoLocaleFromUrl("/", params("lang=es"))).toBe("es");
    expect(seoLocaleFromUrl("/faq", params("lang=sw&x=1"))).toBe("sw");
  });

  it("ignores every other page, a repeated or unknown value, and a different case", () => {
    expect(seoLocaleFromUrl("/sign-up", params("lang=es"))).toBeNull();
    expect(seoLocaleFromUrl("/home", params("lang=es"))).toBeNull();
    expect(seoLocaleFromUrl("/faq/", params("lang=es"))).toBeNull();
    expect(seoLocaleFromUrl("/", params("lang=es&lang=fr"))).toBeNull();
    expect(seoLocaleFromUrl("/", params("lang=zh"))).toBeNull();
    expect(seoLocaleFromUrl("/", params("lang=ES"))).toBeNull();
    expect(seoLocaleFromUrl("/", params(""))).toBeNull();
  });
});

describe("siteUrl and store links", () => {
  it("is always the canonical origin in production", () => {
    expect(siteUrl({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://preview.example.app" })).toBe(BASE);
    expect(siteUrl({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3000/" })).toBe("http://localhost:3000");
    expect(siteUrl({ NODE_ENV: "test" })).toBe(BASE);
  });

  it("links the App Store only once a numeric id is configured", () => {
    expect(appStoreUrl({})).toBeNull();
    expect(appStoreUrl({ IOS_APP_STORE_ID: "" })).toBeNull();
    expect(appStoreUrl({ IOS_APP_STORE_ID: "id123456789" })).toBeNull();
    expect(appStoreUrl({ IOS_APP_STORE_ID: " 123456789 " })).toBe("https://apps.apple.com/app/id123456789");
    expect(PLAY_STORE_URL).toBe("https://play.google.com/store/apps/details?id=com.yukon3t.app");
  });
});

describe("serializeJsonLd", () => {
  it("can't be closed early by anything inside a string, and parses back to the same data", () => {
    const data = { name: "</script><script>alert(1)</script>", note: "<!-- & -->", line: "a\u2028b\u2029c" };
    const json = serializeJsonLd(data);
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(json.toLowerCase()).not.toContain("</script");
    expect(JSON.parse(json)).toEqual(data);
  });
});

describe("landingJsonLd", () => {
  const description = DICTIONARIES.en.seo.landing.description;

  it("describes the organisation, the site and the Android app, and claims nothing it can't back", () => {
    const data = landingJsonLd({ locale: "en", description, base: BASE, iosUrl: null });
    const parsed = JSON.parse(serializeJsonLd(data));
    expect(parsed["@context"]).toBe("https://schema.org");
    const types = parsed["@graph"].map((node: { "@type": string }) => node["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "WebPage", "MobileApplication"]);
    const app = parsed["@graph"][3];
    expect(app.operatingSystem).toBe("Android");
    expect(app.url).toBe(PLAY_STORE_URL);
    const text = JSON.stringify(parsed);
    for (const invented of ["aggregateRating", "review", "offers", "price", "ratingValue", "downloads"]) {
      expect(text).not.toContain(invented);
    }
    // Every @id reference points at a node in the graph.
    const ids = new Set(parsed["@graph"].map((node: { "@id"?: string }) => node["@id"]).filter(Boolean));
    for (const ref of text.matchAll(/\{"@id":"([^"]+)"\}/g)) expect(ids).toContain(ref[1]);
  });

  it("adds the iOS app when its App Store link is known", () => {
    const data = landingJsonLd({ locale: "fr", description, base: BASE, iosUrl: "https://apps.apple.com/app/id123456789" });
    const apps = (data["@graph"] as { "@type": string; operatingSystem?: string }[]).filter(
      (node) => node["@type"] === "MobileApplication",
    );
    expect(apps.map((app) => app.operatingSystem)).toEqual(["Android", "iOS"]);
  });
});

describe("faqPageJsonLd", () => {
  it("keeps whole entries in order, skips empty ones, and stops at the caps", () => {
    const entries = Array.from({ length: FAQ_JSON_LD_MAX_ENTRIES + 10 }, (_, i) => ({
      question: `Question ${i}?`,
      answer: `Answer ${i}.`,
    }));
    entries.splice(1, 0, { question: " ", answer: "orphan" });
    const data = faqPageJsonLd({ url: `${BASE}/faq`, locale: "en", entries });
    const questions = data.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    expect(questions).toHaveLength(FAQ_JSON_LD_MAX_ENTRIES);
    expect(questions[0]).toEqual({ "@type": "Question", name: "Question 0?", acceptedAnswer: { "@type": "Answer", text: "Answer 0." } });
    expect(questions[1].name).toBe("Question 1?");

    const long = faqPageJsonLd({
      url: `${BASE}/faq`,
      locale: "en",
      entries: [
        { question: "A?", answer: "x".repeat(FAQ_JSON_LD_MAX_CHARS - 10) },
        { question: "B?", answer: "y".repeat(50) },
      ],
    });
    expect((long.mainEntity as unknown[]).length).toBe(1);
  });
});
