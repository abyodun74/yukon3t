import { beforeEach, describe, expect, it, vi } from "vitest";

// findDirectConversationIds / findDirectConversationId (lib/direct-conversation.ts) against an in-memory conversation
// table that evaluates the helper's own `where` and `orderBy`: only a genuine 1:1 (isGroup false, exactly the viewer and
// that person) is ever returned, a shared group or collab chat never is, duplicates resolve to the oldest, the collab
// chat filter stays in the query, and a whole page of people costs one query.

const ME = "cme00000000001";

type Conv = {
  id: string;
  isGroup: boolean;
  createdAt: Date;
  members: string[];
  /** Viewers a block with the collab's author hides this chat from (collabChatHiddenWhere). */
  collabHiddenFrom?: string[];
  e2ee?: boolean;
};

let conversations: Conv[] = [];

type UserIdCond = string | { in: string[] };
type Part = {
  members?: { some?: { userId: UserIdCond }; every?: { userId: UserIdCond } };
  NOT?: { collabBoardPost: { is: { authorId: { not: string } } } };
};
type Args = {
  where: { isGroup?: boolean; AND?: Part[] };
  select: unknown;
  orderBy?: Array<{ createdAt?: "asc" | "desc"; id?: "asc" | "desc" }>;
};

const idMatches = (cond: UserIdCond, userId: string) => (typeof cond === "string" ? cond === userId : cond.in.includes(userId));

function matches(c: Conv, where: Args["where"]): boolean {
  if (where.isGroup !== undefined && c.isGroup !== where.isGroup) return false;
  for (const part of where.AND ?? []) {
    if (part.members?.some && !c.members.some((u) => idMatches(part.members!.some!.userId, u))) return false;
    if (part.members?.every && !c.members.every((u) => idMatches(part.members!.every!.userId, u))) return false;
    if (part.NOT && (c.collabHiddenFrom ?? []).includes(part.NOT.collabBoardPost.is.authorId.not)) return false;
  }
  return true;
}

const findMany = vi.fn(async (args: Args) => {
  const rows = conversations.filter((c) => matches(c, args.where));
  const order = args.orderBy ?? [];
  rows.sort((a, b) => {
    for (const key of order) {
      if (key.createdAt) {
        const d = a.createdAt.getTime() - b.createdAt.getTime();
        if (d !== 0) return key.createdAt === "asc" ? d : -d;
      }
      if (key.id) {
        const d = a.id.localeCompare(b.id);
        if (d !== 0) return key.id === "asc" ? d : -d;
      }
    }
    return 0;
  });
  return rows.map((c) => ({ id: c.id, members: c.members.map((userId) => ({ userId })) }));
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ notifyBadgeChange: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { conversation: { findMany: (args: Args) => findMany(args) } } }));

const { findDirectConversationIds, findDirectConversationId } = await import("@/lib/direct-conversation");
const { collabChatVisibleWhere } = await import("@/lib/collab-visibility");

const at = (day: number) => new Date(Date.UTC(2026, 0, day));
const dm = (id: string, other: string, day: number, extra: Partial<Conv> = {}): Conv => ({
  id,
  isGroup: false,
  createdAt: at(day),
  members: [ME, other],
  ...extra,
});
const group = (id: string, members: string[], day: number, extra: Partial<Conv> = {}): Conv => ({
  id,
  isGroup: true,
  createdAt: at(day),
  members: [ME, ...members],
  ...extra,
});

beforeEach(() => {
  conversations = [];
  findMany.mockClear();
});

