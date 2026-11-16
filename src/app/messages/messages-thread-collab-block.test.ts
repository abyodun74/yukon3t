import { beforeEach, describe, expect, it, vi } from "vitest";

// The thread page (app/messages/[id]/page.tsx) answers notFound() for a collab's group chat whose author is blocked
// either way with the viewer, exactly like a chat that doesn't exist: a member, a member who also PIN-hid it (no
// redirect to the PIN prompt, which would tell it apart), a non-member who'd otherwise see the join-request page, and a
// site admin. The author, other participants and ordinary groups carry on as before.

const AUTHOR = "cau00000000001";
const PA = "cpa00000000001"; // blocked by the author
const PB = "cpb00000000001";
const OUT = "cout0000000001"; // not a member
const CHAT = "cchat000000001";
const PLAIN = "cplain00000001";

let me = { id: PA, isAdmin: false, isGuestPreview: false };
let blocks: [string, string][] = [];
let hiddenAt: Date | null = null;
const pastGate = vi.fn();
const collabAuthorByChat = new Map<string, string>([[CHAT, AUTHOR]]);
const members: Record<string, string[]> = { [CHAT]: [AUTHOR, PA, PB], [PLAIN]: [AUTHOR, PA, PB] };

type HiddenIs = {
  authorId: { not: string };
  author: { OR: [{ blocksMade: { some: { blockedId: string } } }, { blocksReceived: { some: { blockerId: string } } }] };
};

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/page-guards", () => ({ getOnboardedUserOrRedirect: async () => me }));
vi.mock("@/lib/i18n/server", () => ({
  getLocale: async () => "en",
  getDictionary: async () => ({ messages: { back: "Back", fallback: { group: "Group" }, group: { notMember: "x" } } }),
}));
vi.mock("@/lib/blocks", () => ({
  isBlockedWithAny: async () => false,
  isBlockedEitherWay: async () => false,
  getBlockedEitherWayIds: async () => new Set<string>(),
}));
// The first thing the page asks a member after its gates: reaching it means the viewer got past the 404.
vi.mock("@/lib/hidden-chats", () => ({
  isMembershipLocked: async (m: { hiddenAt: Date | null }) => {
    pastGate();
    if (m.hiddenAt) throw new Error("PIN_PROMPT");
    throw new Error("PAST_GATE");
  },
  getHiddenPeerIds: async () => [],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationMember: {
      findUnique: async ({ where }: { where: { conversationId_userId: { conversationId: string; userId: string } } }) => {
        const { conversationId, userId } = where.conversationId_userId;
        return members[conversationId]?.includes(userId) ? { userId, hiddenAt: userId === PA ? hiddenAt : null } : null;
      },
    },
    conversation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        members[where.id]
          ? {
              id: where.id,
              isGroup: true,
              discoverable: true,
              name: where.id,
              members: members[where.id].map((id) => ({ user: { id, name: id, username: id, avatarUrl: null } })),
            }
          : null,
      findMany: async ({ where }: { where: { id: { in: string[] }; collabBoardPost: { is: HiddenIs } } }) =>
        where.id.in
          .filter((id) => {
            const author = collabAuthorByChat.get(id);
            const is = where.collabBoardPost.is;
            if (!author || author === is.authorId.not) return false;
            const v = is.author.OR[0].blocksMade.some.blockedId;
            return blocks.some(([x, y]) => (x === author && y === v) || (x === v && y === author));
          })
          .map((id) => ({ id })),
    },
    groupJoinRequest: { findUnique: async () => null },
  },
}));

const { default: ConversationPage } = await import("@/app/messages/[id]/page");
const open = (id: string) => ConversationPage({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  me = { id: PA, isAdmin: false, isGuestPreview: false };
  blocks = [[AUTHOR, PA]];
  hiddenAt = null;
});

describe("the thread page and a collab chat hidden by a block with its author", () => {
  it("404s the blocked member exactly like a missing chat", async () => {
    await expect(open("cnope000000001")).rejects.toThrow("NOT_FOUND");
    await expect(open(CHAT)).rejects.toThrow("NOT_FOUND");
    expect(pastGate).not.toHaveBeenCalled();
  });

  it("404s them even when they also PIN-hid it (no redirect to the PIN prompt)", async () => {
    hiddenAt = new Date();
    await expect(open(CHAT)).rejects.toThrow("NOT_FOUND");
    expect(pastGate).not.toHaveBeenCalled();
  });

  it("404s a blocked non-member instead of showing the join-request page, and a blocked site admin", async () => {
    blocks = [[OUT, AUTHOR]];
    me = { id: OUT, isAdmin: false, isGuestPreview: false };
    await expect(open(CHAT)).rejects.toThrow("NOT_FOUND");
    me = { id: OUT, isAdmin: true, isGuestPreview: false };
    await expect(open(CHAT)).rejects.toThrow("NOT_FOUND");
    // Without the block the same person sees the join-request page.
    blocks = [];
    await expect(open(CHAT)).resolves.toBeTruthy();
  });

  it("opens as before for the author, another participant, an ordinary group, and once the block is lifted", async () => {
    me = { id: AUTHOR, isAdmin: false, isGuestPreview: false };
    await expect(open(CHAT)).rejects.toThrow("PAST_GATE");
    me = { id: PB, isAdmin: false, isGuestPreview: false };
    await expect(open(CHAT)).rejects.toThrow("PAST_GATE");
    me = { id: PA, isAdmin: false, isGuestPreview: false };
    await expect(open(PLAIN)).rejects.toThrow("PAST_GATE");
    blocks = [];
    await expect(open(CHAT)).rejects.toThrow("PAST_GATE");
    expect(pastGate).toHaveBeenCalledTimes(4);
  });
});
