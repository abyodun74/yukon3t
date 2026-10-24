import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

// forwardMessage / getForwardTargets against a mocked database. afterMessageSent is the real one (push and FCM
// mocked), so the destination's notifications are checked end to end: same push URL as the bell row, no source info.

const ME = "cme00000000001";
const BO = "cbo00000000001"; // the original author, in the source chat
const CY = "ccy00000000001"; // a friend in a destination 1:1
const SRC = "csrc0000000001";
const MSG = "cmsg0000000001";
const D1 = "cdst0000000001";
const D2 = "cdst0000000002";
const GROUP = "cgrp0000000001";

const user = { id: ME, name: "Me", isAdmin: false };
const limits: Record<string, boolean> = {};
const checkRateLimit = vi.fn(async (name: string) => limits[name] ?? true);
const moderateText = vi.fn();
const messageCreate = vi.fn();
const notificationCreateMany = vi.fn();
const webPush = vi.fn();
const fcm = vi.fn();
let blocked = new Set<string>();
let unlocked = false;

type Member = {
  userId: string;
  e2eeEnabledAt: Date | null;
  hiddenAt: Date | null;
  user: { id: string; name: string; username: string; avatarUrl: string | null; status: string };
};
type Conv = { id: string; isGroup: boolean; name: string | null; members: Member[] };

function member(userId: string, over: Partial<Member> = {}): Member {
  return {
    userId,
    e2eeEnabledAt: null,
    hiddenAt: null,
    user: { id: userId, name: userId, username: userId, avatarUrl: null, status: "ACTIVE" },
    ...over,
  };
}

let conversations: Conv[] = [];
let source: Record<string, unknown> | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (name: string) => checkRateLimit(name) }));
vi.mock("@/lib/moderation", () => ({ moderateText: (t: string) => moderateText(t), moderateMedia: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: {},
  verifyUploadedSize: vi.fn(),
  deleteOwnedObject: vi.fn(),
  keyFromPublicUrl: vi.fn(),
}));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateConversationEmbedding: vi.fn() }));
vi.mock("@/lib/translation-server", () => ({ deleteTranslationsOf: vi.fn() }));
vi.mock("@/lib/view-once-media", () => ({ destroyViewOnceMedia: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn(), publishEvents: vi.fn() }));
vi.mock("@/lib/trust", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToUsers: (...a: unknown[]) => webPush(...a) }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUsers: (...a: unknown[]) => fcm(...a) }));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (a: string, b: string) => blocked.has(a === ME ? b : a),
  getBlockedEitherWayIds: async () => new Set(blocked),
}));
vi.mock("@/lib/hidden-chats", () => ({
  isMembershipLocked: async (m: { hiddenAt: Date | null }) => m.hiddenAt !== null && !unlocked,
  isConversationLocked: vi.fn(async () => false),
  getMembersHidingConversation: async () => [],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      findUnique: async () => source,
      create: (...a: unknown[]) => messageCreate(...a),
    },
    conversationMember: {
      findUnique: async ({ where }: { where: { conversationId_userId: { conversationId: string; userId: string } } }) => {
        const { conversationId, userId } = where.conversationId_userId;
        const m = conversations.find((c) => c.id === conversationId)?.members.find((x) => x.userId === userId);
        return m ? { hiddenAt: m.hiddenAt } : null;
      },
    },
    conversation: {
      findMany: async ({ where }: { where: { id?: { in: string[] }; members?: unknown } }) => {
        if (where.id) return conversations.filter((c) => where.id!.in.includes(c.id));
        // getForwardTargets: the caller's chats it hasn't hidden.
        return conversations
          .filter((c) => c.members.some((m) => m.userId === ME && m.hiddenAt === null))
          .map((c, i) => ({ ...c, messages: [{ createdAt: new Date(1000 * i) }] }));
      },
    },
    notification: { createMany: (...a: unknown[]) => notificationCreateMany(...a) },
  },
}));

import { forwardMessage, getForwardTargets } from "@/app/actions/messages";

function baseSource(over: Record<string, unknown> = {}) {
  return {
    conversationId: SRC,
    senderId: BO,
    content: "see https://example.com/x",
    mediaType: "NONE",
    mediaUrl: null,
    mediaThumbnailUrl: null,
    moderationStatus: "PUBLISHED",
    deletedForEveryoneAt: null,
    deletedForUserIds: [],
    viewOnce: false,
    storyId: null,
    conversation: { isGroup: false, members: [{ e2eeEnabledAt: null }, { e2eeEnabledAt: null }] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(limits)) delete limits[k];
  blocked = new Set();
  unlocked = false;
  moderateText.mockResolvedValue({ allowed: true });
  messageCreate.mockResolvedValue({ id: "new" });
  conversations = [
    { id: SRC, isGroup: false, name: null, members: [member(ME), member(BO)] },
    { id: D1, isGroup: false, name: null, members: [member(ME), member(CY)] },
    { id: D2, isGroup: false, name: null, members: [member(ME), member("cdd00000000001")] },
    { id: GROUP, isGroup: true, name: "Team", members: [member(ME), member(CY), member("cee00000000001")] },
  ];
  source = baseSource();
});

