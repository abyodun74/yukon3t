import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// translateForViewer against a mocked database, limiter and OpenAI: authorization, the shared cache, the limits.
const postFindMany = vi.fn();
const commentFindMany = vi.fn();
const messageFindMany = vi.fn();
const memberFindMany = vi.fn();
const translationFindMany = vi.fn();
const translationCreateMany = vi.fn();
const translationDeleteMany = vi.fn();
const checkRateLimit = vi.fn();
const isHiddenUnlocked = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findMany: (...a: unknown[]) => postFindMany(...a) },
    comment: { findMany: (...a: unknown[]) => commentFindMany(...a) },
    message: { findMany: (...a: unknown[]) => messageFindMany(...a) },
    conversationMember: { findMany: (...a: unknown[]) => memberFindMany(...a) },
    contentTranslation: {
      findMany: (...a: unknown[]) => translationFindMany(...a),
      createMany: (...a: unknown[]) => translationCreateMany(...a),
      deleteMany: (...a: unknown[]) => translationDeleteMany(...a),
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/post-visibility", () => ({ getVisiblePostsWhere: async () => ({ visible: true }) }));
vi.mock("@/lib/blocks", () => ({ getBlockedEitherWayIds: async () => new Set<string>() }));
vi.mock("@/lib/hidden-chats", () => ({ isHiddenUnlocked: (...a: unknown[]) => isHiddenUnlocked(...a) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));

import {
  DEFAULT_TRANSLATION_MODEL,
  translateForViewer,
  translationContentHash,
  translationModel,
} from "./translation-server";

const fetchMock = vi.fn();

function modelAnswer(source: string, translation: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ source_language: source, translation }) } }],
    }),
  };
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("TRANSLATION_MODEL", "");
  vi.stubGlobal("fetch", fetchMock);
  for (const fn of [postFindMany, commentFindMany, messageFindMany, memberFindMany, translationFindMany]) {
    fn.mockReset().mockResolvedValue([]);
  }
  translationCreateMany.mockReset().mockResolvedValue({ count: 1 });
  translationDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  checkRateLimit.mockReset().mockResolvedValue(true);
  isHiddenUnlocked.mockReset().mockResolvedValue(false);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("translationContentHash", () => {
  it("is stable for the same text and changes with any edit", () => {
    expect(translationContentHash("Hola")).toBe(translationContentHash("Hola"));
    expect(translationContentHash("Hola")).not.toBe(translationContentHash("Hola."));
    expect(translationContentHash("Hola")).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("translationModel", () => {
  it("defaults, and can be overridden with TRANSLATION_MODEL", () => {
    expect(translationModel()).toBe(DEFAULT_TRANSLATION_MODEL);
    vi.stubEnv("TRANSLATION_MODEL", "gpt-5-nano");
    expect(translationModel()).toBe("gpt-5-nano");
  });
});

describe("translateForViewer", () => {
  it("is off without an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const results = await translateForViewer({ viewerId: "v", items: [{ kind: "post", id: "p1" }], target: "en" });
    expect(results).toEqual([{ status: "unavailable" }]);
    expect(postFindMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 'unavailable' for anything the viewer can't see, without calling the model", async () => {
    const results = await translateForViewer({
      viewerId: "v",
      items: [
        { kind: "post", id: "hidden-post" },
        { kind: "message", id: "not-my-chat" },
      ],
      target: "en",
    });
    expect(results).toEqual([{ status: "unavailable" }, { status: "unavailable" }]);
    expect(fetchMock).not.toHaveBeenCalled();
    // The post query carries the viewer's visibility rules.
    expect(JSON.stringify(postFindMany.mock.calls[0][0].where)).toContain('"visible":true');
  });

  it("translates a cache miss, stores it for everyone and sends the text only as JSON data", async () => {
    postFindMany.mockResolvedValue([{ id: "p1", content: "Hola amigos, mira esto @ana https://x.com/a" }]);
    fetchMock.mockResolvedValue(modelAnswer("es", "Hi friends, look at this ⟦0⟧ ⟦1⟧"));

    const results = await translateForViewer({ viewerId: "v", items: [{ kind: "post", id: "p1" }], target: "en" });

    expect(results).toEqual([
      { status: "translated", text: "Hi friends, look at this @ana https://x.com/a", sourceLang: "es" },
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe(DEFAULT_TRANSLATION_MODEL);
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.response_format.type).toBe("json_schema");
    // Links and mentions never reach the model.
    expect(JSON.parse(body.messages[1].content)).toEqual({ target_language: "English", text: "Hola amigos, mira esto ⟦0⟧ ⟦1⟧" });
    expect(translationCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          postId: "p1",
          targetLang: "en",
          sourceLang: "es",
          translatedText: "Hi friends, look at this @ana https://x.com/a",
          contentHash: translationContentHash("Hola amigos, mira esto @ana https://x.com/a"),
        }),
      ],
      skipDuplicates: true,
    });
    // Any older version's translation into English is dropped.
    expect(translationDeleteMany.mock.calls[0][0].where).toMatchObject({ postId: "p1", targetLang: "en" });
    expect(checkRateLimit).toHaveBeenCalledWith("translateModelCall", "v");
    expect(checkRateLimit).toHaveBeenCalledWith("translateGlobal", "all");
  });

  it("serves a cached translation of the current text without a model call or a limit", async () => {
    const text = "Bonjour tout le monde";
    commentFindMany.mockResolvedValue([{ id: "k1", content: text }]);
    translationFindMany.mockResolvedValue([
      { commentId: "k1", postId: null, messageId: null, contentHash: translationContentHash(text), sourceLang: "fr", translatedText: "Hello everyone" },
    ]);
    const results = await translateForViewer({ viewerId: "v", items: [{ kind: "comment", id: "k1" }], target: "en" });
    expect(results).toEqual([{ status: "translated", text: "Hello everyone", sourceLang: "fr" }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("never serves a cached translation of an older version of the text", async () => {
    commentFindMany.mockResolvedValue([{ id: "k1", content: "Bonjour à tous (edited)" }]);
    translationFindMany.mockResolvedValue([
      { commentId: "k1", postId: null, messageId: null, contentHash: translationContentHash("Bonjour à tous"), sourceLang: "fr", translatedText: "Hello all" },
    ]);
    fetchMock.mockResolvedValue(modelAnswer("fr", "Hello everyone (edited)"));
    const results = await translateForViewer({ viewerId: "v", items: [{ kind: "comment", id: "k1" }], target: "en" });
    expect(results).toEqual([{ status: "translated", text: "Hello everyone (edited)", sourceLang: "fr" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches 'already in your language' as a null translation", async () => {
    postFindMany.mockResolvedValue([{ id: "p1", content: "Great game tonight" }]);
    fetchMock.mockResolvedValue(modelAnswer("en", "Great game tonight"));
    const results = await translateForViewer({ viewerId: "v", items: [{ kind: "post", id: "p1" }], target: "en" });
    expect(results).toEqual([{ status: "same_language" }]);
    expect(translationCreateMany.mock.calls[0][0].data[0]).toMatchObject({ translatedText: null, sourceLang: "en" });
  });

  it("refuses over either model-call limit without calling the model", async () => {
    postFindMany.mockResolvedValue([{ id: "p1", content: "Hola amigos, ¿qué tal?" }]);
    checkRateLimit.mockImplementation(async (name: string) => name !== "translateGlobal");
    const results = await translateForViewer({ viewerId: "v", items: [{ kind: "post", id: "p1" }], target: "en" });
    expect(results).toEqual([{ status: "rate_limited" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips text that isn't worth translating, and secret-chat ciphertext", async () => {
    messageFindMany.mockResolvedValue([
      { id: "m1", content: "😂😂", conversationId: "c" },
      { id: "m2", content: "e2ee:v1:abcdefghijklmnopqrstuvwxyz", conversationId: "c" },
    ]);
    memberFindMany.mockResolvedValue([{ conversationId: "c", hiddenAt: null }]);
    const results = await translateForViewer({
      viewerId: "v",
      items: [
        { kind: "message", id: "m1" },
        { kind: "message", id: "m2" },
      ],
      target: "en",
    });
    expect(results).toEqual([{ status: "not_translatable" }, { status: "not_translatable" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a message in a hidden chat that isn't unlocked", async () => {
    messageFindMany.mockResolvedValue([{ id: "m1", content: "Hola amigos, ¿qué tal?", conversationId: "c" }]);
    memberFindMany.mockResolvedValue([{ conversationId: "c", hiddenAt: new Date() }]);
    const results = await translateForViewer({ viewerId: "v", items: [{ kind: "message", id: "m1" }], target: "en" });
    expect(results).toEqual([{ status: "unavailable" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 'unavailable' when the model fails or answers in the wrong shape", async () => {
    postFindMany.mockResolvedValue([
      { id: "p1", content: "Hola amigos, ¿qué tal?" },
      { id: "p2", content: "Bonjour tout le monde" },
    ]);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "Sure! Here you go" } }] }) });
    const results = await translateForViewer({
      viewerId: "v",
      items: [
        { kind: "post", id: "p1" },
        { kind: "post", id: "p2" },
      ],
      target: "en",
    });
    expect(results).toEqual([{ status: "unavailable" }, { status: "unavailable" }]);
    expect(translationCreateMany).not.toHaveBeenCalled();
  });

  it("asks the model once for an item requested twice in the same batch", async () => {
    postFindMany.mockResolvedValue([{ id: "p1", content: "Hola amigos, ¿qué tal?" }]);
    fetchMock.mockResolvedValue(modelAnswer("es", "Hi friends, how are you?"));
    const results = await translateForViewer({
      viewerId: "v",
      items: [
        { kind: "post", id: "p1" },
        { kind: "post", id: "p1" },
      ],
      target: "en",
    });
    expect(results[0]).toEqual(results[1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
