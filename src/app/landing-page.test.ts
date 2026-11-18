import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";

// The landing page as a signed-out visitor (or a crawler) gets it: the feature blocks in the reader's language, in
// the server-rendered HTML, with valid structured data and localized metadata. Signed in, it still goes to /home.

let locale: Locale = "en";
let seoLocale: Locale | null = null;
let session: { user: { id: string } } | null = null;
const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`);
});

vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-test" }) }));
vi.mock("@/lib/i18n/server", () => ({
  getLocale: async () => locale,
  getSeoLocaleOverride: async () => seoLocale,
  getDictionary: async () => DICTIONARIES[locale],
}));
vi.mock("@/components/ad-slot", () => ({ AdSlot: () => null }));
vi.mock("@/components/language-picker", () => ({ LanguagePicker: () => null }));

import Home, { generateMetadata } from "./page";

const decode = (text: string) =>
  text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

beforeEach(() => {
  locale = "en";
  seoLocale = null;
  session = null;
  redirect.mockClear();
});

describe("landing page", () => {
  it.each(SUPPORTED_LOCALES)("%s: renders every feature block, as headings and text, in the HTML", async (language) => {
    locale = language;
    const html = decode(renderToStaticMarkup(await Home()));
    const { features } = DICTIONARIES[language].landing;
    expect(html).toContain(`>${features.heading}</h2>`);
    expect(html).toContain(features.intro);
    for (const item of features.items) {
      expect(html).toContain(`>${item.title}</h3>`);
      expect(html).toContain(item.body);
    }
    // One h1, and the feature section is labelled by its heading.
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<section aria-labelledby="landing-features"/);
    // Logical alignment, so Arabic reads right-to-left inside the cards too.
    expect(html).not.toMatch(/text-left|text-right/);
  });

  it.each(SUPPORTED_LOCALES)("%s: carries valid, escaped structured data", async (language) => {
    locale = language;
    const raw = renderToStaticMarkup(await Home());
    const scripts = [...raw.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    const data = JSON.parse(scripts[0][1]);
    expect(data["@graph"][2].inLanguage).toBe(language);
    expect(data["@graph"][1].description).toBe(DICTIONARIES[language].seo.landing.description);
  });

  it("sends a signed-in member to Home", async () => {
    session = { user: { id: "u1" } };
    await expect(Home()).rejects.toThrow("redirect:/home");
  });
});

describe("landing metadata", () => {
  it.each(SUPPORTED_LOCALES)("%s: in the reader's language with og:locale and hreflang", async (language) => {
    locale = language;
    const metadata = await generateMetadata();
    expect(metadata.title).toEqual({ absolute: DICTIONARIES[language].seo.landing.title });
    expect(metadata.description).toBe(DICTIONARIES[language].seo.landing.description);
    expect(metadata.alternates?.canonical).toBe("https://yukon3t.com/");
    expect((metadata.openGraph as { locale: string }).locale).toMatch(new RegExp(`^${language}_`));
  });

  it("names the ?lang= address as canonical when served under it", async () => {
    locale = "hi";
    seoLocale = "hi";
    const metadata = await generateMetadata();
    expect(metadata.alternates?.canonical).toBe("https://yukon3t.com/?lang=hi");
  });
});
