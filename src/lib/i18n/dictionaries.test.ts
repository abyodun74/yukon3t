import { describe, it, expect } from "vitest";
import { en } from "@/lib/i18n/en";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";
import { feedCategoryLabels, intentLabels, reportReasonCategoryLabels } from "@/lib/validations";
import { NOTIFICATION_VERB, notificationHasActor } from "@/lib/notification-text";
import { GENERAL_INTERESTS } from "@/lib/interests";
import { GENERAL_CIRCLE_CATEGORIES } from "@/lib/circle-categories";
import { COLLAB_TYPES } from "@/lib/collab-types";
import { LANGUAGES } from "@/lib/languages";
import { EMOJI_STYLE_VALUES } from "@/lib/emoji-style";
import { RINGTONE_LABELS } from "@/lib/ringtones";
import { interestName, languageName, vocabName } from "@/lib/i18n/language-names";

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
  "circles.list.title",
  "collab.board.title",
];
// "{name}: {text}", with nothing in it to translate.
const NAME_THEN_TEXT = ["messages.inbox.from", "messages.thread.incoming"];
// "GIF", and the ", " between the names of a list.
const GIF_LABELS = ["messages.inbox.gif", "messages.thread.bubble.gif", "ui.comments.gifAlt"];
const LATIN_SCRIPT_SHARED = [...GIF_LABELS, "ui.listSeparator", "ui.report.reasons.SPAM"];
// Feature and brand names kept as they are: Ambient (like Muse), and two of the emoji sets.
const NAMES_KEPT = ["settings.ambient.heading", "settings.emoji.styles.google", "settings.emoji.styles.twitter"];
// "Zoom", "Total", "Marimba", "Yoga" and "Fitness" are the words Spanish, French and Portuguese use too, and "min"
// their abbreviation of "minutes" in "{date} · {minutes} min".
const LATIN_LOANWORDS = [
  "ui.crop.zoom",
  "advertise.form.total",
  "settings.calls.ringtones.MARIMBA",
  "vocab.interests.Yoga",
  "vocab.interests.Fitness",
  "collab.session.recording",
];
const SAME_AS_ENGLISH: Record<Exclude<Locale, "en">, string[]> = {
  es: [
    ...PRODUCT_NAME_TITLES,
    ...NAME_THEN_TEXT,
    ...LATIN_SCRIPT_SHARED,
    ...NAMES_KEPT,
    ...LATIN_LOANWORDS,
    "settings.calls.ringtones.DIGITAL",
    "messages.hidden.pin",
    "messages.inbox.video",
    "messages.thread.bubble.video",
    "ui.report.reasons.PHISHING",
    "feed.categories.GENERAL",
    "shell.viewer.videoLabel",
    "vocab.collabTypes.Networking",
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
    "muse.feed.pause",
    "pages.connections.message",
    "pages.home.standard",
    "pages.notifications.title",
    "pages.search.collaborations",
    "pages.search.participants",
    "shell.footer.faq",
    "shell.nav.faq",
    "shell.nav.messages",
    "shell.nav.notifications",
    ...NAMES_KEPT,
    ...LATIN_LOANWORDS,
    // "Bio", "Notifications", and these interests and language names, are spelled the same in French.
    "profile.edit.bio",
    "settings.notifications.heading",
    "vocab.interests.Architecture",
    "vocab.interests.Camping",
    "vocab.interests.Tennis",
    "vocab.interests.Podcasts",
    "vocab.interests.Agriculture",
    "vocab.interests.Aviation",
    "vocab.languages.Tagalog",
    "vocab.languages.Dari",
    // "Type", "Public", "Co-admin", "Participants", "Culture" and "Hackathons" are French words too.
    "circles.channels.type",
    "circles.channels.public",
    "circles.details.public",
    "circles.list.coAdmin",
    "circles.members.coAdmin",
    "collab.form.type",
    "collab.participants.coAdmin",
    "collab.board.participants",
    "collab.detail.participantsHeading",
    "vocab.circleCategories.Culture",
    "vocab.collabTypes.Hackathons",
  ],
  pt: [
    "onboarding.bio",
    ...PRODUCT_NAME_TITLES,
    ...NAME_THEN_TEXT,
    ...LATIN_SCRIPT_SHARED,
    "messages.hidden.pin",
    "ui.online",
    "ui.report.reasons.PHISHING",
    ...NAMES_KEPT,
    ...LATIN_LOANWORDS,
    "profile.page.offline",
    "profile.edit.bio",
    "settings.calls.ringtones.DIGITAL",
    "vocab.interests.Podcasts",
    "vocab.languages.Dari",
    "vocab.collabTypes.Hackathons",
    "vocab.collabTypes.Networking",
  ],
  ar: [...PRODUCT_NAME_TITLES, ...NAME_THEN_TEXT, ...NAMES_KEPT],
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

  it("uses the app's own ringtone names and emoji styles in English", () => {
    expect(en.settings.calls.ringtones).toEqual(RINGTONE_LABELS);
    expect(Object.keys(en.settings.emoji.styles).sort()).toEqual([...EMOJI_STYLE_VALUES].sort());
  });

  it("lists every general interest, under its stored name in English", () => {
    expect(Object.keys(en.vocab.interests)).toEqual([...GENERAL_INTERESTS]);
    for (const interest of GENERAL_INTERESTS) expect(en.vocab.interests[interest]).toBe(interest);
  });

  it("lists every general Circle category and every collaboration type, under its stored name in English", () => {
    expect(Object.keys(en.vocab.circleCategories)).toEqual([...GENERAL_CIRCLE_CATEGORIES]);
    for (const category of GENERAL_CIRCLE_CATEGORIES) expect(en.vocab.circleCategories[category]).toBe(category);
    expect(Object.keys(en.vocab.collabTypes)).toEqual([...COLLAB_TYPES]);
    for (const type of COLLAB_TYPES) expect(en.vocab.collabTypes[type]).toBe(type);
  });

  it.each(TRANSLATED)("%s shows a Circle category or collaboration type it has no name for as stored", (locale) => {
    const { circleCategories, collabTypes } = DICTIONARIES[locale].vocab;
    expect(vocabName("Bookkeeping", circleCategories)).toBe("Bookkeeping");
    expect(vocabName("constructor", collabTypes)).toBe("constructor");
    expect(vocabName("Travel", circleCategories)).toBe(circleCategories.Travel);
    expect(vocabName("Mentorship", collabTypes)).toBe(collabTypes.Mentorship);
  });

  it.each(TRANSLATED)("%s shows an interest it has no name for as stored", (locale) => {
    const interests = DICTIONARIES[locale].vocab.interests;
    expect(interestName("Bookkeeping", interests)).toBe("Bookkeeping");
    expect(interestName("toString", interests)).toBe("toString");
    expect(interestName("Travel", interests)).toBe(interests.Travel);
  });

  it.each(TRANSLATED)("%s names every spoken language, and words the listed ones itself", (locale) => {
    const extras = DICTIONARIES[locale].vocab.languages;
    for (const extra of Object.keys(extras)) expect(LANGUAGES as readonly string[], extra).toContain(extra);
    for (const language of LANGUAGES) {
      expect(languageName(language, locale, extras).trim(), language).not.toBe("");
      expect(languageName(language, "en", extras)).toBe(language);
    }
    expect(languageName("Mandarin Chinese", locale, extras)).toBe(extras["Mandarin Chinese"]);
    expect(languageName("Not a language", locale, extras)).toBe("Not a language");
  });
});
