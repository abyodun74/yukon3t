import { beforeEach, describe, expect, it, vi } from "vitest";

// createAnnouncement and updateAnnouncement (with per-language versions) and draftAnnouncementTranslation: admin-only,
// validated; an edit never notifies anyone; the draft action only ever returns text for what was asked (it never
// writes anything).
const { AuthError } = vi.hoisted(() => ({ AuthError: class AuthError extends Error {} }));

const requireAdmin = vi.fn();
const announcementCreate = vi.fn();
const announcementUpdate = vi.fn();
const announcementFindUnique = vi.fn();
const broadcastFcmAnnouncement = vi.fn();
const broadcastPushAnnouncement = vi.fn();
const publishEvent = vi.fn();
const revalidatePath = vi.fn();
const deleteOwnedUploads = vi.fn();
const deleteObject = vi.fn();
const verifyUploadedSize = vi.fn();
const checkRateLimit = vi.fn();
const callTranslationModelDetailed = vi.fn();
const isTranslationConfigured = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth-guards", () => ({
  AuthError,
  requireAdmin: () => requireAdmin(),
  requireUser: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    announcement: {
      create: (...a: unknown[]) => announcementCreate(...a),
      update: (...a: unknown[]) => announcementUpdate(...a),
      findUnique: (...a: unknown[]) => announcementFindUnique(...a),
    },
  },
}));
vi.mock("@/lib/fcm", () => ({ broadcastFcmAnnouncement: (...a: unknown[]) => broadcastFcmAnnouncement(...a) }));
vi.mock("@/lib/push", () => ({ broadcastPushAnnouncement: (...a: unknown[]) => broadcastPushAnnouncement(...a) }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: (...a: unknown[]) => publishEvent(...a) }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: { "announcement-image": 100, "announcement-video": 200 },
  verifyUploadedSize: (...a: unknown[]) => verifyUploadedSize(...a),
  deleteObject: (...a: unknown[]) => deleteObject(...a),
  keyFromPublicUrl: (url: string) => (url.startsWith("https://cdn.example/") ? url.replace("https://cdn.example/", "") : null),
  keyBelongsToOwner: (key: string, owner: string) => key.split("/")[1] === owner,
}));
vi.mock("@/lib/owned-uploads", () => ({ deleteOwnedUploads: (...a: unknown[]) => deleteOwnedUploads(...a) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/translation-server", () => ({
  callTranslationModelDetailed: (...a: unknown[]) => callTranslationModelDetailed(...a),
  isTranslationConfigured: () => isTranslationConfigured(),
}));

import { createAnnouncement, updateAnnouncement } from "./announcements";
import { draftAnnouncementTranslation } from "./announcement-drafts";
import { ANNOUNCEMENT_UNTRANSLATED_OPEN } from "@/lib/announcement-translations";

const ADMIN = { id: "admin1", isAdmin: true };
const EN = { title: "New: polls", body: "Add a poll to any post now." };
const ES = { locale: "es", title: "Nuevo: encuestas", body: "Añade una encuesta a cualquier publicación." };
const ID = "ckabcdefghijklmnopqrstuvw";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  announcementCreate.mockResolvedValue({ id: "a1" });
  announcementUpdate.mockResolvedValue({ id: ID });
  announcementFindUnique.mockResolvedValue({ id: ID, mediaUrl: null, mediaThumbnailUrl: null });
  verifyUploadedSize.mockResolvedValue(true);
  checkRateLimit.mockResolvedValue(true);
  isTranslationConfigured.mockReturnValue(true);
  callTranslationModelDetailed.mockImplementation(async (text: string, locale: string) => ({
    ok: true,
    sourceLang: "en",
    translation: `[${locale}] ${text}`,
  }));
});

