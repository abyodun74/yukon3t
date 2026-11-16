import { beforeEach, describe, expect, it, vi } from "vitest";

// Conversation lists and the collab group-chat block rule: the inbox, the PIN-hidden list and the share sheets'
// destinations (sendToEachChat) never have a collab's group chat whose author is blocked either way with the user. The
// filter is part of the list query itself (one conversation.findMany per list, nothing per row); everyone else, and
// ordinary groups, are unaffected.

const AUTHOR = "cau00000000001";
const PA = "cpa00000000001"; // blocked by the author
const PB = "cpb00000000001";
const PC = "cpc00000000001"; // blocked by PB only
const CHAT = "cchat000000001";
const PLAIN = "cplain00000001";

type Member = { userId: string; hiddenAt: Date | null; lastReadAt: Date | null; e2eeEnabledAt: Date | null };
type Conv = { id: string; isGroup: boolean; name: string; createdAt: Date; members: Member[] };
let conversations: Conv[] = [];
let blocks: [string, string][] = [];
const collabAuthorByChat = new Map<string, string>([[CHAT, AUTHOR]]);
const findMany = vi.fn();
const sent = vi.fn();

const member = (userId: string, over: Partial<Member> = {}): Member => ({
  userId,
  hiddenAt: null,
  lastReadAt: null,
  e2eeEnabledAt: null,
  ...over,
});
type HiddenIs = {
  authorId: { not: string };
  author: { OR: [{ blocksMade: { some: { blockedId: string } } }, { blocksReceived: { some: { blockerId: string } } }] };
};
function collabHiddenMatch(conversationId: string, is: HiddenIs): boolean {
  const author = collabAuthorByChat.get(conversationId);
  if (!author || author === is.authorId.not) return false;
  const blockedId = is.author.OR[0].blocksMade.some.blockedId;
  const blockerId = is.author.OR[1].blocksReceived.some.blockerId;
  return blocks.some(([x, y]) => (x === author && y === blockedId) || (x === blockerId && y === author));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convMatches(c: Conv, where: any): boolean {
  if (!where) return true;
  if (where.id?.in && !where.id.in.includes(c.id)) return false;
  if (where.members?.some) {
    const s = where.members.some;
    const hiddenOk = (m: Member) =>
      s.hiddenAt === undefined || (s.hiddenAt === null ? m.hiddenAt === null : m.hiddenAt !== null);
    if (!c.members.some((m) => m.userId === s.userId && hiddenOk(m))) return false;
  }
  if (where.collabBoardPost && !collabHiddenMatch(c.id, where.collabBoardPost.is)) return false;
  if (where.NOT && convMatches(c, where.NOT)) return false;
  return true;
}
const withUsers = (c: Conv) => ({
  ...c,
  members: c.members.map((m) => ({
    ...m,
    user: { id: m.userId, name: m.userId, avatarUrl: null, lastSeenAt: null, status: "ACTIVE" },
  })),
});

vi.mock("@/lib/presence", () => ({ isOnline: () => false }));
vi.mock("@/lib/latest-messages", () => ({
  latestMessagesByConversation: async (ids: string[]) =>
    new Map(
      ids.map((id) => [
        id,
        { conversationId: id, createdAt: new Date("2026-11-15T10:00:00Z"), senderId: AUTHOR, content: "hi", mediaType: "NONE", moderationStatus: "PUBLISHED" },
      ]),
    ),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({ isMembershipLocked: async (m: { hiddenAt: Date | null }) => m.hiddenAt !== null }));
vi.mock("@/lib/blocks", () => ({ getBlockedEitherWayIds: async () => new Set<string>() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async (args: { where: any }) => {
        findMany(args);
        return conversations.filter((c) => convMatches(c, args.where)).map(withUsers);
      },
    },
  },
}));

const { getInboxItems } = await import("@/lib/inbox-items");
const { sendToEachChat } = await import("@/lib/share-to-chats-server");

beforeEach(() => {
  vi.clearAllMocks();
  blocks = [
    [AUTHOR, PA],
    [PB, PC],
  ];
  conversations = [
    {
      id: CHAT,
      isGroup: true,
      name: "Collab chat",
      createdAt: new Date("2026-11-01T00:00:00Z"),
      members: [member(AUTHOR), member(PA), member(PB), member(PC)],
    },
    {
      id: PLAIN,
      isGroup: true,
      name: "Plain",
      createdAt: new Date("2026-11-01T00:00:00Z"),
      members: [member(AUTHOR), member(PA), member(PB)],
    },
  ];
});

const ids = (items: { id: string }[]) => items.map((i) => i.id).sort();

describe("getInboxItems", () => {
  it("leaves the collab chat out of a blocked participant's inbox, ordinary groups stay", async () => {
    expect(ids(await getInboxItems(PA, "visible"))).toEqual([PLAIN]);
  });

  it("keeps it for the author, other participants, and a participant blocked only by another participant", async () => {
    expect(ids(await getInboxItems(AUTHOR, "visible"))).toEqual([CHAT, PLAIN].sort());
    expect(ids(await getInboxItems(PB, "visible"))).toEqual([CHAT, PLAIN].sort());
    expect(ids(await getInboxItems(PC, "visible"))).toEqual([CHAT]);
  });

  it("keeps it out of the PIN-hidden list too: no row, no unread, nothing to count there", async () => {
    conversations[0].members.find((m) => m.userId === PA)!.hiddenAt = new Date();
    expect(await getInboxItems(PA, "hidden")).toEqual([]);
    expect(ids(await getInboxItems(PA, "visible"))).toEqual([PLAIN]);
  });

  it("is one list query (the filter is in it, nothing per row)", async () => {
    await getInboxItems(PA, "visible");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.NOT).toEqual({
      collabBoardPost: {
        is: {
          authorId: { not: PA },
          author: { OR: [{ blocksMade: { some: { blockedId: PA } } }, { blocksReceived: { some: { blockerId: PA } } }] },
        },
      },
    });
  });

  it("brings the thread back, still unread, once the block is lifted", async () => {
    blocks = [];
    const items = await getInboxItems(PA, "visible");
    expect(ids(items)).toEqual([CHAT, PLAIN].sort());
    expect(items.find((i) => i.id === CHAT)?.unread).toBe(true);
  });
});

describe("sendToEachChat (share sheets: post, Muse, Story, Circle, Collab, share-in)", () => {
  it("counts a collab chat hidden from the sharer as failed and sends nothing there", async () => {
    const tally = await sendToEachChat({
      userId: PA,
      targetIds: [CHAT, PLAIN],
      send: async (target) => {
        sent(target.id);
        return null;
      },
    });
    expect(tally).toEqual({ sent: 1, failed: 1, rateLimited: false });
    expect(sent.mock.calls).toEqual([[PLAIN]]);
  });

  it("sends to it for anyone else", async () => {
    const tally = await sendToEachChat({ userId: PB, targetIds: [CHAT], send: async () => null });
    expect(tally).toEqual({ sent: 1, failed: 0, rateLimited: false });
  });
});
