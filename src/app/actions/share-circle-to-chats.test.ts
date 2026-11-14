import { beforeEach, describe, expect, it, vi } from "vitest";

// shareCircleToConversations (actions/share-to-chats.ts) against a mocked database: a PUBLIC Circle's name + link go to
// each chat that may take it, through createNonE2eeMessage; a PRIVATE (or missing) Circle answers a generic
// "unavailable" before any chat is touched, so nothing about it can reach a chat.

const ME = "cme00000000001";
const CY = "ccy00000000001";
const DD = "cdd00000000001";
const D1 = "cdst0000000001";
const D2 = "cdst0000000002";
const D3 = "cdst0000000003";
const D4 = "cdst0000000004";
const D5 = "cdst0000000005";
const D6 = "cdst0000000006";
const GROUP = "cgrp0000000001";
const SECRET = "csec0000000001";
const HIDDEN = "chid0000000001";
const OTHERS = "coth0000000001";
const INACTIVE = "cina0000000001";
const CIRCLE = "ccir0000000001";

let currentUser: { id: string; name: string; isAdmin: boolean } | null = { id: ME, name: "Me", isAdmin: false };
const limits: Record<string, boolean | boolean[]> = {};
const checkRateLimit = vi.fn(async (name: string) => {
  const v = limits[name];
  if (Array.isArray(v)) return v.length ? v.shift()! : true;
  return v ?? true;
});
const moderateText = vi.fn();
const messageCreate = vi.fn();
const afterMessageSent = vi.fn();
const circleFindUnique = vi.fn();
let blocked = new Set<string>();
let unlocked = false;
let secretAtInsert = new Set<string>();
let circle: { name: string; slug: string; visibility: "PUBLIC" | "PRIVATE"; memberIds: string[] } | null = null;

type Member = { userId: string; e2eeEnabledAt: Date | null; hiddenAt: Date | null; user: { status: string } };
type Conv = { id: string; isGroup: boolean; members: Member[] };
function member(userId: string, over: Partial<Member> = {}): Member {
  return { userId, e2eeEnabledAt: null, hiddenAt: null, user: { status: "ACTIVE" }, ...over };
}
let conversations: Conv[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireVerifiedUser: async () => {
    if (!currentUser) throw new Error("not signed in");
    return currentUser;
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (name: string) => checkRateLimit(name) }));
vi.mock("@/lib/moderation", () => ({ moderateText: (t: string) => moderateText(t), moderateMedia: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: { "message-image": 1, "message-video": 1, "message-audio": 1 },
  verifyUploadedSize: vi.fn(),
  deleteOwnedObject: vi.fn(),
  keyFromPublicUrl: (url: string) => url.split("/").pop(),
}));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn(), sendPushToUsers: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUser: vi.fn(), sendFcmActivityToUsers: vi.fn() }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: (a: unknown) => afterMessageSent(a) }));
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
    circle: {
      findUnique: async (args: { where: { id: string }; select: Record<string, unknown> }) => {
        circleFindUnique(args);
        if (!circle || args.where.id !== CIRCLE) return null;
        return {
          name: circle.name,
          slug: circle.slug,
          visibility: circle.visibility,
          members: circle.memberIds.filter((id) => id === ME).map((id) => ({ id })),
        };
      },
    },
    conversation: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        conversations.filter((c) => where.id.in.includes(c.id)),
    },
    message: { create: (...a: unknown[]) => messageCreate(...a) },
    $queryRaw: async (_sql: TemplateStringsArray, conversationId: string) => {
      const conv = conversations.find((c) => c.id === conversationId);
      if (!conv) return [];
      const nowSecret = secretAtInsert.has(conversationId);
      return conv.members.map((m) => ({ isGroup: conv.isGroup, e2eeEnabledAt: nowSecret ? new Date() : m.e2eeEnabledAt }));
    },
    $transaction: async (arg: unknown): Promise<unknown> =>
      typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[]),
  };
  return { prisma };
});

import { shareCircleToConversations } from "@/app/actions/share-to-chats";

const sentTo = () =>
  messageCreate.mock.calls.map((c) => (c[0] as { data: { conversationId: string } }).data.conversationId);
const sentData = () => messageCreate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(limits)) delete limits[k];
  currentUser = { id: ME, name: "Me", isAdmin: false };
  blocked = new Set();
  unlocked = false;
  secretAtInsert = new Set();
  moderateText.mockResolvedValue({ allowed: true });
  messageCreate.mockResolvedValue({ id: "new" });
  circle = { name: "Lagos Runners", slug: "lagos-runners", visibility: "PUBLIC", memberIds: [] };
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
    { id: INACTIVE, isGroup: false, members: [member(ME), member("cin00000000001", { user: { status: "SUSPENDED" } })] },
    { id: OTHERS, isGroup: false, members: [member(CY), member(DD)] },
  ];
});

