import { beforeEach, describe, expect, it, vi } from "vitest";

// Chat moderation (owner decision 2026-11-22) against a mocked database: chat TEXT is never sent to the automatic
// scanner (messages, captions, edits, corrections), while a chat photo or a chat video's still frame still goes
// through the chat media check (moderateChatImage: sexual content involving minors and explicit sexual content only)
// and is refused, its upload deleted, when that flags it. Group names keep their text screening.

const ME = "cme00000000001";
const BO = "cbo00000000001";
const CONV = "cconv000000001";
const MSG = "cmsg0000000001";

const user = { id: ME, name: "Me", isAdmin: false };
const moderateText = vi.fn();
const moderateMedia = vi.fn();
const moderateImage = vi.fn();
const moderateChatImage = vi.fn();
const messageCreate = vi.fn();
const messageUpdate = vi.fn();
const messageFindUnique = vi.fn();
const correctionUpsert = vi.fn();
const deleteOwnedUploads = vi.fn();
const conversationUpdate = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({
  moderateText: (t: string) => moderateText(t),
  moderateMedia: (a: unknown) => moderateMedia(a),
  moderateImage: (u: string) => moderateImage(u),
  moderateChatImage: (u: string) => moderateChatImage(u),
}));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: { "message-image": 1, "message-video": 1, "message-audio": 1 },
  verifyUploadedSize: async () => true,
  keyFromPublicUrl: (url: string) => url.split("/").pop(),
}));
vi.mock("@/lib/owned-uploads", () => ({ deleteOwnedUploads: (...a: unknown[]) => deleteOwnedUploads(...a) }));
vi.mock("@/lib/video-thumbnail-check", () => ({ checkVideoThumbnail: async () => "ok" }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateConversationEmbedding: vi.fn() }));
vi.mock("@/lib/translation-server", () => ({ deleteTranslationsOf: vi.fn() }));
vi.mock("@/lib/view-once-media", () => ({ destroyViewOnceMedia: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn(), publishEvents: vi.fn(), notifyBadgeChange: vi.fn() }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: vi.fn() }));
vi.mock("@/lib/non-e2ee-message", () => ({ createNonE2eeMessage: vi.fn() }));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async () => false,
  getBlockedEitherWayIds: async () => new Set<string>(),
  isBlockedWithAny: async () => false,
}));
vi.mock("@/lib/hidden-chats", () => ({ isMembershipLocked: async () => false, isConversationLocked: async () => false }));
vi.mock("@/lib/collab-chat-visibility-server", () => ({ collabChatHiddenFor: async () => false }));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    conversationMember: { findUnique: async () => ({ hiddenAt: null }) },
    conversation: {
      findUnique: async () => ({
        isGroup: true,
        createdById: ME,
        members: [
          { userId: ME, e2eeEnabledAt: null },
          { userId: BO, e2eeEnabledAt: null },
        ],
      }),
      update: (...a: unknown[]) => conversationUpdate(...a),
    },
    message: {
      create: (...a: unknown[]) => messageCreate(...a),
      update: (...a: unknown[]) => messageUpdate(...a),
      findUnique: (...a: unknown[]) => messageFindUnique(...a),
    },
    messageCorrection: { upsert: (...a: unknown[]) => correctionUpsert(...a), findMany: async () => [] },
    $transaction: async (arg: unknown): Promise<unknown> =>
      typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[]),
  };
  return { prisma };
});

const { sendMessage, editMessage, suggestCorrection, renameGroupChat } = await import("./messages");

const PHOTO = "https://media.example/u/photo.jpg";
const VIDEO = "https://media.example/u/clip.mp4";
const FRAME = "https://media.example/u/frame.jpg";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("conversationId", CONV);
  fd.set("content", "");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The scanner would flag every text it saw: nothing below may consult it for chat text.
  moderateText.mockResolvedValue({ allowed: false, flaggedCategories: ["harassment"] });
  moderateMedia.mockResolvedValue({ allowed: false, flaggedCategories: ["harassment"] });
  moderateImage.mockResolvedValue({ allowed: false, flaggedCategories: ["violence"] });
  moderateChatImage.mockResolvedValue({ allowed: true, flaggedCategories: [] });
  messageCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: MSG, ...data }));
  messageUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: MSG, ...data }));
  messageFindUnique.mockResolvedValue({
    id: MSG,
    conversationId: CONV,
    senderId: BO,
    content: "hello",
    deletedForEveryoneAt: null,
    viewOnce: false,
    giftSendId: null,
    checklist: null,
  });
  correctionUpsert.mockResolvedValue({});
});

