import { beforeEach, describe, expect, it, vi } from "vitest";

// sendMessage's clientRequestId (Message.clientRequestId, unique per sender): the chat's auto-sent voice and video
// recordings reuse one key for every attempt, so a retry after a lost answer or a double fire never sends twice.

const ME = "cme00000000001";
const BO = "cbo00000000001";
const CONV = "cconv000000001";
const OTHER_CONV = "cconv000000002";
const MSG = "cmsg0000000001";
const KEY = "3f1c2d9e-8a7b-4c6d-9e0f-123456789abc";
const AUDIO = "https://media.example/u/voice-1.webm";
const AUDIO_AGAIN = "https://media.example/u/voice-2.webm";

const user = { id: ME, name: "Me", isAdmin: false };
const messageCreate = vi.fn();
const messageFindUnique = vi.fn();
const deleteOwnedUploads = vi.fn();
const afterMessageSent = vi.fn();

class UniqueError extends Error {}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({
  moderateText: vi.fn(),
  moderateMedia: vi.fn(),
  moderateImage: vi.fn(),
  moderateChatImage: async () => ({ allowed: true, flaggedCategories: [] }),
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
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: (...a: unknown[]) => afterMessageSent(...a) }));
vi.mock("@/lib/non-e2ee-message", () => ({ createNonE2eeMessage: vi.fn() }));
vi.mock("@/lib/prisma-errors", () => ({ isUniqueConstraintError: (err: unknown) => err instanceof UniqueError }));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async () => false,
  getBlockedEitherWayIds: async () => new Set<string>(),
  isBlockedWithAny: async () => false,
}));
vi.mock("@/lib/hidden-chats", () => ({ isMembershipLocked: async () => false, isConversationLocked: async () => false }));
vi.mock("@/lib/collab-chat-visibility-server", () => ({ collabChatHiddenFor: async () => false }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationMember: { findUnique: async () => ({ hiddenAt: null }) },
    conversation: {
      findUnique: async () => ({
        isGroup: false,
        members: [
          { userId: ME, e2eeEnabledAt: null },
          { userId: BO, e2eeEnabledAt: null },
        ],
      }),
    },
    message: {
      create: (...a: unknown[]) => messageCreate(...a),
      findUnique: (...a: unknown[]) => messageFindUnique(...a),
    },
  },
}));

const { sendMessage } = await import("./messages");

function voiceNote(fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("conversationId", CONV);
  fd.set("content", "");
  fd.set("mediaType", "AUDIO");
  fd.set("mediaUrl", AUDIO);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const stored = (conversationId = CONV) => ({
  id: MSG,
  conversationId,
  senderId: ME,
  mediaType: "AUDIO",
  mediaUrl: AUDIO,
  mediaThumbnailUrl: null,
  clientRequestId: KEY,
});

beforeEach(() => {
  vi.clearAllMocks();
  messageCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: MSG, ...data }));
  messageFindUnique.mockResolvedValue(null);
});

describe("sendMessage with a clientRequestId", () => {
  it("stores the key with a new message and notifies once", async () => {
    const result = await sendMessage(voiceNote({ clientRequestId: KEY }));
    expect(result.error).toBeNull();
    expect(messageFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { senderId_clientRequestId: { senderId: ME, clientRequestId: KEY } } }),
    );
    expect(messageCreate.mock.calls[0][0].data.clientRequestId).toBe(KEY);
    expect(afterMessageSent).toHaveBeenCalledTimes(1);
  });

  it("answers a repeat with the message already stored: nothing created, notified or deleted", async () => {
    messageFindUnique.mockResolvedValue(stored());
    const result = await sendMessage(voiceNote({ clientRequestId: KEY }));
    expect(result).toEqual({ error: null, message: stored() });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(afterMessageSent).not.toHaveBeenCalled();
    expect(deleteOwnedUploads).not.toHaveBeenCalled();
  });

  it("deletes a repeat's own fresh upload, never the one the stored message uses", async () => {
    messageFindUnique.mockResolvedValue(stored());
    await sendMessage(voiceNote({ clientRequestId: KEY, mediaUrl: AUDIO_AGAIN }));
    expect(deleteOwnedUploads).toHaveBeenCalledWith([AUDIO_AGAIN], ME);
  });

  it("refuses a key already used in another chat", async () => {
    messageFindUnique.mockResolvedValue(stored(OTHER_CONV));
    const result = await sendMessage(voiceNote({ clientRequestId: KEY }));
    expect(result.error).toBe("invalid");
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("resolves a concurrent double send to the one message that won", async () => {
    messageCreate.mockRejectedValue(new UniqueError("unique"));
    messageFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(stored());
    const result = await sendMessage(voiceNote({ clientRequestId: KEY }));
    expect(result).toEqual({ error: null, message: stored() });
    expect(afterMessageSent).not.toHaveBeenCalled();
  });

  it("rethrows any other database error", async () => {
    messageCreate.mockRejectedValue(new Error("pool timeout"));
    await expect(sendMessage(voiceNote({ clientRequestId: KEY }))).rejects.toThrow("pool timeout");
  });

  it("ignores a malformed key, and sends without one as before", async () => {
    await sendMessage(voiceNote({ clientRequestId: "short" }));
    await sendMessage(voiceNote());
    expect(messageFindUnique).not.toHaveBeenCalled();
    expect(messageCreate.mock.calls[0][0].data.clientRequestId).toBeNull();
    expect(messageCreate.mock.calls[1][0].data.clientRequestId).toBeNull();
  });
});