describe("createAnnouncement", () => {
  it("rejects a non-admin before touching anything", async () => {
    requireAdmin.mockRejectedValue(new AuthError("Admin access required."));
    await expect(createAnnouncement(form({ ...EN, translations: JSON.stringify([ES]) }))).rejects.toThrow(AuthError);
    expect(announcementCreate).not.toHaveBeenCalled();
    expect(broadcastFcmAnnouncement).not.toHaveBeenCalled();
  });

  it("stores the English as the base and each translation as its own row, then pushes per language", async () => {
    const result = await createAnnouncement(form({ ...EN, translations: JSON.stringify([ES]) }));
    expect(result).toEqual({ error: null });
    expect(announcementCreate.mock.calls[0][0].data).toMatchObject({
      ...EN,
      createdById: "admin1",
      translations: { create: [ES] },
    });
    const fcmText = broadcastFcmAnnouncement.mock.calls[0][0] as (l: string) => { title: string };
    expect(fcmText("es").title).toBe(ES.title);
    expect(fcmText("fr").title).toBe(EN.title);
    const webText = broadcastPushAnnouncement.mock.calls[0][0] as (l: string) => { title: string; url: string };
    expect(webText("es")).toEqual({ title: ES.title, body: ES.body, url: "/whats-new" });
    expect(webText("hi")).toEqual({ ...EN, url: "/whats-new" });
  });

  it("works with no translations at all (English only, as before)", async () => {
    expect(await createAnnouncement(form(EN))).toEqual({ error: null });
    expect(announcementCreate.mock.calls[0][0].data.translations).toBeUndefined();
  });

  it("refuses a half-filled, English or duplicate language and creates nothing", async () => {
    for (const translations of [
      [{ ...ES, body: "" }],
      [{ ...ES, locale: "en" }],
      [ES, ES],
      "not json",
    ]) {
      const raw = typeof translations === "string" ? translations : JSON.stringify(translations);
      const result = await createAnnouncement(form({ ...EN, translations: raw }));
      expect(result.error).toBe("invalid_translation");
    }
    const half = await createAnnouncement(form({ ...EN, translations: JSON.stringify([{ ...ES, body: "" }]) }));
    expect(half).toEqual({ error: "invalid_translation", locale: "es" });
    expect(announcementCreate).not.toHaveBeenCalled();
    expect(broadcastFcmAnnouncement).not.toHaveBeenCalled();
  });
});


