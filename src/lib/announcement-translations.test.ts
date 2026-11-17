import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_TRANSLATION_LOCALES,
  ANNOUNCEMENT_UNTRANSLATED_CLOSE,
  ANNOUNCEMENT_UNTRANSLATED_OPEN,
  announcementPushPayload,
  announcementTextFor,
  applyDrafts,
  canRetryDraft,
  draftFailureStopsQueue,
  draftStatusFromResult,
  draftTargets,
  hasUntranslatedMarker,
  isAnnouncementTranslationLocale,
  markUntranslated,
  translationFieldsFromRows,
  translationFieldState,
  translationSubmitProblem,
  translationsForSubmit,
  type DraftLanguageStatus,
} from "./announcement-translations";
import {
  announcementDraftSchema,
  announcementEditSchema,
  announcementSchema,
  announcementTranslationSchema,
  announcementTranslationsSchema,
} from "./validations";
import { SUPPORTED_LOCALES } from "./i18n/locales";

const base = { title: "New: polls", body: "You can now add a poll to any post." };
const es = { locale: "es", title: "Nuevo: encuestas", body: "Ya puedes añadir una encuesta a cualquier publicación." };

describe("announcementTextFor (fallback rule)", () => {
  it("gives the reader's language when that version exists", () => {
    expect(announcementTextFor({ ...base, translations: [es] }, "es")).toEqual({
      title: es.title,
      body: es.body,
      locale: "es",
    });
  });

  it("falls back to the base English for a language with no version", () => {
    expect(announcementTextFor({ ...base, translations: [es] }, "fr")).toEqual({ ...base, locale: "en" });
  });

  it("gives English to an English reader even if rows exist, and handles no translations at all", () => {
    expect(announcementTextFor({ ...base, translations: [es] }, "en")).toEqual({ ...base, locale: "en" });
    expect(announcementTextFor(base, "ar")).toEqual({ ...base, locale: "en" });
    expect(announcementTextFor({ ...base, translations: null }, "ar")).toEqual({ ...base, locale: "en" });
  });

  it("never mixes halves: a row missing either half falls back whole", () => {
    expect(announcementTextFor({ ...base, translations: [{ ...es, body: "  " }] }, "es")).toEqual({
      ...base,
      locale: "en",
    });
  });
});

describe("translation locales", () => {
  it("are every supported language except English", () => {
    expect([...ANNOUNCEMENT_TRANSLATION_LOCALES].sort()).toEqual(SUPPORTED_LOCALES.filter((l) => l !== "en").sort());
    expect(isAnnouncementTranslationLocale("en")).toBe(false);
    expect(isAnnouncementTranslationLocale("sw")).toBe(true);
    expect(isAnnouncementTranslationLocale("zh")).toBe(false);
  });
});

describe("announcementPushPayload", () => {
  it("words the push per recipient language with the English fallback", () => {
    const push = announcementPushPayload({ ...base, translations: [es] });
    expect(push("es")).toEqual({ title: es.title, body: es.body });
    expect(push("de")).toEqual(base);
    expect(push("en")).toEqual(base);
  });
});

describe("form helpers", () => {
  it("reports each language's state", () => {
    expect(translationFieldState(undefined)).toBe("empty");
    expect(translationFieldState({ title: " ", body: "" })).toBe("empty");
    expect(translationFieldState({ title: "Hola", body: "" })).toBe("partial");
    expect(translationFieldState({ title: "", body: "Cuerpo largo" })).toBe("partial");
    expect(translationFieldState({ title: "Hola", body: "Cuerpo largo" })).toBe("filled");
  });

  it("draftTargets asks only for the empty halves of selected languages", () => {
    const targets = draftTargets(
      { es: { title: "Typed title", body: "" }, fr: { title: "Titre", body: "Corps du texte" } },
      ["es", "fr", "de"],
    );
    expect(targets).toEqual([
      { locale: "es", fields: ["body"] },
      { locale: "de", fields: ["title", "body"] },
    ]);
    expect(draftTargets({}, [])).toEqual([]);
  });

  it("applyDrafts never overwrites text the admin typed, even typed after the request", () => {
    const current = {
      es: { title: "Mi título", body: "" },
      fr: { title: "Titre tapé pendant la requête", body: "Corps tapé pendant la requête" },
    };
    const { fields, drafted } = applyDrafts(current, [
      { locale: "es", title: "Draft title", body: "Draft body es" },
      { locale: "fr", title: "Draft fr", body: "Draft body fr" },
      { locale: "de", title: "Neu: Umfragen", body: "Jetzt Umfragen in Beiträgen" },
    ]);
    expect(fields.es).toEqual({ title: "Mi título", body: "Draft body es" });
    expect(fields.fr).toEqual(current.fr);
    expect(fields.de).toEqual({ title: "Neu: Umfragen", body: "Jetzt Umfragen in Beiträgen" });
    expect(drafted).toEqual(["es", "de"]);
    // The input object is not mutated.
    expect(current.es.body).toBe("");
  });

  it("applyDrafts ignores unknown locales and empty draft text", () => {
    const { fields, drafted } = applyDrafts({}, [
      { locale: "en" as never, title: "x", body: "y" },
      { locale: "it", title: "  ", body: "" },
    ]);
    expect(fields).toEqual({});
    expect(drafted).toEqual([]);
  });

  it("translationsForSubmit drops empty languages and keeps partial ones for validation to refuse", () => {
    expect(
      translationsForSubmit({
        es: { title: "Hola", body: "Cuerpo largo" },
        fr: { title: "", body: "" },
        de: { title: "Nur Titel", body: "" },
      }),
    ).toEqual([
      { locale: "es", title: "Hola", body: "Cuerpo largo" },
      { locale: "de", title: "Nur Titel", body: "" },
    ]);
  });
});