describe("shareCircleToConversations: auth and input", () => {
  it("needs a signed-in, verified user", async () => {
    currentUser = null;
    await expect(shareCircleToConversations(CIRCLE, [D1])).rejects.toThrow();
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("refuses no destinations, more than 5, and a bad Circle id", async () => {
    expect(await shareCircleToConversations(CIRCLE, [])).toEqual({ error: "invalid" });
    expect(await shareCircleToConversations(CIRCLE, [D1, D2, D3, D4, D5, D6])).toEqual({ error: "invalid" });
    expect(await shareCircleToConversations(42 as unknown as string, [D1])).toEqual({ error: "invalid" });
    expect(await shareCircleToConversations("", [D1])).toEqual({ error: "invalid" });
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("is rate-limited by shareToChats before reading the Circle, and messageSend per copy", async () => {
    limits.shareToChats = false;
    expect(await shareCircleToConversations(CIRCLE, [D1])).toEqual({ error: "rate_limited" });
    expect(circleFindUnique).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith("shareToChats");

    limits.shareToChats = true;
    limits.messageSend = [true, false];
    expect(await shareCircleToConversations(CIRCLE, [D1, D2, GROUP])).toEqual({ error: null, sent: 1, failed: 2 });
    expect(sentTo()).toEqual([D1]);
  });
});

describe("shareCircleToConversations: the Circle", () => {
  it("sends a PUBLIC Circle's name and public link, written by the server, as a normal published message", async () => {
    expect(await shareCircleToConversations(CIRCLE, [D1, GROUP])).toEqual({ error: null, sent: 2, failed: 0 });
    expect(sentTo()).toEqual([D1, GROUP]);
    for (const data of sentData()) {
      expect(data).toMatchObject({
        senderId: ME,
        content: "Lagos Runners\nhttps://yukon3t.com/circles/lagos-runners",
        mediaType: "NONE",
        moderationStatus: "PUBLISHED",
      });
      expect(data.mediaUrl).toBeUndefined();
    }
    expect(afterMessageSent).toHaveBeenCalledTimes(2);
    expect(afterMessageSent.mock.calls[0][0]).toMatchObject({ conversationId: D1, secret: false, mediaType: "NONE" });
    // Nothing user-written travels in the request, so there is nothing to moderate.
    expect(moderateText).not.toHaveBeenCalled();
  });

  it("never shares a PRIVATE Circle, not even for a member, with the same generic answer as no chat reached", async () => {
    circle = { name: "Secret club", slug: "secret-club", visibility: "PRIVATE", memberIds: [ME] };
    expect(await shareCircleToConversations(CIRCLE, [D1])).toEqual({ error: "unavailable" });
    circle = { name: "Secret club", slug: "secret-club", visibility: "PRIVATE", memberIds: [] };
    expect(await shareCircleToConversations(CIRCLE, [D1])).toEqual({ error: "unavailable" });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(afterMessageSent).not.toHaveBeenCalled();
  });

  it("answers a missing Circle exactly like a private one", async () => {
    expect(await shareCircleToConversations("cnope000000001", [D1])).toEqual({ error: "unavailable" });
    expect(messageCreate).not.toHaveBeenCalled();
  });
});

describe("shareCircleToConversations: each destination on its own", () => {
  it("never writes into a secret chat, a locked hidden chat, a chat the caller isn't in, a blocked or inactive peer", async () => {
    blocked = new Set([DD]);
    const result = await shareCircleToConversations(CIRCLE, [SECRET, HIDDEN, OTHERS, D2, INACTIVE]);
    expect(result).toEqual({ error: "unavailable" });
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("counts refusals as failed and sends to the rest (counts only)", async () => {
    const result = await shareCircleToConversations(CIRCLE, [D1, SECRET, GROUP, OTHERS]);
    expect(result).toEqual({ error: null, sent: 2, failed: 2 });
    expect(sentTo()).toEqual([D1, GROUP]);
  });

  it("sends into a hidden chat only while it is unlocked", async () => {
    unlocked = true;
    expect(await shareCircleToConversations(CIRCLE, [HIDDEN])).toEqual({ error: null, sent: 1, failed: 0 });
  });

  it("counts a chat that turned secret just before the insert as failed (createNonE2eeMessage)", async () => {
    secretAtInsert = new Set([D1]);
    expect(await shareCircleToConversations(CIRCLE, [D1, D2])).toEqual({ error: null, sent: 1, failed: 1 });
    expect(sentTo()).toEqual([D2]);
  });

  it("sends once per chat when the same id is picked twice", async () => {
    expect(await shareCircleToConversations(CIRCLE, [D1, D1, D2])).toEqual({ error: null, sent: 2, failed: 0 });
  });
});
