import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The category allowlists (owner decision 2026-11-22): publish-time checks act only on MODERATION_CATEGORIES, chat
// photos/frames only on CHAT_MEDIA_MODERATION_CATEGORIES. OpenAI's own "flagged" is ignored.

vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));

const {
  CHAT_MEDIA_MODERATION_CATEGORIES,
  MODERATION_CATEGORIES,
  flaggedModerationCategories,
  moderateChatImage,
  moderateImage,
  moderateText,
} = await import("@/lib/moderation");

function openAiAnswer(categories: Record<string, boolean>) {
  return new Response(
    JSON.stringify({ results: [{ flagged: Object.values(categories).some(Boolean), categories }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the allowlists", () => {
  it("publish-time categories are exactly the kept list", () => {
    expect([...MODERATION_CATEGORIES]).toEqual([
      "sexual",
      "sexual/minors",
      "violence",
      "violence/graphic",
      "harassment/threatening",
      "hate",
      "hate/threatening",
    ]);
    for (const dropped of ["harassment", "self-harm", "self-harm/intent", "self-harm/instructions", "illicit", "illicit/violent"]) {
      expect(MODERATION_CATEGORIES.has(dropped), dropped).toBe(false);
    }
  });

  it("chat media categories are only sexual content involving minors and explicit sexual content", () => {
    expect([...CHAT_MEDIA_MODERATION_CATEGORIES].sort()).toEqual(["sexual", "sexual/minors"]);
  });

  it("flaggedModerationCategories reads only allowlisted true values, and copes with junk", () => {
    expect(flaggedModerationCategories({ sexual: true, harassment: true, "self-harm": true }, MODERATION_CATEGORIES)).toEqual([
      "sexual",
    ]);
    expect(flaggedModerationCategories({ hate: "true", violence: 1 }, MODERATION_CATEGORIES)).toEqual([]);
    expect(flaggedModerationCategories(null, MODERATION_CATEGORIES)).toEqual([]);
    expect(flaggedModerationCategories("x", MODERATION_CATEGORIES)).toEqual([]);
  });
});

describe("moderateText / moderateImage (publish-time)", () => {
  it("ignores categories outside the list even when OpenAI says flagged", async () => {
    fetchMock.mockResolvedValue(
      openAiAnswer({ harassment: true, "self-harm": true, "self-harm/intent": true, illicit: true, "illicit/violent": true }),
    );
    expect(await moderateText("text")).toEqual({ allowed: true, flaggedCategories: [] });
  });

  it("flags each kept category", async () => {
    for (const category of MODERATION_CATEGORIES) {
      fetchMock.mockResolvedValueOnce(openAiAnswer({ [category]: true, harassment: true }));
      expect(await moderateImage("https://media.example/p.jpg"), category).toEqual({
        allowed: false,
        flaggedCategories: [category],
      });
    }
  });

  it("an API failure still fails open with the sentinel", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    expect(await moderateText("text")).toEqual({
      allowed: true,
      flaggedCategories: ["moderation_api_error"],
      apiError: "unavailable",
    });
  });
});

describe("moderateChatImage", () => {
  it("refuses only sexual content involving minors and explicit sexual content", async () => {
    fetchMock.mockResolvedValueOnce(openAiAnswer({ "sexual/minors": true, sexual: true }));
    expect(await moderateChatImage("https://media.example/c.jpg")).toEqual({
      allowed: false,
      flaggedCategories: ["sexual", "sexual/minors"],
    });
    fetchMock.mockResolvedValueOnce(openAiAnswer({ sexual: true }));
    expect((await moderateChatImage("https://media.example/c.jpg")).allowed).toBe(false);
  });

  it("lets every other category through in chats (violence, hate, harassment, self-harm, illicit)", async () => {
    fetchMock.mockResolvedValue(
      openAiAnswer({
        violence: true,
        "violence/graphic": true,
        hate: true,
        "hate/threatening": true,
        harassment: true,
        "harassment/threatening": true,
        "self-harm": true,
        illicit: true,
      }),
    );
    expect(await moderateChatImage("https://media.example/c.jpg")).toEqual({ allowed: true, flaggedCategories: [] });
  });

  it("sends the image, not text, to OpenAI", async () => {
    fetchMock.mockResolvedValue(openAiAnswer({}));
    await moderateChatImage("https://media.example/c.jpg");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.input).toEqual([{ type: "image_url", image_url: { url: "https://media.example/c.jpg" } }]);
  });
});