describe("updateAnnouncement", () => {
  const FR = { locale: "fr", title: "Nouveau : sondages", body: "Ajoutez un sondage à n'importe quelle publication." };
  const edit = (fields: Record<string, string> = {}) =>
    form({ id: ID, media: "keep", ...EN, translations: JSON.stringify([ES, FR]), ...fields });

  function expectNoNotification() {
    expect(broadcastFcmAnnouncement).not.toHaveBeenCalled();
    expect(broadcastPushAnnouncement).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  }

  it("rejects a non-admin before reading or writing anything", async () => {
    requireAdmin.mockRejectedValue(new AuthError("Admin access required."));
    await expect(updateAnnouncement(edit())).rejects.toThrow(AuthError);
    expect(announcementFindUnique).not.toHaveBeenCalled();
    expect(announcementUpdate).not.toHaveBeenCalled();
  });

  it("saves text and replaces the whole translation set in one write, without any push or createdAt change", async () => {
    expect(await updateAnnouncement(edit())).toEqual({ error: null });
    expect(announcementUpdate).toHaveBeenCalledTimes(1);
    const arg = announcementUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: ID });
    expect(arg.data).toEqual({ ...EN, translations: { deleteMany: {}, create: [ES, FR] } });
    expect(arg.data).not.toHaveProperty("createdAt");
    expect(arg.data).not.toHaveProperty("mediaUrl");
    expectNoNotification();
    expect(revalidatePath).toHaveBeenCalledWith("/whats-new");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/announcements");
    expect(checkRateLimit).toHaveBeenCalledWith("announcementEdit", "admin1");
  });

  it("removes a language by leaving it out (and all of them with an empty list)", async () => {
    await updateAnnouncement(edit({ translations: JSON.stringify([ES]) }));
    expect(announcementUpdate.mock.calls[0][0].data.translations).toEqual({ deleteMany: {}, create: [ES] });
    await updateAnnouncement(edit({ translations: JSON.stringify([]) }));
    expect(announcementUpdate.mock.calls[1][0].data.translations).toEqual({ deleteMany: {} });
  });

  it("refuses a half-filled, unsupported, duplicate or unfinished language and writes nothing", async () => {
    for (const translations of [
      [{ ...ES, title: "" }],
      [{ ...ES, locale: "zh" }],
      [ES, ES],
      [{ ...ES, body: `Hola. ${ANNOUNCEMENT_UNTRANSLATED_OPEN}Rest of the text.]]` }],
      [{ ...ES, body: "y".repeat(4001) }],
    ]) {
      const result = await updateAnnouncement(edit({ translations: JSON.stringify(translations) }));
      expect(result.error).toBe("invalid_translation");
    }
    expect(await updateAnnouncement(edit({ title: "ab" }))).toEqual({ error: "invalid" });
    expect(await updateAnnouncement(edit({ id: "not a cuid" }))).toEqual({ error: "invalid" });
    expect(await updateAnnouncement(edit({ media: "swap" }))).toEqual({ error: "invalid" });
    expect(announcementUpdate).not.toHaveBeenCalled();
    expectNoNotification();
  });

  it("answers not_found for a missing (or concurrently deleted) announcement", async () => {
    announcementFindUnique.mockResolvedValueOnce(null);
    expect(await updateAnnouncement(edit())).toEqual({ error: "not_found" });
    expect(announcementUpdate).not.toHaveBeenCalled();

    announcementUpdate.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "P2025" }));
    expect(await updateAnnouncement(edit())).toEqual({ error: "not_found" });
  });

  it("is rate-limited per admin", async () => {
    checkRateLimit.mockResolvedValueOnce(false);
    expect(await updateAnnouncement(edit())).toEqual({ error: "rate_limited" });
    expect(announcementUpdate).not.toHaveBeenCalled();
  });

  it("removes the attachment: clears the columns and deletes the old files after the write", async () => {
    announcementFindUnique.mockResolvedValueOnce({
      id: ID,
      mediaUrl: "https://cdn.example/old.mp4",
      mediaThumbnailUrl: "https://cdn.example/old.jpg",
    });
    expect(await updateAnnouncement(edit({ media: "remove" }))).toEqual({ error: null });
    expect(announcementUpdate.mock.calls[0][0].data).toMatchObject({
      mediaType: null,
      mediaUrl: null,
      mediaThumbnailUrl: null,
    });
    expect(deleteObject.mock.calls.map((c) => c[0]).sort()).toEqual(["old.jpg", "old.mp4"]);
    expectNoNotification();
  });

  it("refuses a video thumbnail that isn't the acting admin's own upload (it would count as a use of that file)", async () => {
    const own = "https://cdn.example/announcement-image/admin1/t.jpg";
    const foreign = "https://cdn.example/post-image/someone/t.jpg";
    const video = { mediaType: "VIDEO", mediaUrl: "https://cdn.example/announcement-video/admin1/v.mp4" };
    expect(await createAnnouncement(form({ ...EN, ...video, mediaThumbnailUrl: foreign }))).toEqual({ error: "invalid" });
    expect(await createAnnouncement(form({ ...EN, ...video, mediaThumbnailUrl: "https://elsewhere.example/t.jpg" }))).toEqual({
      error: "invalid",
    });
    expect(announcementCreate).not.toHaveBeenCalled();
    expect(await createAnnouncement(form({ ...EN, ...video, mediaThumbnailUrl: own }))).toEqual({ error: null });
    expect(announcementCreate.mock.calls[0][0].data).toMatchObject({ mediaThumbnailUrl: own });

    const replace = { media: "replace", ...video, mediaThumbnailUrl: foreign };
    expect(await updateAnnouncement(edit(replace))).toEqual({ error: "invalid" });
    expect(announcementUpdate).not.toHaveBeenCalled();
    expect(deleteOwnedUploads).toHaveBeenCalledWith([video.mediaUrl, foreign], "admin1");
  });

  it("replaces the attachment with a checked upload, and cleans the upload up when refused", async () => {
    announcementFindUnique.mockResolvedValue({ id: ID, mediaUrl: "https://cdn.example/old.png", mediaThumbnailUrl: null });
    const replace = { media: "replace", mediaType: "IMAGE", mediaUrl: "https://cdn.example/new.png" };
    expect(await updateAnnouncement(edit(replace))).toEqual({ error: null });
    expect(announcementUpdate.mock.calls[0][0].data).toMatchObject({
      mediaType: "IMAGE",
      mediaUrl: "https://cdn.example/new.png",
      mediaThumbnailUrl: null,
    });
    expect(verifyUploadedSize).toHaveBeenCalledWith({ key: "new.png", maxBytes: 100, ownerId: "admin1" });
    expect(deleteObject).toHaveBeenCalledWith("old.png");
    expect(deleteObject).not.toHaveBeenCalledWith("new.png");

    vi.clearAllMocks();
    requireAdmin.mockResolvedValue(ADMIN);
    checkRateLimit.mockResolvedValue(true);
    verifyUploadedSize.mockResolvedValue(false);
    expect(await updateAnnouncement(edit(replace))).toEqual({ error: "too_large" });
    expect(deleteOwnedUploads).toHaveBeenCalledWith(["https://cdn.example/new.png"], "admin1");
    expect(announcementUpdate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    requireAdmin.mockResolvedValue(ADMIN);
    expect(await updateAnnouncement(edit({ ...replace, translations: JSON.stringify([{ ...ES, body: "" }]) }))).toEqual({
      error: "invalid_translation",
      locale: "es",
    });
    expect(deleteOwnedUploads).toHaveBeenCalledWith(["https://cdn.example/new.png"], "admin1");

    // "keep" never takes new media.
    expect(await updateAnnouncement(edit({ mediaType: "IMAGE", mediaUrl: "https://cdn.example/x.png" }))).toEqual({
      error: "invalid",
    });
  });
});

