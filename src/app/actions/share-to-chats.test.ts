import { beforeEach, describe, expect, it, vi } from "vitest";

// sendToConversations / shareMuseToConversations (actions/share-to-chats.ts), shareStoryToConversations and
// replyToStory (actions/stories.ts) against a mocked database: every destination is checked on its own, results are counts only.

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
const AUTHOR_DM = "cdma0000000001"; // the caller's 1:1 with the story's author

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
// Chats that turned secret after the action read them: only the insert's own re-read (createNonE2eeMessage) sees it.
let secretAtInsert = new Set<string>();

type Member = {
  userId: string;
  e2eeEnabledAt: Date | null;
  hiddenAt: Date | null;
  user: { id: string; name: string; username: string | null; status: string };
};
type Conv = { id: string; isGroup: boolean; members: Member[] };
function member(
  userId: string,
  over: Partial<Omit<Member, "user">> & { user?: Partial<Member["user"]> } = {},
): Member {
  const { user: userOver, ...rest } = over;
  return {
    userId,
    e2eeEnabledAt: null,
    hiddenAt: null,
    ...rest,
    user: { id: userId, name: `Name ${userId}`, username: null, status: "ACTIVE", ...userOver },
  };
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
// replyToStory's lookup of the genuine 1:1 with the author.
vi.mock("@/lib/direct-conversation", () => ({
  findDirectConversationId: async (a: string, b: string) =>
    conversations.find(
      (c) => !c.isGroup && c.members.length === 2 && [a, b].every((id) => c.members.some((m) => m.userId === id)),
    )?.id ?? null,
}));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (a: string, b: string) => blocked.has(a === ME ? b : a),
  getBlockedEitherWayIds: async () => new Set(blocked),
}));
vi.mock("@/lib/hidden-chats", () => ({
  isMembershipLocked: async (m: { hiddenAt: Date | null }) => m.hiddenAt !== null && !unlocked,
  getMembersHidingConversation: async () => [],
}));
vi.mock("@/lib/prisma", () => {
  const prisma = {
    conversation: {
      findUnique: async ({ where }: { where: { id: string } }) => conversations.find((c) => c.id === where.id) ?? null,
      findMany: async ({ where }: { where: { id?: { in: string[] } } }) =>
        where.id
          ? conversations.filter((c) => where.id!.in.includes(c.id))
          : // getShareableConversations: the caller's chats it hasn't hidden.
            conversations.filter((c) => c.members.some((m) => m.userId === ME && m.hiddenAt === null)),
    },
    message: { create: (...a: unknown[]) => messageCreate(...a) },
    muse: {
      findUnique: async () => muse,
      update: (...a: unknown[]) => museUpdate(...a),
    },
    museShare: { create: (...a: unknown[]) => museShareCreate(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    story: { findUnique: async () => story },
    // The story's author, for loadViewableStory's profile rule (src/lib/profile-access.ts): a public, active member.
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        status: "ACTIVE",
        name: "Author",
        isAdmin: false,
        isGuestPreview: false,
        postsVisibility: "PUBLIC",
      }),
    },
    connection: { findFirst: async () => null },
    // createNonE2eeMessage's locked re-read of the destination's members (the only interpolated value is its id).
    $queryRaw: async (_sql: TemplateStringsArray, conversationId: string) => {
      const conv = conversations.find((c) => c.id === conversationId);
      if (!conv) return [];
      const nowSecret = secretAtInsert.has(conversationId);
      return conv.members.map((m) => ({
        isGroup: conv.isGroup,
        e2eeEnabledAt: nowSecret ? new Date() : m.e2eeEnabledAt,
      }));
    },
    $transaction: async (arg: unknown): Promise<unknown> =>
      typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[]),
  };
  return { prisma };
});