describe("validation", () => {
  it("accepts a complete translation in a supported non-English language, trimmed", () => {
    const parsed = announcementTranslationSchema.parse({ locale: "ar", title: "  جديد  ", body: "  نص الإعلان هنا  " });
    expect(parsed).toEqual({ locale: "ar", title: "جديد", body: "نص الإعلان هنا" });
  });

  it("rejects the base language, unknown languages and empty halves", () => {
    expect(announcementTranslationSchema.safeParse({ ...es, locale: "en" }).success).toBe(false);
    expect(announcementTranslationSchema.safeParse({ ...es, locale: "zh" }).success).toBe(false);
    expect(announcementTranslationSchema.safeParse({ ...es, body: "" }).success).toBe(false);
    expect(announcementTranslationSchema.safeParse({ ...es, title: "   " }).success).toBe(false);
  });

  it("uses the same length limits as the base fields", () => {
    const ok = { locale: "es", title: "x".repeat(120), body: "y".repeat(4000) };
    expect(announcementTranslationSchema.safeParse(ok).success).toBe(true);
    expect(announcementSchema.safeParse({ title: ok.title, body: ok.body }).success).toBe(true);
    expect(announcementTranslationSchema.safeParse({ ...ok, title: "x".repeat(121) }).success).toBe(false);
    expect(announcementSchema.safeParse({ title: "x".repeat(121), body: ok.body }).success).toBe(false);
    expect(announcementTranslationSchema.safeParse({ ...ok, body: "y".repeat(4001) }).success).toBe(false);
    expect(announcementTranslationSchema.safeParse({ ...ok, title: "ab" }).success).toBe(false);
    expect(announcementTranslationSchema.safeParse({ ...ok, body: "short" }).success).toBe(false);
  });

  it("refuses two versions for the same language and more than eight", () => {
    expect(announcementTranslationsSchema.safeParse([es, es]).success).toBe(false);
    expect(announcementTranslationsSchema.safeParse([es]).success).toBe(true);
    expect(announcementTranslationsSchema.safeParse([]).success).toBe(true);
    expect(
      announcementTranslationsSchema.safeParse(Array.from({ length: 9 }, (_, i) => ({ ...es, locale: `l${i}` }))).success,
    ).toBe(false);
  });

  it("draft requests (one language each) need postable English, a supported language and at least one half", () => {
    expect(announcementDraftSchema.safeParse({ ...base, locale: "hi", fields: ["title", "body"] }).success).toBe(true);
    expect(announcementDraftSchema.safeParse({ title: "ab", body: base.body, locale: "es", fields: ["title"] }).success).toBe(
      false,
    );
    expect(announcementDraftSchema.safeParse({ ...base, locale: "en", fields: ["title"] }).success).toBe(false);
    expect(announcementDraftSchema.safeParse({ ...base, locale: "es", fields: [] }).success).toBe(false);
    expect(announcementDraftSchema.safeParse({ ...base, locale: "es", fields: ["summary"] }).success).toBe(false);
  });

  it("refuses a translation still holding a partial draft's marker", () => {
    expect(announcementTranslationSchema.safeParse({ ...es, body: `Hola. ${markUntranslated("The rest.")}` }).success).toBe(
      false,
    );
    expect(announcementTranslationSchema.safeParse({ ...es, title: markUntranslated("Title") }).success).toBe(false);
  });

  it("edit requests need a cuid and a known media mode", () => {
    expect(announcementEditSchema.safeParse({ id: "ckabcdefghijklmnopqrstuvw", media: "keep" }).success).toBe(true);
    expect(announcementEditSchema.safeParse({ id: "ckabcdefghijklmnopqrstuvw", media: "delete" }).success).toBe(false);
    expect(announcementEditSchema.safeParse({ id: "", media: "remove" }).success).toBe(false);
  });
});