describe("draftAnnouncementTranslation (one language per call)", () => {
  const request = { ...EN, locale: "de", fields: ["title", "body"] };

  it("rejects a non-admin without a model call", async () => {
    requireAdmin.mockRejectedValue(new AuthError("Admin access required."));
    await expect(draftAnnouncementTranslation(request)).rejects.toThrow(AuthError);
    expect(callTranslationModelDetailed).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("drafts only the halves asked for (never a half the admin typed) and writes nothing", async () => {
    expect(await draftAnnouncementTranslation(request)).toEqual({
      error: null,
      locale: "de",
      title: `[de] ${EN.title}`,
      body: `[de] ${EN.body}`,
      failed: [],
      partial: null,
      tooLong: [],
    });
    const bodyOnly = await draftAnnouncementTranslation({ ...EN, locale: "es", fields: ["body"] });
    expect(bodyOnly).toMatchObject({ error: null, locale: "es", body: `[es] ${EN.body}` });
    expect(bodyOnly).not.toHaveProperty("title");
    expect(callTranslationModelDetailed).not.toHaveBeenCalledWith(EN.title, "es", expect.anything());
    expect(announcementCreate).not.toHaveBeenCalled();
    expect(announcementUpdate).not.toHaveBeenCalled();
  });

  it("splits a 4000-character body into chunks, translates them with their own timeouts and reassembles in order", async () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: ${"word ".repeat(17)}end.`);
    const body = paragraphs.join("\n\n").slice(0, 4000).trim();
    const result = await draftAnnouncementTranslation({ title: EN.title, body, locale: "hi", fields: ["body"] });
    const calls = callTranslationModelDetailed.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const [text, locale, opts] of calls) {
      expect((text as string).length).toBeLessThanOrEqual(900);
      expect(locale).toBe("hi");
      expect((opts as { timeoutMs: number }).timeoutMs).toBeLessThanOrEqual(15_000);
    }
    const expected = calls.map(([text]) => `[hi] ${text}`).join("\n\n");
    expect(result).toMatchObject({ error: null, body: expected, partial: null, failed: [] });
    // Rate limits: one per-admin unit for the language, one global unit per model call.
    expect(checkRateLimit).toHaveBeenCalledWith("announcementDraft", "admin1");
    expect(checkRateLimit).toHaveBeenCalledWith("translateGlobal", "all", { rate: calls.length });
  });

  it("returns a flagged partial draft when some chunks can't be done, with the rest marked as English", async () => {
    const body = `First paragraph here, long enough.\n\n${"Second paragraph. ".repeat(60).trim()}`;
    callTranslationModelDetailed.mockImplementation(async (text: string, locale: string) =>
      text.startsWith("First") ? { ok: true, sourceLang: "en", translation: `[${locale}] ${text}` } : { ok: false, retryable: false },
    );
    const result = await draftAnnouncementTranslation({ title: EN.title, body, locale: "ar", fields: ["title", "body"] });
    if (result.error) throw new Error("unexpected error");
    expect(result.partial).toEqual({ done: 1, total: expect.any(Number) });
    expect(result.partial!.total).toBeGreaterThan(1);
    expect(result.body).toMatch(/^\[ar\] First paragraph here, long enough\.\n\n\[\[NOT TRANSLATED YET: Second paragraph\./);
    expect(result.failed).toEqual(["title"]);
  });

  it("stops starting calls at the time budget and flags what is left", async () => {
    const start = 1_000_000;
    const now = vi.spyOn(Date, "now");
    let clock = start;
    now.mockImplementation(() => clock);
    callTranslationModelDetailed.mockImplementation(async (text: string) => {
      await Promise.resolve();
      clock = start + 21_000; // the first call took 21s: no time left for any other
      return { ok: true, sourceLang: "en", translation: `[sw] ${text}` };
    });
    // Seven ~500-char paragraphs: seven chunks (two don't fit in 900), more than the 5 that run at once.
    const body = Array.from({ length: 7 }, (_, i) => `Paragraph ${i}. ${"Some words here. ".repeat(29)}`.trim()).join("\n\n");
    const result = await draftAnnouncementTranslation({ title: EN.title, body, locale: "sw", fields: ["body"] });
    now.mockRestore();
    // The first five started at once (concurrency 5); nothing was started after the clock moved.
    if (result.error) throw new Error("unexpected error");
    expect(callTranslationModelDetailed).toHaveBeenCalledTimes(5);
    expect(result.partial).toEqual({ done: 5, total: 7 });
    expect(result.body).toContain(ANNOUNCEMENT_UNTRANSLATED_OPEN);
  });

  it("retries a transient failure once and charges the retry to the global ceiling", async () => {
    callTranslationModelDetailed
      .mockResolvedValueOnce({ ok: false, retryable: true })
      .mockImplementation(async (text: string) => ({ ok: true, sourceLang: "en", translation: `[it] ${text}` }));
    const result = await draftAnnouncementTranslation({ ...EN, locale: "it", fields: ["title"] });
    expect(result).toMatchObject({ error: null, title: `[it] ${EN.title}`, failed: [] });
    expect(callTranslationModelDetailed).toHaveBeenCalledTimes(2);
    expect(checkRateLimit).toHaveBeenCalledWith("translateGlobal", "all");
  });

  it("is rate-limited per language call and by the global ceiling", async () => {
    checkRateLimit.mockResolvedValueOnce(false);
    expect(await draftAnnouncementTranslation(request)).toEqual({ error: "rate_limited" });
    checkRateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await draftAnnouncementTranslation(request)).toEqual({ error: "rate_limited" });
    expect(callTranslationModelDetailed).not.toHaveBeenCalled();
  });

  it("fails gracefully: not configured, invalid input, a failed language, an over-long draft", async () => {
    isTranslationConfigured.mockReturnValueOnce(false);
    expect(await draftAnnouncementTranslation(request)).toEqual({ error: "unavailable" });
    expect(await draftAnnouncementTranslation({ ...request, locale: "en" })).toEqual({ error: "invalid" });
    expect(await draftAnnouncementTranslation({ ...request, fields: [] })).toEqual({ error: "invalid" });

    callTranslationModelDetailed.mockResolvedValue({ ok: false, retryable: false });
    expect(await draftAnnouncementTranslation(request)).toEqual({
      error: null,
      locale: "de",
      failed: ["title", "body"],
      partial: null,
      tooLong: [],
    });

    callTranslationModelDetailed.mockResolvedValue({ ok: true, sourceLang: "en", translation: "x".repeat(5000) });
    const long = await draftAnnouncementTranslation(request);
    expect(long).toMatchObject({ error: null, tooLong: ["title", "body"], failed: [] });
  });
});