import { sendToConversations, shareMuseToConversations } from "@/app/actions/share-to-chats";
import { getShareableConversations, replyToStory, shareStoryToConversations } from "@/app/actions/stories";
import { sendPushToUser, sendPushToUsers } from "@/lib/push";
import { sendFcmActivityToUser, sendFcmActivityToUsers } from "@/lib/fcm";

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
  secretAtInsert = new Set();
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
    { id: AUTHOR_DM, isGroup: false, members: [member(ME), member(AUTHOR)] },
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

  it("never puts anything into a secret chat: a link, text or a media-only share", async () => {
    expect(await sendToConversations(form([SECRET]))).toEqual({ error: "unavailable" });
    expect(
      await sendToConversations(
        form([SECRET], { content: "", mediaType: "IMAGE", mediaUrl: "https://media.example/u/k.jpg" }),
      ),
    ).toEqual({ error: "unavailable" });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(afterMessageSent).not.toHaveBeenCalled();
  });

  it("counts a secret chat as one more generic failure in a partial success", async () => {
    expect(await sendToConversations(form([D1, SECRET, D2]))).toEqual({ error: null, sent: 2, failed: 1 });
    expect(sentTo()).toEqual([D1, D2]);
  });

  it("refuses a chat that became secret after it was read, at the insert itself", async () => {
    secretAtInsert = new Set([D2]);
    expect(await sendToConversations(form([D1, D2]))).toEqual({ error: null, sent: 1, failed: 1 });
    expect(sentTo()).toEqual([D1]);
    expect(afterMessageSent).toHaveBeenCalledTimes(1);
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
  it("sends the video to every allowed chat, never a secret chat, and counts one share", async () => {
    const result = await shareMuseToConversations(MUSE, [D1, SECRET, OTHERS]);
    expect(result).toEqual({ error: null, sent: 1, failed: 2, shareCount: 7 });
    expect(sentTo()).toEqual([D1]);
    expect(messageCreate.mock.calls[0][0]).toMatchObject({
      data: { content: "", mediaType: "VIDEO", mediaUrl: "https://media.example/m.mp4" },
    });
    expect(museShareCreate).toHaveBeenCalledTimes(1);
    expect(museUpdate).toHaveBeenCalledTimes(1);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("counts nothing and notifies nobody when no chat took it", async () => {
    expect(await shareMuseToConversations(MUSE, [OTHERS])).toEqual({ error: "unavailable" });
    expect(await shareMuseToConversations(MUSE, [SECRET])).toEqual({ error: "unavailable" });
    secretAtInsert = new Set([D1]);
    expect(await shareMuseToConversations(MUSE, [D1])).toEqual({ error: "unavailable" });
    expect(messageCreate).not.toHaveBeenCalled();
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
  it("shares to every allowed chat, de-duplicated", async () => {
    blocked = new Set([DD]);
    const result = await shareStoryToConversations(STORY, [D1, D1, D2, HIDDEN, GROUP]);
    expect(result).toEqual({ error: null, sent: 2, failed: 2 });
    expect(sentTo()).toEqual([D1, GROUP]);
    expect(messageCreate.mock.calls[0][0]).toMatchObject({
      data: { content: "Shared a story", storyId: STORY, isForwardedStory: true, senderId: ME },
    });
  });

  it("notifies each chat it reached like any other message (push, bell, badges, the thread's live signal)", async () => {
    // Before, the copy was written with no afterMessageSent at all: the recipient's open thread, inbox and badges
    // never heard about it, so a share that said "Sent" looked like it never arrived.
    blocked = new Set([DD]);
    await shareStoryToConversations(STORY, [D1, D2, GROUP]);
    expect(afterMessageSent).toHaveBeenCalledTimes(2);
    expect(afterMessageSent).toHaveBeenNthCalledWith(1, {
      user,
      conversationId: D1,
      memberIds: [ME, CY],
      secret: false,
      content: "Shared a story",
      mediaType: "NONE",
    });
    expect(afterMessageSent).toHaveBeenNthCalledWith(2, expect.objectContaining({ conversationId: GROUP, memberIds: [ME, CY, DD] }));
  });

  it("sends no notification for a chat the copy never reached", async () => {
    secretAtInsert = new Set([D1]);
    expect(await shareStoryToConversations(STORY, [D1, SECRET])).toEqual({ error: "unavailable" });
    expect(afterMessageSent).not.toHaveBeenCalled();
  });

  it("never puts a story into a secret chat, even one that became secret after it was read", async () => {
    expect(await shareStoryToConversations(STORY, [SECRET])).toEqual({ error: "unavailable" });
    secretAtInsert = new Set([D2]);
    expect(await shareStoryToConversations(STORY, [D1, D2, SECRET])).toEqual({ error: null, sent: 1, failed: 2 });
    expect(sentTo()).toEqual([D1]);
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

describe("getShareableConversations (the Story share picker)", () => {
  it("never offers a secret chat or a hidden one", async () => {
    const ids = (await getShareableConversations()).conversations.map((c) => c.value);
    expect(ids).not.toContain(SECRET);
    expect(ids).not.toContain(HIDDEN);
    expect(ids).not.toContain(OTHERS);
    expect(ids).toEqual(expect.arrayContaining([D1, D2, GROUP]));
  });

  it("never offers a DM the send would refuse: a peer blocked either way or no longer active", async () => {
    blocked = new Set([DD]);
    conversations.push({ id: "cina0000000001", isGroup: false, members: [member(ME), member("cin00000000001", { user: { status: "SUSPENDED" } })] });
    const targets = (await getShareableConversations()).conversations;
    const ids = targets.map((c) => c.value);
    expect(ids).not.toContain(D2);
    expect(ids).not.toContain("cina0000000001");
    expect(ids).toEqual(expect.arrayContaining([D1, GROUP]));
    expect(targets.find((c) => c.value === D1)).toEqual({ value: D1, label: `Name ${CY}`, username: null });
  });

  it("answers an empty list when the only chats are secret (the picker's 'no chats' state)", async () => {
    conversations = conversations.filter((c) => c.id === SECRET);
    expect(await getShareableConversations()).toEqual({ conversations: [] });
  });
});

describe("replyToStory", () => {
  const reply = (content = "love this") => {
    const fd = new FormData();
    fd.set("content", content);
    return replyToStory(STORY, fd);
  };

  it("lands in the 1:1 with the author as the story's reply and notifies like any other message", async () => {
    // Before, it sent only its own push: no bell row, no badge signal and no realtime nudge, so the reply never
    // appeared live in the author's open chat.
    expect(await reply()).toEqual({ error: null, conversationId: AUTHOR_DM });
    expect(messageCreate.mock.calls[0][0]).toMatchObject({
      data: { conversationId: AUTHOR_DM, senderId: ME, content: "love this", storyId: STORY, moderationStatus: "PUBLISHED" },
    });
    expect(afterMessageSent).toHaveBeenCalledTimes(1);
    expect(afterMessageSent).toHaveBeenCalledWith({
      user,
      conversationId: AUTHOR_DM,
      memberIds: [ME, AUTHOR],
      secret: false,
      content: "love this",
      mediaType: "NONE",
      storyReply: true,
    });
  });

  it("sends no push of its own (afterMessageSent's is the only one)", async () => {
    await reply();
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(sendPushToUsers).not.toHaveBeenCalled();
    expect(sendFcmActivityToUser).not.toHaveBeenCalled();
    expect(sendFcmActivityToUsers).not.toHaveBeenCalled();
  });

  it("still notifies for a reply held as FLAGGED, like sendMessage", async () => {
    moderateText.mockResolvedValue({ allowed: false });
    await reply();
    expect(messageCreate.mock.calls[0][0]).toMatchObject({ data: { moderationStatus: "FLAGGED" } });
    expect(afterMessageSent).toHaveBeenCalledTimes(1);
  });

  it("notifies nobody when the reply is refused or never stored", async () => {
    blocked = new Set([AUTHOR]);
    expect(await reply()).toEqual({ error: "blocked" });
    blocked = new Set();
    expect(await reply("   ")).toEqual({ error: "invalid" });
    limits.messageSend = false;
    expect(await reply()).toEqual({ error: "rate_limited" });
    delete limits.messageSend;
    secretAtInsert = new Set([AUTHOR_DM]);
    expect(await reply()).toEqual({ error: "secret_chat" });
    conversations = conversations.filter((c) => c.id !== AUTHOR_DM);
    expect(await reply()).toEqual({ error: "not_connected" });
    expect(afterMessageSent).not.toHaveBeenCalled();
  });
});
