import { beforeEach, describe, expect, it, vi } from "vitest";

// createAnnouncement (with per-language versions) and draftAnnouncementTranslations: admin-only, validated, and the
// draft action only ever returns text for what was asked (it never writes anything).
const { AuthError } = vi.hoisted(() => ({ AuthError: class AuthError extends Error {} }));

const requireAdmin = vi.fn();
const announcementCreate = vi.fn();
const broadcastFcmAnnouncement = vi.fn();
const broadcastPushAnnouncement = vi.fn();
const deleteOwnedUploads = vi.fn();
const checkRateLimit = vi.fn();
const callTranslationModel = vi.fn();
const isTranslationConfigured = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  AuthError,
  requireAdmin: () => requireAdmin(),
  requireUser: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { announcement: { create: (...a: unknown[]) => announcementCreate(...a) } },
}));
vi.mock("@/lib/fcm", () => ({ broadcastFcmAnnouncement: (...a: unknown[]) => broadcastFcmAnnouncement(...a) }));
vi.mock("@/lib/push", () => ({ broadcastPushAnnouncement: (...a: unknown[]) => broadcastPushAnnouncement(...a) }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: {},
  verifyUploadedSize: vi.fn(),
  deleteObject: vi.fn(),
  keyFromPublicUrl: vi.fn(),
}));
vi.mock("@/lib/owned-uploads", () => ({ deleteOwnedUploads: (...a: unknown[]) => deleteOwnedUploads(...a) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/translation-server", () => ({
  callTranslationModel: (...a: unknown[]) => callTranslationModel(...a),
  isTranslationConfigured: () => isTranslationConfigured(),
}));

import { createAnnouncement } from "./announcements";
import { draftAnnouncementTranslations } from "./announcement-drafts";

const ADMIN = { id: "admin1", isAdmin: true };
const EN = { title: "New: polls", body: "Add a poll to any post now." };
const ES = { locale: "es", title: "Nuevo: encuestas", body: "Añade una encuesta a cualquier publicación." };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  announcementCreate.mockResolvedValue({ id: "a1" });
  checkRateLimit.mockResolvedValue(true);
  isTranslationConfigured.mockReturnValue(true);
  callTranslationModel.mockImplementation(async (text: string, locale: string) => ({
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

describe("draftAnnouncementTranslations", () => {
  const request = {
    ...EN,
    targets: [
      { locale: "es", fields: ["body"] },
      { locale: "de", fields: ["title", "body"] },
    ],
  };

  it("rejects a non-admin without a model call", async () => {
    requireAdmin.mockRejectedValue(new AuthError("Admin access required."));
    await expect(draftAnnouncementTranslations(request)).rejects.toThrow(AuthError);
    expect(callTranslationModel).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("drafts only the halves asked for (never a half the admin typed) and writes nothing", async () => {
    const result = await draftAnnouncementTranslations(request);
    expect(result).toEqual({
      error: null,
      drafts: [
        { locale: "es", body: `[es] ${EN.body}` },
        { locale: "de", title: `[de] ${EN.title}`, body: `[de] ${EN.body}` },
      ],
      failed: [],
    });
    expect(callTranslationModel).toHaveBeenCalledTimes(3);
    expect(callTranslationModel).not.toHaveBeenCalledWith(EN.title, "es");
    expect(announcementCreate).not.toHaveBeenCalled();
  });

  it("is rate-limited per admin and against the global translation ceiling by call count", async () => {
    await draftAnnouncementTranslations(request);
    expect(checkRateLimit).toHaveBeenCalledWith("announcementDraft", "admin1");
    expect(checkRateLimit).toHaveBeenCalledWith("translateGlobal", "all", { rate: 3 });

    checkRateLimit.mockResolvedValueOnce(false);
    expect(await draftAnnouncementTranslations(request)).toEqual({ error: "rate_limited" });
  });

  it("fails gracefully: not configured, invalid input, a failed or over-long language", async () => {
    isTranslationConfigured.mockReturnValueOnce(false);
    expect(await draftAnnouncementTranslations(request)).toEqual({ error: "unavailable" });
    expect(await draftAnnouncementTranslations({ ...request, targets: [{ locale: "en", fields: ["title"] }] })).toEqual({
      error: "invalid",
    });

    callTranslationModel.mockImplementation(async (text: string, locale: string) =>
      locale === "de" ? null : { sourceLang: "en", translation: "x".repeat(5000) },
    );
    expect(await draftAnnouncementTranslations(request)).toEqual({ error: null, drafts: [], failed: ["es", "de"] });
  });
});
