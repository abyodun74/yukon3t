import { beforeEach, describe, expect, it, vi } from "vitest";

// sendToConversations / shareMuseToConversations (actions/share-to-chats.ts) and shareStoryToConversations
// (actions/stories.ts) against a mocked database: every destination is checked on its own, results are counts only.

const ME = "cme00000000001";
const CY = "ccy00000000001";
const DD = "cdd00000000001";
const AUTHOR = "cau00000000001";
const D1 = "cdst0000000001";
const D2 = "cdst0000000002";
const D3 = "cdst0000000003";
const D4 = "cdst0000000004";
const D5 = "cdst0000000005";
const D6 = "cdst0000000006";
const GROUP = "cgrp0000000001";
const SECRET = "csec0000000001";
const HIDDEN = "chid0000000001";
const OTHERS = "coth0000000001"; // a chat the caller isn't in
const MUSE = "cmus0000000001";
const STORY = "csto0000000001";

const user = { id: ME, name: "Me", isAdmin: false };
const limits: Record<string, boolean | boolean[]> = {};
const checkRateLimit = vi.fn(async (name: string) => {
  const v = limits[name];
  if (Array.isArray(v)) return v.length ? v.shift()! : true;
  return v ?? true;
});
const moderateText = vi.fn();
const moderateMedia = vi.fn();
const verifyUploadedSize = vi.fn();
const deleteOwnedObject = vi.fn();
const messageCreate = vi.fn();
const afterMessageSent = vi.fn();
const museShareCreate = vi.fn();
const museUpdate = vi.fn();
const notificationCreate = vi.fn();
let blocked = new Set<string>();
let unlocked = false;
let muse: Record<string, unknown> | null = null;
let story: Record<string, unknown> | null = null;

type Member = { userId: string; e2eeEnabledAt: Date | null; hiddenAt: Date | null; user: { status: string } };
type Conv = { id: string; isGroup: boolean; members: Member[] };
function member(userId: string, over: Partial<Member> = {}): Member {
  return { userId, e2eeEnabledAt: null, hiddenAt: null, user: { status: "ACTIVE" }, ...over };
}
let conversations: Conv[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (name: string) => checkRateLimit(name) }));
vi.mock("@/lib/moderation", () => ({
  moderateText: (t: string) => moderateText(t),
  moderateMedia: (a: unknown) => moderateMedia(a),
}));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: { "message-image": 1, "message-video": 1, "message-audio": 1 },
  STORY_LIFETIME_MS: 86_400_000,
  verifyUploadedSize: (a: unknown) => verifyUploadedSize(a),
  deleteOwnedObject: (...a: unknown[]) => deleteOwnedObject(...a),
  keyFromPublicUrl: (url: string) => url.split("/").pop(),
}));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn(), sendPushToUsers: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUser: vi.fn(), sendFcmActivityToUsers: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: (a: unknown) => afterMessageSent(a) }));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (a: string, b: string) => blocked.has(a === ME ? b : a),
  getBlockedEitherWayIds: async () => new Set(blocked),
}));
vi.mock("@/lib/hidden-chats", () => ({
  isMembershipLocked: async (m: { hiddenAt: Date | null }) => m.hiddenAt !== null && !unlocked,
  getMembersHidingConversation: async () => [],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        conversations.filter((c) => where.id.in.includes(c.id)),
    },
    message: { create: (...a: unknown[]) => messageCreate(...a) },
    muse: {
      findUnique: async () => muse,
      update: (...a: unknown[]) => museUpdate(...a),
    },
    museShare: { create: (...a: unknown[]) => museShareCreate(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    story: { findUnique: async () => story },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  },
}));

import { sendToConversations, shareMuseToConversations } from "@/app/actions/share-to-chats";
import { shareStoryToConversations } from "@/app/actions/stories";

function form(ids: string[], fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const id of ids) fd.append("conversationIds", id);
  for (const [k, v] of Object.entries({ content: "https://yukon3t.com/post/x", ...fields })) fd.set(k, v);
  return fd;
}
const sentTo = () => messageCreate.mock.calls.map((c) => (c[0] as { data: { conversationId: string } }).data.conversationId);

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(limits)) delete limits[k];
  blocked = new Set();
  unlocked = false;
  moderateText.mockResolvedValue({ allowed: true });
  moderateMedia.mockResolvedValue({ allowed: true });
  verifyUploadedSize.mockResolvedValue(true);
  messageCreate.mockResolvedValue({ id: "new" });
  museUpdate.mockResolvedValue({ shareCount: 7 });
  museShareCreate.mockResolvedValue({});
  conversations = [
    { id: D1, isGroup: false, members: [member(ME), member(CY)] },
    { id: D2, isGroup: false, members: [member(ME), member(DD)] },
    ...[D3, D4, D5, D6].map((id, i) => ({ id, isGroup: false, members: [member(ME), member(`cpp0000000000${i}`)] })),
    { id: GROUP, isGroup: true, members: [member(ME), member(CY), member(DD)] },
    {
      id: SECRET,
      isGroup: false,
      members: [member(ME, { e2eeEnabledAt: new Date() }), member("csp00000000001", { e2eeEnabledAt: new Date() })],
    },
    { id: HIDDEN, isGroup: false, members: [member(ME, { hiddenAt: new Date() }), member("chp00000000001")] },
    { id: OTHERS, isGroup: false, members: [member(CY), member(DD)] },
  ];
  muse = {
    authorId: AUTHOR,
    moderationStatus: "PUBLISHED",
    mediaType: "VIDEO",
    videoUrl: "https://media.example/m.mp4",
    videoThumbnailUrl: "https://media.example/m.jpg",
  };
  story = { id: STORY, authorId: AUTHOR, expiresAt: new Date(Date.now() + 60_000) };
});

