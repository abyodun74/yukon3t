import { describe, it, expect } from "vitest";
import { en } from "@/lib/i18n/en";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";
import { feedCategoryLabels, intentLabels, reportReasonCategoryLabels } from "@/lib/validations";
import { NOTIFICATION_VERB, notificationHasActor } from "@/lib/notification-text";

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

// "one: … | other: …" entries (see plural() in locales.ts).
const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"];
function pluralForms(text: string): Map<string, string> | null {
  if (!/^(zero|one|two|few|many|other): /.test(text)) return null;
  return new Map(
    text.split("|").map((part) => {
      const colon = part.indexOf(":");
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()] as const;
    }),
  );
}

const english = flatten(en);
const TRANSLATED = SUPPORTED_LOCALES.filter((locale) => locale !== "en");

// Entries that really are spelled the same in both languages. Anything else left identical to English is a miss.
const PRODUCT_NAME_TITLES = [
  "landing.circles.title",
  "landing.collabBoards.title",
  "shell.nav.circles",
  "shell.nav.collab",
  "shell.nav.collabBoards",
  "shell.nav.muse",
  "pages.search.circles",
];
// "{name}: {text}", with nothing in it to translate.
const NAME_THEN_TEXT = ["messages.inbox.from", "messages.thread.incoming"];
// "GIF", and the ", " between the names of a list.
const GIF_LABELS = ["messages.inbox.gif", "messages.thread.bubble.gif", "ui.comments.gifAlt"];
const LATIN_SCRIPT_SHARED = [...GIF_LABELS, "ui.listSeparator", "ui.report.reasons.SPAM"];
const SAME_AS_ENGLISH: Record<Exclude<Locale, "en">, string[]> = {
  es: [
    ...PRODUCT_NAME_TITLES,
    ...NAME_THEN_TEXT,
    ...LATIN_SCRIPT_SHARED,
    "messages.hidden.pin",
    "messages.inbox.video",
    "messages.thread.bubble.video",
    "ui.report.reasons.PHISHING",
    "feed.categories.GENERAL",
    "shell.viewer.videoLabel",
  ],
  // French puts a space before the colon, so its "{name} : {text}" differs.
  fr: [
    "onboarding.bio",
    ...PRODUCT_NAME_TITLES,
    ...LATIN_SCRIPT_SHARED,
    "messages.fallback.message",
    "messages.inbox.title",
    "messages.inbox.photo",
    "messages.thread.bubble.photo",
    // "Message", "Messages", "Notifications", "Pause", "Standard", "FAQ", "Collaborations" and "participant(s)" are
    // French words too.
    "feed.people.message",
    "feed.post.pause",
    "pages.connections.message",
    "pages.home.standard",
    "pages.notifications.title",
    "pages.search.collaborations",
    "pages.search.participants",
    "shell.footer.faq",
    "shell.nav.faq",
    "shell.nav.messages",
    "shell.nav.notifications",
  ],
  pt: [
    "onboarding.bio",
    ...PRODUCT_NAME_TITLES,
    ...NAME_THEN_TEXT,
    ...LATIN_SCRIPT_SHARED,
    "messages.hidden.pin",
    "ui.online",
    "ui.report.reasons.PHISHING",
  ],
  ar: [...PRODUCT_NAME_TITLES, ...NAME_THEN_TEXT],
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
      const forms = pluralForms(translated.get(path) as string);
      if (forms) {
        // A language may have more forms than English has, each with the same placeholders as an English form.
        const expected = placeholders([...pluralForms(value as string)!.values()][0]);
        for (const form of forms.values()) expect(placeholders(form), path).toEqual(expected);
      } else {
        expect(placeholders(translated.get(path) as string), path).toEqual(placeholders(value as string));
      }
    }
  });

  it.each(SUPPORTED_LOCALES)("%s gives every plural entry the forms its grammar needs", (locale) => {
    const translated = flatten(DICTIONARIES[locale]);
    // Spanish, French and Portuguese also have a "many" form, for whole millions only; "other" covers it.
    const needed = new Intl.PluralRules(locale).resolvedOptions().pluralCategories.filter(
      (category) => locale === "ar" || category !== "many",
    );
    let seen = 0;
    for (const [path, value] of english) {
      if (!pluralForms(value as string)) {
        expect(pluralForms(translated.get(path) as string), path).toBeNull();
        continue;
      }
      seen++;
      const forms = pluralForms(translated.get(path) as string);
      expect(forms, path).not.toBeNull();
      expect([...forms!.keys()].sort(), path).toEqual([...needed].sort());
      for (const [category, form] of forms!) {
        expect(PLURAL_CATEGORIES, path).toContain(category);
        expect(form, `${path} (${category})`).not.toBe("");
        // "#" is where the number goes. A form that spells its number out ("one member", "دقيقتين") may leave it out;
        // "other" covers a whole range of numbers and never can.
        if (category === "other") expect(form, path).toContain("#");
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it.each(TRANSLATED)("%s leaves nothing in English", (locale) => {
    const translated = flatten(DICTIONARIES[locale]);
    const same = [...english].filter(([path, value]) => translated.get(path) === value).map(([path]) => path);
    expect(same.sort()).toEqual([...SAME_AS_ENGLISH[locale]].sort());
  });

  it.each(SUPPORTED_LOCALES)("%s keeps product names as they are", (locale) => {
    const translated = flatten(DICTIONARIES[locale]);
    for (const [path, value] of english) {
      for (const name of ["YuKon3t", "Circle"]) {
        if ((value as string).includes(name)) expect(translated.get(path), path).toContain(name);
      }
    }
  });

  it("uses the app's own intent labels in English", () => {
    expect(en.onboarding.intents).toEqual(intentLabels);
  });

  it("uses the app's own intent and feed category labels in English", () => {
    expect(en.feed.intents).toEqual(intentLabels);
    const { all, ...categories } = en.feed.categories;
    expect(all).toBe("All");
    expect(categories).toEqual(feedCategoryLabels);
  });

  it("has a sentence for every notification type, built on the app's own wording in English", () => {
    const types = en.pages.notifications.types;
    expect(Object.keys(types).sort()).toEqual(Object.keys(NOTIFICATION_VERB).sort());
    for (const [type, verb] of Object.entries(NOTIFICATION_VERB)) {
      const hasActor = notificationHasActor(type as keyof typeof NOTIFICATION_VERB);
      expect(types[type as keyof typeof types], type).toBe(hasActor ? `{name} ${verb}` : verb);
    }
  });

  it.each(SUPPORTED_LOCALES)("%s names the person in exactly the notifications that have one", (locale) => {
    const types = DICTIONARIES[locale].pages.notifications.types;
    for (const type of Object.keys(NOTIFICATION_VERB) as (keyof typeof NOTIFICATION_VERB)[]) {
      expect(types[type].includes("{name}"), type).toBe(notificationHasActor(type));
    }
  });

  it("uses the app's own report reasons in English", () => {
    expect(en.ui.report.reasons).toEqual(reportReasonCategoryLabels);
  });
});
