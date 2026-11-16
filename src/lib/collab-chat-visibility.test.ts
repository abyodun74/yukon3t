import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { collabChatHiddenWhere, collabChatVisibleWhere } from "@/lib/collab-visibility";

// The collab group-chat rule (lib/collab-visibility.ts, collab-chat-visibility-server.ts): a collab's group chat does
// not exist for someone blocked either way with the collab's author. The decision is one relation filter; the server
// helpers are checked here against an in-memory database that evaluates it, with the number of queries counted.

const AUTHOR = "cau00000000001";
const PA = "cpa00000000001"; // blocked by the author
const PB = "cpb00000000001"; // no block
const PC = "cpc00000000001"; // blocked PB (a block between two participants)
const PD = "cpd00000000001"; // blocked the author (the other direction)
const CHAT = "cchat000000001"; // a collab's group chat
const PLAIN = "cplain00000001"; // an ordinary group chat
const DM = "cdm00000000001"; // a 1:1
const ORPHAN = "corph000000001"; // a collab whose chat was never made (conversationId null) has no chat to match

const collabAuthorByChat = new Map<string, string>([[CHAT, AUTHOR]]);
let blocks: [string, string][] = [];
const chats = [CHAT, PLAIN, DM];
const findMany = vi.fn();
const findUnique = vi.fn();

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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findMany: async (args: { where: { id: { in: string[] }; collabBoardPost: { is: HiddenIs } } }) => {
        findMany(args);
        return chats
          .filter((id) => args.where.id.in.includes(id) && collabHiddenMatch(id, args.where.collabBoardPost.is))
          .map((id) => ({ id }));
      },
      findUnique: async (args: { where: { id: string } }) => {
        findUnique(args);
        if (!chats.includes(args.where.id)) return null;
        const authorId = collabAuthorByChat.get(args.where.id);
        return { collabBoardPost: authorId ? { authorId } : null };
      },
    },
  },
}));
const getBlockedEitherWayIds = vi.fn(
  async (a: string) => new Set(blocks.flatMap(([x, y]) => (x === a ? [y] : y === a ? [x] : []))),
);
vi.mock("@/lib/blocks", () => ({
  getBlockedEitherWayIds: (a: string) => getBlockedEitherWayIds(a),
  isBlockedEitherWay: vi.fn(),
}));

const { collabChatHiddenFor, collabChatsHiddenFor, collabChatRecipientsOnly, collabChatHiddenSql } = await import(
  "@/lib/collab-chat-visibility-server"
);

beforeEach(() => {
  vi.clearAllMocks();
  blocks = [
    [AUTHOR, PA],
    [PC, PB],
    [PD, AUTHOR],
  ];
});

describe("collabChatHiddenWhere / collabChatVisibleWhere", () => {
  const blockedWithMe = {
    OR: [{ blocksMade: { some: { blockedId: PA } } }, { blocksReceived: { some: { blockerId: PA } } }],
  };

  it("is one relation filter on the chat's collab: author blocked either way with the viewer, never the viewer themselves", () => {
    expect(collabChatHiddenWhere(PA)).toEqual({
      collabBoardPost: { is: { authorId: { not: PA }, author: blockedWithMe } },
    });
  });

  it("the list form is its negation, so a chat with no collab (relation null) always stays", () => {
    expect(collabChatVisibleWhere(PA)).toEqual({ NOT: collabChatHiddenWhere(PA) });
  });
});

describe("collabChatHiddenFor", () => {
  it("hides a collab chat from a participant blocked either way with its author (both directions)", async () => {
    expect(await collabChatHiddenFor(PA, CHAT)).toBe(true);
    expect(await collabChatHiddenFor(PD, CHAT)).toBe(true);
  });

  it("never from the author, and never because of a block between two participants", async () => {
    expect(await collabChatHiddenFor(AUTHOR, CHAT)).toBe(false);
    expect(await collabChatHiddenFor(PB, CHAT)).toBe(false);
    expect(await collabChatHiddenFor(PC, CHAT)).toBe(false);
  });

  it("never hides an ordinary group, a 1:1 or an id that isn't a chat", async () => {
    expect(await collabChatHiddenFor(PA, PLAIN)).toBe(false);
    expect(await collabChatHiddenFor(PA, DM)).toBe(false);
    expect(await collabChatHiddenFor(PA, ORPHAN)).toBe(false);
  });

  it("comes back as soon as the block is lifted", async () => {
    blocks = [];
    expect(await collabChatHiddenFor(PA, CHAT)).toBe(false);
  });

  it("is one query", async () => {
    await collabChatHiddenFor(PA, CHAT);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toEqual({
      where: { id: { in: [CHAT] }, ...collabChatHiddenWhere(PA) },
      select: { id: true },
    });
  });
});

describe("collabChatsHiddenFor (batch)", () => {
  it("answers a whole list with ONE query and returns only the hidden collab chats", async () => {
    expect(await collabChatsHiddenFor(PA, [CHAT, PLAIN, DM, CHAT])).toEqual(new Set([CHAT]));
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.id).toEqual({ in: [CHAT, PLAIN, DM] });
    expect(await collabChatsHiddenFor(PB, [CHAT, PLAIN])).toEqual(new Set());
  });

  it("asks nothing for an empty list", async () => {
    expect(await collabChatsHiddenFor(PA, [])).toEqual(new Set());
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("collabChatRecipientsOnly (fan-outs)", () => {
  it("drops everyone blocked either way with the collab's author, keeps the author and other participants", async () => {
    expect(await collabChatRecipientsOnly(CHAT, [AUTHOR, PA, PB, PC, PD])).toEqual([AUTHOR, PB, PC]);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(getBlockedEitherWayIds).toHaveBeenCalledWith(AUTHOR);
  });

  it("keeps everyone in a chat that belongs to no collab, with no block lookup", async () => {
    expect(await collabChatRecipientsOnly(PLAIN, [PA, PB])).toEqual([PA, PB]);
    expect(await collabChatRecipientsOnly(DM, [PA])).toEqual([PA]);
    expect(getBlockedEitherWayIds).not.toHaveBeenCalled();
  });

  it("asks nothing for nobody", async () => {
    expect(await collabChatRecipientsOnly(CHAT, [])).toEqual([]);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("collabChatHiddenSql (the Messages badge count)", () => {
  it("is the same rule in SQL: the chat's collab, author not the viewer, a Block either way", () => {
    const sql = collabChatHiddenSql(PA, Prisma.sql`cm."conversationId"`);
    expect(sql.sql).toContain(`FROM "CollabBoardPost" cb`);
    expect(sql.sql).toContain(`WHERE cb."conversationId" = cm."conversationId"`);
    expect(sql.sql).toContain(`AND cb."authorId" <> ?`);
    expect(sql.sql).toContain(`WHERE (b."blockerId" = cb."authorId" AND b."blockedId" = ?)`);
    expect(sql.sql).toContain(`OR (b."blockerId" = ? AND b."blockedId" = cb."authorId")`);
    expect(sql.values).toEqual([PA, PA, PA]);
  });
});