describe("sendToConversations: input", () => {
  it("refuses no destinations and more than 5", async () => {
    expect(await sendToConversations(form([]))).toEqual({ error: "invalid" });
    expect(await sendToConversations(form([D1, D2, D3, D4, D5, D6]))).toEqual({ error: "invalid" });
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("sends once per chat when the same id is picked twice", async () => {
    expect(await sendToConversations(form([D1, D1, D2, D1]))).toEqual({ error: null, sent: 2, failed: 0 });
    expect(sentTo()).toEqual([D1, D2]);
    expect(afterMessageSent).toHaveBeenCalledTimes(2);
  });

  it("refuses ciphertext-looking text before touching any chat", async () => {
    expect(await sendToConversations(form([D1], { content: "e2ee:v1:abc" }))).toEqual({ error: "invalid" });
    expect(messageCreate).not.toHaveBeenCalled();
  });
});

describe("sendToConversations: each destination on its own", () => {
  it("counts refused chats as failed and sends to the rest (partial success)", async () => {
    blocked = new Set([DD]);
    const result = await sendToConversations(form([D1, D2, OTHERS, "cmissing00001", GROUP]));
    expect(result).toEqual({ error: null, sent: 2, failed: 3 });
    expect(sentTo()).toEqual([D1, GROUP]);
  });

  it("never puts text into a secret chat, but a media-only share may go in", async () => {
    expect(await sendToConversations(form([SECRET]))).toEqual({ error: "unavailable" });
    expect(
      await sendToConversations(
        form([SECRET], { content: "", mediaType: "IMAGE", mediaUrl: "https://media.example/u/k.jpg" }),
      ),
    ).toEqual({ error: null, sent: 1, failed: 0 });
    expect(afterMessageSent).toHaveBeenCalledWith(expect.objectContaining({ conversationId: SECRET, secret: true }));
  });

  it("refuses a hidden chat unless its PIN unlock is live", async () => {
    expect(await sendToConversations(form([HIDDEN]))).toEqual({ error: "unavailable" });
    unlocked = true;
    expect(await sendToConversations(form([HIDDEN]))).toEqual({ error: null, sent: 1, failed: 0 });
  });

  it("refuses a 1:1 whose peer isn't active", async () => {
    conversations[0].members[1].user.status = "SUSPENDED";
    expect(await sendToConversations(form([D1]))).toEqual({ error: "unavailable" });
  });

  it("gives one generic answer whatever the reasons were", async () => {
    blocked = new Set([CY]);
    expect(await sendToConversations(form([D1, SECRET, OTHERS, HIDDEN]))).toEqual({ error: "unavailable" });
  });

  it("notifies each destination like a normal message", async () => {
    await sendToConversations(form([D1, GROUP]));
    expect(afterMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: D1, memberIds: [ME, CY], secret: false, mediaType: "NONE" }),
    );
    expect(afterMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: GROUP, memberIds: [ME, CY, DD] }),
    );
  });
});

describe("sendToConversations: moderation and uploads", () => {
  it("holds flagged text as FLAGGED in every copy, like sendMessage", async () => {
    moderateText.mockResolvedValue({ allowed: false });
    await sendToConversations(form([D1, D2]));
    expect(moderateText).toHaveBeenCalledTimes(1);
    for (const [arg] of messageCreate.mock.calls) {
      expect((arg as { data: { moderationStatus: string } }).data.moderationStatus).toBe("FLAGGED");
    }
  });

  it("refuses flagged media for everyone and deletes the upload", async () => {
    moderateMedia.mockResolvedValue({ allowed: false, flaggedCategories: [] });
    const result = await sendToConversations(
      form([D1, D2], { mediaType: "IMAGE", mediaUrl: "https://media.example/u/k.jpg" }),
    );
    expect(result).toEqual({ error: "moderation" });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(deleteOwnedObject).toHaveBeenCalledWith("k.jpg", ME);
  });

  it("deletes a fresh upload that reached no chat at all, and keeps it when one did", async () => {
    const media = { content: "", mediaType: "IMAGE", mediaUrl: "https://media.example/u/k.jpg" };
    await sendToConversations(form([OTHERS], media));
    expect(deleteOwnedObject).toHaveBeenCalledTimes(1);
    deleteOwnedObject.mockClear();
    await sendToConversations(form([OTHERS, D1], media));
    expect(deleteOwnedObject).not.toHaveBeenCalled();
  });
});

