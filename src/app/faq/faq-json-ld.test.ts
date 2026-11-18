import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";
import { FAQ_JSON_LD_MAX_CHARS, FAQ_JSON_LD_MAX_ENTRIES } from "@/lib/seo";

// The FAQ page's FAQPage structured data must say exactly what the page shows (Google's rule for FAQ markup): each
// marked-up question is one of the page's visible questions and its answer is that entry's visible text. Renders
// the real page in every language and compares the two.

let locale: Locale = "en";
let seoLocale: Locale | null = null;
let viewOnce = true;

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/storage", () => ({ isViewOnceConfigured: () => viewOnce }));
vi.mock("@/lib/i18n/server", () => ({
  getLocale: async () => locale,
  getSeoLocaleOverride: async () => seoLocale,
  getDictionary: async () => DICTIONARIES[locale],
}));
vi.mock("@/components/back-button", () => ({ BackButton: () => null }));
vi.mock("@/components/hide-in-ios-app", () => ({
  HideInIosApp: ({ children }: { children: unknown }) => children,
}));

import FaqPage, { generateMetadata } from "./page";

type Question = { "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } };
type FaqLd = { "@context": string; "@type": string; url: string; inLanguage: string; mainEntity: Question[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'", nbsp: "\u00a0" };

/** The text a reader sees in a piece of rendered HTML: <br> as a line break, tags dropped, entities decoded. */
function visibleText(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (ENTITIES[name] !== undefined) return ENTITIES[name];
      if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
      if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
      return whole;
    })
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function render() {
  const html = renderToStaticMarkup(await FaqPage());
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  const json = scripts[0][1];
  const data = JSON.parse(json) as FaqLd;
  // Every visible entry: <details id> <summary>question</summary> <div>answer</div> </details>.
  const visible = new Map<string, string>();
  for (const match of html.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<\/details>/g)) {
    // The +/− indicator beside each question is aria-hidden decoration, not part of the question.
    const question = match[1].replace(/<span aria-hidden="true"[^>]*>(?:<span[^>]*>[^<]*<\/span>)*<\/span>/g, "");
    visible.set(visibleText(question), visibleText(match[2]));
  }
  return { html, json, data, visible };
}

beforeEach(() => {
  locale = "en";
  seoLocale = null;
  viewOnce = true;
});

describe("FAQ structured data", () => {
  it.each(SUPPORTED_LOCALES)("%s: marks up only visible questions, each with its visible answer", async (language) => {
    locale = language;
    const { data, json, visible } = await render();
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("FAQPage");
    expect(data.inLanguage).toBe(language);
    expect(data.url).toBe("https://yukon3t.com/faq");
    expect(visible.size).toBeGreaterThan(100);
    expect(data.mainEntity.length).toBeGreaterThan(10);
    expect(data.mainEntity.length).toBeLessThanOrEqual(FAQ_JSON_LD_MAX_ENTRIES);
    expect(json.length).toBeLessThan(FAQ_JSON_LD_MAX_CHARS * 1.5);
    expect(json).not.toMatch(/[<>]/);
    for (const question of data.mainEntity) {
      expect(question["@type"]).toBe("Question");
      expect(question.acceptedAnswer["@type"]).toBe("Answer");
      expect(visible.has(question.name), question.name).toBe(true);
      expect(question.acceptedAnswer.text, question.name).toBe(visible.get(question.name));
      expect(question.acceptedAnswer.text).not.toMatch(/\*\*|\]\(\/|`/);
    }
    // In page order, starting with the first question on the page.
    expect(data.mainEntity[0].name).toBe([...visible.keys()][0]);
  });

  it("names the ?lang= address it was served under", async () => {
    locale = "pt";
    seoLocale = "pt";
    const { data } = await render();
    expect(data.url).toBe("https://yukon3t.com/faq?lang=pt");
  });

  it("leaves out entries the page hides (view-once switched off)", async () => {
    viewOnce = false;
    const { data, visible } = await render();
    for (const question of data.mainEntity) expect(visible.has(question.name)).toBe(true);
  });
});

describe("FAQ metadata", () => {
  it.each(SUPPORTED_LOCALES)("%s: title, description, canonical and hreflang in the reader's language", async (language) => {
    locale = language;
    const metadata = await generateMetadata();
    expect(metadata.title).toEqual({ absolute: DICTIONARIES[language].seo.faq.title });
    expect(metadata.description).toBe(DICTIONARIES[language].seo.faq.description);
    expect(metadata.alternates?.canonical).toBe("https://yukon3t.com/faq");
    expect(Object.keys(metadata.alternates?.languages ?? {})).toHaveLength(SUPPORTED_LOCALES.length + 1);
  });
});