describe("sendMessage: chat text is not scanned", () => {
  it("stores a text message as sent, without calling the text scanner", async () => {
    const result = await sendMessage(form({ content: "you absolute muppet, see you at 8" }));
    expect(result.error).toBeNull();
    expect(moderateText).not.toHaveBeenCalled();
    expect(moderateMedia).not.toHaveBeenCalled();
    // Left to the column default (PUBLISHED); never written as FLAGGED from a text scan.
    expect(messageCreate.mock.calls[0][0].data.moderationStatus).toBeUndefined();
  });

  it("does not scan a voice note's caption either", async () => {
    await sendMessage(form({ content: "listen to this", mediaType: "AUDIO", mediaUrl: "https://media.example/u/a.webm" }));
    expect(moderateText).not.toHaveBeenCalled();
    expect(moderateChatImage).not.toHaveBeenCalled();
    expect(messageCreate).toHaveBeenCalled();
  });
});

describe("sendMessage: the chat media check still runs, with the narrowed categories", () => {
  it("checks a photo itself with moderateChatImage, and not its caption", async () => {
    const result = await sendMessage(form({ content: "caption", mediaType: "IMAGE", mediaUrl: PHOTO }));
    expect(result.error).toBeNull();
    expect(moderateChatImage).toHaveBeenCalledWith(PHOTO);
    expect(moderateImage).not.toHaveBeenCalled();
    expect(moderateText).not.toHaveBeenCalled();
  });

  it("checks a video by its still frame", async () => {
    await sendMessage(form({ mediaType: "VIDEO", mediaUrl: VIDEO, mediaThumbnailUrl: FRAME }));
    expect(moderateChatImage).toHaveBeenCalledWith(FRAME);
    expect(messageCreate).toHaveBeenCalled();
  });

  it("refuses a flagged photo and deletes the upload", async () => {
    moderateChatImage.mockResolvedValue({ allowed: false, flaggedCategories: ["sexual/minors"] });
    const result = await sendMessage(form({ mediaType: "IMAGE", mediaUrl: PHOTO }));
    expect(result).toEqual({ error: "moderation", categories: ["sexual/minors"] });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(deleteOwnedUploads).toHaveBeenCalledWith([PHOTO], ME);
  });
});

describe("edits and corrections are not scanned", () => {
  it("editMessage keeps the message's moderation status and never calls the scanner", async () => {
    messageFindUnique.mockResolvedValue({
      id: MSG,
      conversationId: CONV,
      senderId: ME,
      content: "old",
      deletedForEveryoneAt: null,
      viewOnce: false,
      giftSendId: null,
      checklist: null,
    });
    const fd = new FormData();
    fd.set("content", "new text with a swear word in it");
    const result = await editMessage(MSG, fd);
    expect(result.error).toBeNull();
    expect(moderateText).not.toHaveBeenCalled();
    expect(messageUpdate.mock.calls[0][0].data).toEqual({ content: "new text with a swear word in it", editedAt: expect.any(Date) });
  });

  it("suggestCorrection stores the correction without calling the scanner", async () => {
    const fd = new FormData();
    fd.set("correctedText", "hell yes");
    const result = await suggestCorrection(MSG, fd);
    expect(result.error).toBeNull();
    expect(moderateText).not.toHaveBeenCalled();
    expect(correctionUpsert).toHaveBeenCalled();
  });
});

describe("group chat names keep their text screening", () => {
  it("renameGroupChat refuses a name the scanner flags", async () => {
    const fd = new FormData();
    fd.set("name", "Some name");
    expect(await renameGroupChat(CONV, fd)).toEqual({ error: "moderation" });
    expect(moderateText).toHaveBeenCalledWith("Some name");
    expect(conversationUpdate).not.toHaveBeenCalled();
  });
});
