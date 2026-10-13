import { describe, it, expect } from "vitest";
import { en } from "@/lib/i18n/en";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";
import { intentLabels } from "@/lib/validations";

/** Every entry of a dictionary by its dotted path ("signIn.errors.locked", "shared.birthDate.months.0"). */
function flatten(value: unknown, path = "", out = new Map<string, unknown>()) {
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) flatten(child, path ? `${path}.${key}` : key, out);
  } else {
    out.set(path, value);
  }
  return out;
}

function placeholders(text: string) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

const english = flatten(en);
const TRANSLATED = SUPPORTED_LOCALES.filter((locale) => locale !== "en");

// Entries that really are spelled the same in both languages. Anything else left identical to English is a miss.
const PRODUCT_NAME_TITLES = ["landing.circles.title", "landing.collabBoards.title"];
const SAME_AS_ENGLISH: Record<Exclude<Locale, "en">, string[]> = {
  es: [...PRODUCT_NAME_TITLES],
  fr: ["onboarding.bio", ...PRODUCT_NAME_TITLES],
  pt: ["onboarding.bio", ...PRODUCT_NAME_TITLES],
};

describe("dictionaries", () => {
  it("has one per supported language", () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(DICTIONARIES.en).toBe(en);
  });

  it.each(SUPPORTED_LOCALES)("%s has exactly the English keys", (locale) => {
    expect([...flatten(DICTIONARIES[locale]).keys()].sort()).toEqual([...english.keys()].sort());
  });

  it.each(SUPPORTED_LOCALES)("%s has no empty or non-string entries", (locale) => {
    for (const [path, value] of flatten(DICTIONARIES[locale])) {
      expect(typeof value, path).toBe("string");
      expect((value as string).trim(), path).not.toBe("");
    }
  });

  it.each(SUPPORTED_LOCALES)("%s keeps every placeholder of the English string", (locale) => {
    const translated = flatten(DICTIONARIES[locale]);
    for (const [path, value] of english) {
      expect(placeholders(translated.get(path) as string), path).toEqual(placeholders(value as string));
    }
  });

  it.each(TRANSLATED)("%s leaves nothing in English", (locale) => {
    const translated = flatten(DICTIONARIES[locale]);
    const same = [...english].filter(([path, value]) => translated.get(path) === value).map(([path]) => path);
    expect(same.sort()).toEqual([...SAME_AS_ENGLISH[locale]].sort());
  });

  it.each(SUPPORTED_LOCALES)("%s keeps product names as they are", (locale) => {
    const translated = flatten(DICTIONARIES[locale]);
    for (const [path, value] of english) {
      for (const name of ["YuKon3t", "Circles"]) {
        if ((value as string).includes(name)) expect(translated.get(path), path).toContain(name);
      }
    }
  });

  it("uses the app's own intent labels in English", () => {
    expect(en.onboarding.intents).toEqual(intentLabels);
  });
});