describe("sendToConversations: rate limits", () => {
  it("is limited per action", async () => {
    limits.shareToChats = false;
    expect(await sendToConversations(form([D1]))).toEqual({ error: "rate_limited" });
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("counts every copy against the send limit, failing the rest once it runs out", async () => {
    limits.messageSend = [true, false];
    expect(await sendToConversations(form([D1, D2, GROUP]))).toEqual({ error: null, sent: 1, failed: 2 });
    expect(checkRateLimit.mock.calls.filter(([n]) => n === "messageSend")).toHaveLength(2);
  });

  it("says rate_limited when the send limit stopped everything", async () => {
    limits.messageSend = false;
    expect(await sendToConversations(form([D1, D2]))).toEqual({ error: "rate_limited" });
  });
});

describe("shareMuseToConversations", () => {
  it("sends the video to every allowed chat, a secret chat included, and counts one share", async () => {
    const result = await shareMuseToConversations(MUSE, [D1, SECRET, OTHERS]);
    expect(result).toEqual({ error: null, sent: 2, failed: 1, shareCount: 7 });
    expect(sentTo()).toEqual([D1, SECRET]);
    expect(messageCreate.mock.calls[0][0]).toMatchObject({
      data: { content: "", mediaType: "VIDEO", mediaUrl: "https://media.example/m.mp4" },
    });
    expect(museShareCreate).toHaveBeenCalledTimes(1);
    expect(museUpdate).toHaveBeenCalledTimes(1);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("counts nothing and notifies nobody when no chat took it", async () => {
    expect(await shareMuseToConversations(MUSE, [OTHERS])).toEqual({ error: "unavailable" });
    expect(museShareCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("refuses a missing, unpublished, embedded or blocked author's Muse", async () => {
    muse = null;
    expect(await shareMuseToConversations(MUSE, [D1])).toEqual({ error: "not_found" });
    muse = { authorId: AUTHOR, moderationStatus: "FLAGGED", mediaType: "VIDEO", videoUrl: "x" };
    expect(await shareMuseToConversations(MUSE, [D1])).toEqual({ error: "not_found" });
    muse = { authorId: AUTHOR, moderationStatus: "PUBLISHED", mediaType: "EMBED", videoUrl: null };
    expect(await shareMuseToConversations(MUSE, [D1])).toEqual({ error: "not_found" });
    muse = { authorId: AUTHOR, moderationStatus: "PUBLISHED", mediaType: "VIDEO", videoUrl: "x" };
    blocked = new Set([AUTHOR]);
    expect(await shareMuseToConversations(MUSE, [D1])).toEqual({ error: "not_found" });
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("validates the ids and is rate limited per action", async () => {
    expect(await shareMuseToConversations(MUSE, [])).toEqual({ error: "invalid" });
    expect(await shareMuseToConversations(MUSE, [D1, D2, D3, D4, D5, D6])).toEqual({ error: "invalid" });
    limits.shareToChats = false;
    expect(await shareMuseToConversations(MUSE, [D1])).toEqual({ error: "rate_limited" });
  });
});

describe("shareStoryToConversations", () => {
  it("shares to every allowed chat, de-duplicated, with no push (as before)", async () => {
    blocked = new Set([DD]);
    const result = await shareStoryToConversations(STORY, [D1, D1, D2, HIDDEN, GROUP]);
    expect(result).toEqual({ error: null, sent: 2, failed: 2 });
    expect(sentTo()).toEqual([D1, GROUP]);
    expect(messageCreate.mock.calls[0][0]).toMatchObject({
      data: { content: "Shared a story", storyId: STORY, isForwardedStory: true, senderId: ME },
    });
    expect(afterMessageSent).not.toHaveBeenCalled();
  });

  it("refuses an expired story or a blocked author's", async () => {
    story = { id: STORY, authorId: AUTHOR, expiresAt: new Date(Date.now() - 1) };
    expect(await shareStoryToConversations(STORY, [D1])).toEqual({ error: "not_found" });
    story = { id: STORY, authorId: AUTHOR, expiresAt: new Date(Date.now() + 60_000) };
    blocked = new Set([AUTHOR]);
    expect(await shareStoryToConversations(STORY, [D1])).toEqual({ error: "not_found" });
  });

  it("validates the ids and applies both rate limits", async () => {
    expect(await shareStoryToConversations(STORY, [D1, D2, D3, D4, D5, D6])).toEqual({ error: "invalid" });
    limits.messageSend = [true, false];
    expect(await shareStoryToConversations(STORY, [D1, D2])).toEqual({ error: null, sent: 1, failed: 1 });
    limits.shareToChats = false;
    expect(await shareStoryToConversations(STORY, [D1])).toEqual({ error: "rate_limited" });
  });
});
