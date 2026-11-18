import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/store-listing-drafts.md: the App Store / Google Play listing text the owner pastes into the consoles. Every
// field is a ```text block after a "<field> (max N):" line; this keeps each within its store's limit and free of the
// things store review rejects (competitor names, unverifiable superlatives).

const doc = readFileSync(path.resolve(import.meta.dirname, "../../docs/store-listing-drafts.md"), "utf8").replace(/\r\n/g, "\n");
const sections = doc.split(/\n## /).slice(1);
const length = (text: string) => [...text].length;

const fields = sections.flatMap((section) => {
  const language = section.slice(0, section.indexOf("\n"));
  return [...section.matchAll(/\n([^\n]+) \(max (\d+)\):\n```text\n([\s\S]*?)\n```/g)].map((match) => ({
    language,
    field: match[1],
    max: Number(match[2]),
    text: match[3],
  }));
});

const COMPETITORS = /instagram|tiktok|facebook|whatsapp|snapchat|telegram|bumble|hellotalk|tandem|discord|twitter|wechat|meetup/i;
const SUPERLATIVES = /#1|(?<!\p{L})(best|number one|millions?|free forever)(?!\p{L})/iu;

describe("store listing drafts", () => {
  it("has every field for every language", () => {
    const languages = [...new Set(fields.map((f) => f.language))];
    expect(languages).toHaveLength(9);
    for (const language of languages) {
      const names = fields.filter((f) => f.language === language).map((f) => f.field);
      expect(names, language).toContain("Google Play title");
      expect(names, language).toContain("Google Play short description");
      expect(names, language).toContain("Description (App Store) / full description (Google Play)");
      if (!language.startsWith("Swahili")) {
        for (const field of ["App Store name", "App Store subtitle", "App Store keywords", "App Store promotional text"]) {
          expect(names, `${language} ${field}`).toContain(field);
        }
      }
    }
  });

  it("keeps every field within its store's limit, and none empty", () => {
    expect(fields.length).toBeGreaterThan(50);
    for (const { language, field, max, text } of fields) {
      expect(text.trim(), `${language} ${field}`).not.toBe("");
      expect(length(text), `${language} ${field}: ${text}`).toBeLessThanOrEqual(max);
    }
  });

  it("writes keywords comma-separated with no spaces, no repeats and without the app's name", () => {
    for (const { language, text } of fields.filter((f) => f.field === "App Store keywords")) {
      expect(text, language).not.toMatch(/\s/);
      const words = text.split(",");
      expect(words.every(Boolean), language).toBe(true);
      expect(new Set(words).size, language).toBe(words.length);
      expect(text.toLowerCase(), language).not.toContain("yukon3t");
    }
  });

  it("names no competitor and makes no unverifiable superlative", () => {
    for (const { language, field, text } of fields) {
      expect(text, `${language} ${field}`).not.toMatch(COMPETITORS);
      expect(text, `${language} ${field}`).not.toMatch(SUPERLATIVES);
    }
  });

  it("states the limits the app enforces, and never claims ID verification", () => {
    for (const { language, field, text } of fields.filter((f) => f.field.startsWith("Description"))) {
      expect(text, language).toContain("10");
      expect(text, language).toContain("24");
      expect(text, language).toContain("16");
      expect(text, `${language} ${field}`).not.toMatch(/\bID\b|identity|passport|government/i);
    }
  });
});