describe("findDirectConversationIds: only a genuine 1:1", () => {
  it("picks the 1:1 even when a shared group chat is older", async () => {
    conversations = [group("grp-old", ["ca"], 1), dm("dm-a", "ca", 5)];
    expect(await findDirectConversationIds(ME, ["ca"])).toEqual(new Map([["ca", "dm-a"]]));
  });

  it("picks the 1:1 even when a shared group chat is newer", async () => {
    conversations = [dm("dm-a", "ca", 1), group("grp-new", ["ca"], 9)];
    expect(await findDirectConversationIds(ME, ["ca"])).toEqual(new Map([["ca", "dm-a"]]));
  });

  it("returns nothing (never the group) when the two only share a group or collab chat", async () => {
    conversations = [group("grp", ["ca"], 1), group("collab-chat", ["ca", "cb"], 2), group("two-person-group", [], 3)];
    conversations[2].members = [ME, "ca"]; // a group that happens to have just the two of them is still a group
    const map = await findDirectConversationIds(ME, ["ca"]);
    expect(map.size).toBe(0);
    expect(await findDirectConversationId(ME, "ca")).toBeNull();
  });

  it("returns nothing for a person with no chat at all, and doesn't query for an empty page", async () => {
    conversations = [dm("dm-a", "ca", 1)];
    expect((await findDirectConversationIds(ME, ["cz"])).has("cz")).toBe(false);
    findMany.mockClear();
    expect((await findDirectConversationIds(ME, [])).size).toBe(0);
    expect((await findDirectConversationIds(ME, [ME])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("ignores a non-group row that isn't exactly the two of them, and other people's 1:1s", async () => {
    conversations = [
      { id: "odd-3", isGroup: false, createdAt: at(1), members: [ME, "ca", "cb"] },
      { id: "theirs", isGroup: false, createdAt: at(1), members: ["ca", "cb"] },
      { id: "solo", isGroup: false, createdAt: at(1), members: [ME] },
    ];
    expect((await findDirectConversationIds(ME, ["ca", "cb"])).size).toBe(0);
  });

  it("still returns a secret (end-to-end encrypted) 1:1", async () => {
    conversations = [dm("secret", "ca", 1, { e2ee: true })];
    expect(await findDirectConversationId(ME, "ca")).toBe("secret");
  });
});

describe("findDirectConversationIds: duplicates", () => {
  it("picks the oldest 1:1 for a pair, whatever order the rows come in", async () => {
    conversations = [dm("dm-new", "ca", 9), dm("dm-old", "ca", 2), dm("dm-mid", "ca", 5)];
    expect(await findDirectConversationId(ME, "ca")).toBe("dm-old");
    conversations.reverse();
    expect(await findDirectConversationId(ME, "ca")).toBe("dm-old");
  });

  it("breaks a createdAt tie by id", async () => {
    conversations = [dm("dm-b", "ca", 3), dm("dm-a", "ca", 3)];
    expect(await findDirectConversationId(ME, "ca")).toBe("dm-a");
  });
});

describe("findDirectConversationIds: filters and cost", () => {
  it("keeps the collab-chat block filter in the query", async () => {
    conversations = [dm("dm-a", "ca", 1, { collabHiddenFrom: [ME] })];
    expect((await findDirectConversationIds(ME, ["ca"])).size).toBe(0);
    expect(findMany.mock.calls[0][0].where.AND).toContainEqual(collabChatVisibleWhere(ME));
  });

  it("doesn't filter PIN-hidden chats itself (the thread page sends a locked viewer to the PIN prompt)", async () => {
    // Nothing in the query looks at ConversationMember.hiddenAt: the lists that must drop a hidden peer drop the peer.
    await findDirectConversationIds(ME, ["ca"]);
    expect(JSON.stringify(findMany.mock.calls[0][0])).not.toMatch(/hiddenAt/);
  });

  it("answers a whole page of people with ONE query, mapping each to their own 1:1", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `cp${String(i).padStart(2, "0")}`);
    conversations = [
      ...ids.filter((_, i) => i % 2 === 0).map((id, i) => dm(`dm-${id}`, id, i + 1)),
      group("big-group", ids, 0),
    ];
    const map = await findDirectConversationIds(ME, [...ids, ids[0], ME]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(15);
    for (const [otherId, conversationId] of map) expect(conversationId).toBe(`dm-${otherId}`);
    // The query is narrowed to the viewer plus this page (deduplicated, without the viewer as an "other").
    const where = findMany.mock.calls[0][0].where;
    expect(where.isGroup).toBe(false);
    expect(where.AND![1]).toEqual({ members: { some: { userId: { in: ids } } } });
    expect(where.AND![2]).toEqual({ members: { every: { userId: { in: [ME, ...ids] } } } });
  });

  it("findDirectConversationId is the same lookup for one person", async () => {
    conversations = [group("grp", ["ca"], 1), dm("dm-a", "ca", 2)];
    expect(await findDirectConversationId(ME, "ca")).toBe("dm-a");
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