describe("forwardMessage: the source", () => {
  it("forwards text with links to a 1:1 and a group, as the forwarder's own message marked forwarded", async () => {
    expect(await forwardMessage(MSG, [D1, GROUP])).toEqual({ error: null, sent: 2, failed: 0 });
    expect(messageCreate).toHaveBeenCalledTimes(2);
    const data = messageCreate.mock.calls[0][0].data;
    expect(data).toEqual({
      conversationId: D1,
      senderId: ME,
      content: "see https://example.com/x",
      mediaType: "NONE",
      mediaUrl: null,
      mediaThumbnailUrl: null,
      moderationStatus: "PUBLISHED",
      forwarded: true,
    });
    // Nothing about who wrote it or where it was.
    expect(JSON.stringify(messageCreate.mock.calls)).not.toContain(BO);
    expect(JSON.stringify(messageCreate.mock.calls)).not.toContain(SRC);
  });

  it("forwards a photo by reusing its stored file", async () => {
    source = baseSource({ content: "", mediaType: "IMAGE", mediaUrl: "https://media.example/message-image/a.jpg" });
    expect(await forwardMessage(MSG, [D1])).toMatchObject({ error: null, sent: 1 });
    expect(messageCreate.mock.calls[0][0].data).toMatchObject({ mediaType: "IMAGE", mediaUrl: "https://media.example/message-image/a.jpg" });
    expect(moderateText).not.toHaveBeenCalled();
  });

  it("refuses someone who isn't in the source chat without saying the message exists", async () => {
    conversations[0].members = [member(BO), member("cff00000000001")];
    expect(await forwardMessage(MSG, [D1])).toEqual({ error: "not_found" });
    source = null;
    expect(await forwardMessage(MSG, [D1])).toEqual({ error: "not_found" });
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("refuses a message the caller deleted for themselves", async () => {
    source = baseSource({ deletedForUserIds: [ME] });
    expect(await forwardMessage(MSG, [D1])).toEqual({ error: "not_found" });
  });

  it("refuses deleted, view-once and held messages", async () => {
    for (const over of [
      { deletedForEveryoneAt: new Date(), content: "" },
      { viewOnce: true, content: "", mediaType: "IMAGE" },
      { moderationStatus: "FLAGGED" },
    ]) {
      source = baseSource(over);
      expect(await forwardMessage(MSG, [D1])).toEqual({ error: "not_forwardable" });
    }
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("never forwards out of a secret chat, and never ciphertext", async () => {
    source = baseSource({
      content: "e2ee:v1:abc",
      conversation: { isGroup: false, members: [{ e2eeEnabledAt: new Date() }, { e2eeEnabledAt: new Date() }] },
    });
    expect(await forwardMessage(MSG, [D1])).toEqual({ error: "not_forwardable" });
    source = baseSource({ content: "e2ee:v1:abc" });
    expect(await forwardMessage(MSG, [D1])).toEqual({ error: "not_forwardable" });
    expect(moderateText).not.toHaveBeenCalled();
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("refuses from a hidden chat whose PIN unlock isn't live, allows it once unlocked", async () => {
    conversations[0].members[0].hiddenAt = new Date();
    expect(await forwardMessage(MSG, [D1])).toEqual({ error: "hidden_locked" });
    unlocked = true;
    expect(await forwardMessage(MSG, [D1])).toMatchObject({ error: null, sent: 1 });
  });

  it("refuses a message by someone blocked either way", async () => {
    blocked = new Set([BO]);
    expect(await forwardMessage(MSG, [D1])).toEqual({ error: "not_found" });
  });

  it("runs text moderation again and refuses outright when it fails", async () => {
    moderateText.mockResolvedValue({ allowed: false });
    expect(await forwardMessage(MSG, [D1])).toEqual({ error: "moderation" });
    expect(moderateText).toHaveBeenCalledWith("see https://example.com/x");
    expect(messageCreate).not.toHaveBeenCalled();
  });
});

describe("forwardMessage: destinations", () => {
  it("skips a secret chat, a blocked peer, an inactive peer, a chat the caller isn't in and a locked hidden chat", async () => {
    const SECRET = "csec0000000001";
    const NOTMINE = "cnot0000000001";
    const HIDDEN = "chid0000000001";
    conversations.push(
      { id: SECRET, isGroup: false, name: null, members: [member(ME, { e2eeEnabledAt: new Date() }), member(CY, { e2eeEnabledAt: new Date() })] },
      { id: NOTMINE, isGroup: true, name: "Other", members: [member(CY), member(BO)] },
      { id: HIDDEN, isGroup: false, name: null, members: [member(ME, { hiddenAt: new Date() }), member(CY)] },
    );
    conversations[2].members[1].user.status = "BANNED";
    blocked = new Set([CY]);
    // D1 (blocked CY), D2 (banned), SECRET, NOTMINE, HIDDEN: nothing can go.
    expect(await forwardMessage(MSG, [D1, D2, SECRET, NOTMINE, HIDDEN])).toEqual({ error: "unavailable" });
    expect(messageCreate).not.toHaveBeenCalled();

    blocked = new Set();
    expect(await forwardMessage(MSG, [D1, SECRET, HIDDEN])).toEqual({ error: null, sent: 1, failed: 2 });
  });

  it("refuses more than five destinations and de-duplicates repeats", async () => {
    const ids = [1, 2, 3, 4, 5, 6].map((n) => `cxx${String(n).padStart(11, "0")}`);
    expect(await forwardMessage(MSG, ids)).toEqual({ error: "invalid" });
    expect(await forwardMessage(MSG, [D1, D1, D1])).toEqual({ error: null, sent: 1, failed: 0 });
  });

  it("is rate limited per forward, and each copy counts against the send limit", async () => {
    limits.messageForward = false;
    expect(await forwardMessage(MSG, [D1])).toEqual({ error: "rate_limited" });
    expect(messageCreate).not.toHaveBeenCalled();

    limits.messageForward = true;
    let calls = 0;
    checkRateLimit.mockImplementation(async (name: string) => (name === "messageSend" ? ++calls <= 1 : true));
    expect(await forwardMessage(MSG, [D1, GROUP])).toEqual({ error: null, sent: 1, failed: 1 });
    expect(checkRateLimit).toHaveBeenCalledWith("messageSend");
    checkRateLimit.mockImplementation(async (name: string) => limits[name] ?? true);
  });

  it("notifies the destination like any message: push URL = bell row href, no source info", async () => {
    await forwardMessage(MSG, [D1]);
    const rows = notificationCreateMany.mock.calls[0][0].data as { recipientId: string; actorId: string; type: string; conversationId: string }[];
    expect(rows).toEqual([{ recipientId: CY, actorId: ME, type: "MESSAGE", conversationId: D1 }]);
    const [pushIds, payload] = webPush.mock.calls[0] as [string[], (l: "en") => { title: string; body: string; url: string }];
    expect(pushIds).toEqual([CY]);
    const push = payload("en");
    const bell: NotificationData = {
      id: "n",
      type: "MESSAGE",
      recipientId: CY,
      readAt: null,
      createdAt: new Date(),
      actor: { id: ME, name: "Me" },
      message: null,
      postId: null,
      circle: null,
      conversationId: D1,
      collab: null,
      liveStreamId: null,
      channel: null,
      museId: null,
      storyId: null,
    };
    expect(push.url).toBe(`/messages/${D1}`);
    expect(push.url).toBe(notificationHref(bell));
    expect(push.title).toBe("Me");
    expect(JSON.stringify(push)).not.toContain(BO);
    expect(JSON.stringify(push)).not.toContain(SRC);
    const fcmPayload = (fcm.mock.calls[0][1] as (l: "en") => { url: string; type: string })("en");
    expect(fcmPayload).toMatchObject({ url: `/messages/${D1}`, type: "MESSAGE" });
  });
});

describe("getForwardTargets", () => {
  it("offers only chats that can take a forward, never a hidden one, most recent first", async () => {
    conversations.push(
      { id: "csec0000000001", isGroup: false, name: null, members: [member(ME, { e2eeEnabledAt: new Date() }), member(CY, { e2eeEnabledAt: new Date() })] },
      { id: "chid0000000001", isGroup: false, name: null, members: [member(ME, { hiddenAt: new Date() }), member(CY)] },
    );
    blocked = new Set([BO]);
    const result = await getForwardTargets();
    expect(result.error).toBeNull();
    expect(result.targets.map((t) => t.id)).toEqual([GROUP, D2, D1]);
    expect(result.targets.find((t) => t.id === GROUP)).toEqual({ id: GROUP, isGroup: true, label: "Team", avatarUrl: null, username: null });
  });

  it("is rate limited", async () => {
    limits.messageForwardTargets = false;
    expect(await getForwardTargets()).toEqual({ error: "rate_limited", targets: [] });
  });
});