describe("drafting UI helpers", () => {
  const ok = { error: null, locale: "es" as const, failed: [], partial: null, tooLong: [] };

  it("draftStatusFromResult: done, partial, failed and thrown calls", () => {
    expect(draftStatusFromResult({ ...ok, title: "T", body: "B" }, ["title", "body"])).toEqual({ state: "done", tooLong: [] });
    expect(draftStatusFromResult({ ...ok, body: "B", tooLong: ["body"] }, ["body"])).toEqual({ state: "done", tooLong: ["body"] });
    expect(
      draftStatusFromResult({ ...ok, title: "T", body: "B [[...]]", partial: { done: 2, total: 5 } }, ["title", "body"]),
    ).toEqual({ state: "partial", missingTitle: false, body: { done: 2, total: 5 }, tooLong: [] });
    expect(draftStatusFromResult({ ...ok, body: "B", failed: ["title"] }, ["title", "body"])).toEqual({
      state: "partial",
      missingTitle: true,
      body: null,
      tooLong: [],
    });
    expect(draftStatusFromResult({ ...ok, failed: ["title", "body"] }, ["title", "body"])).toEqual({
      state: "failed",
      reason: "failed",
    });
    expect(draftStatusFromResult({ error: "rate_limited" }, ["title"])).toEqual({ state: "failed", reason: "rate_limited" });
    expect(draftStatusFromResult(null, ["title"])).toEqual({ state: "failed", reason: "failed" });
  });

  it("only a rate limit or a missing configuration stops the rest of the queue", () => {
    expect(draftFailureStopsQueue("rate_limited")).toBe(true);
    expect(draftFailureStopsQueue("unavailable")).toBe(true);
    expect(draftFailureStopsQueue("failed")).toBe(false);
    expect(draftFailureStopsQueue("invalid")).toBe(false);
  });

  it("canRetryDraft: failed languages and partial ones with an empty half", () => {
    const empty = { title: "", body: "" };
    expect(canRetryDraft({ state: "failed", reason: "failed" }, empty)).toBe(true);
    expect(canRetryDraft({ state: "failed", reason: "invalid" }, empty)).toBe(false);
    const partial: DraftLanguageStatus = { state: "partial", missingTitle: true, body: null, tooLong: [] };
    expect(canRetryDraft(partial, { title: "", body: "B" })).toBe(true);
    expect(canRetryDraft(partial, { title: "T", body: "B" })).toBe(false);
    expect(canRetryDraft({ state: "done", tooLong: [] }, empty)).toBe(false);
    expect(canRetryDraft(undefined, empty)).toBe(false);
  });

  it("translationSubmitProblem: half filled, unfinished draft, too long; empty languages are fine", () => {
    expect(translationSubmitProblem({ es: { title: "Hola", body: "Cuerpo largo" }, fr: { title: "", body: "" } })).toBeNull();
    expect(translationSubmitProblem({ es: { title: "Hola", body: "" } })).toEqual({ locale: "es", reason: "partial" });
    expect(translationSubmitProblem({ ar: { title: "عنوان", body: `نص ${markUntranslated("rest")}` } })).toEqual({
      locale: "ar",
      reason: "untranslated",
    });
    expect(translationSubmitProblem({ hi: { title: "शीर्षक", body: "x".repeat(4001) } })).toEqual({
      locale: "hi",
      reason: "too_long",
    });
    expect(hasUntranslatedMarker(`a ${ANNOUNCEMENT_UNTRANSLATED_OPEN}b${ANNOUNCEMENT_UNTRANSLATED_CLOSE}`)).toBe(true);
  });

  it("translationFieldsFromRows fills the edit form and ignores unknown locales", () => {
    expect(
      translationFieldsFromRows([
        { locale: "es", title: "Hola", body: "Cuerpo largo" },
        { locale: "zh", title: "x", body: "y" },
      ]),
    ).toEqual({ es: { title: "Hola", body: "Cuerpo largo" } });
  });
});
