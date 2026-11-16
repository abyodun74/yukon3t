import { beforeEach, describe, expect, it, vi } from "vitest";

// A collab's group chat doesn't exist for someone blocked either way with the collab's author (lib/collab-visibility.ts,
// collab-chat-visibility-server.ts). Every message action in actions/messages.ts that takes a conversation or message
// id answers such a member exactly what it answers someone who isn't in the chat, writes nothing and marks nothing
// read; the author, other participants and ordinary groups are unaffected; leaveGroup stays ungated server-side (they
// have no UI entry point to it). The real decision (collabChatHiddenFor, collabChatVisibleWhere) runs against a small
// in-memory database below.

const AUTHOR = "cau00000000001"; // the collab's author, created its chat
const PA = "cpa00000000001"; // participant the author blocked
const PB = "cpb00000000001"; // participant, no block
const PC = "cpc00000000001"; // participant blocked by PB only (a block between two participants)
const OUT = "cout0000000001"; // not in the chat at all
const ADMIN = "cadm0000000001"; // site admin, not in the chat
const CHAT = "cchat000000001"; // the collab's group chat
const PLAIN = "cplain00000001"; // an ordinary group chat with the same people
const M_AUTHOR = "cmau0000000001"; // AUTHOR's message in CHAT
const M_PA = "cmpa0000000001"; // PA's message in CHAT
const M_PLAIN = "cmpl0000000001"; // PA's message in PLAIN
const CORR = "ccor0000000001"; // PA's correction on M_AUTHOR
const JR = "cjr00000000001"; // OUT's pending join request on CHAT

type Member = { userId: string; hiddenAt: Date | null; lastReadAt: Date | null; e2eeEnabledAt: Date | null };
type Conv = { id: string; isGroup: boolean; discoverable: boolean; name: string; createdById: string | null; members: Member[] };
type Msg = { id: string; conversationId: string; senderId: string; content: string };

let caller = { id: PA, name: "Pa", isAdmin: false };
let conversations: Conv[] = [];
let messages: Msg[] = [];
let blocks: [string, string][] = [];
const collabAuthorByChat = new Map<string, string>([[CHAT, AUTHOR]]);

const writes = vi.fn();
const afterMessageSent = vi.fn();
const publishEvent = vi.fn();

const member = (userId: string, over: Partial<Member> = {}): Member => ({
  userId,
  hiddenAt: null,
  lastReadAt: null,
  e2eeEnabledAt: null,
  ...over,
});
const conv = (id: string) => conversations.find((c) => c.id === id) ?? null;
const isBlocked = (a: string, b: string) => blocks.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

type HiddenIs = {
  authorId: { not: string };
  author: { OR: [{ blocksMade: { some: { blockedId: string } } }, { blocksReceived: { some: { blockerId: string } } }] };
};
/** Evaluates collabChatHiddenWhere's relation filter against the in-memory collabs and blocks. */
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
    const ok = c.members.some(
      (m) =>
        (s.userId === undefined || m.userId === s.userId) &&
        (s.hiddenAt === undefined || (s.hiddenAt === null ? m.hiddenAt === null : m.hiddenAt !== null)),
    );
    if (!ok) return false;
  }
  if (where.collabBoardPost && !collabHiddenMatch(c.id, where.collabBoardPost.is)) return false;
  if (where.NOT && (Array.isArray(where.NOT) ? where.NOT : [where.NOT]).some((n: unknown) => convMatches(c, n))) return false;
  if (where.AND && !where.AND.every((a: unknown) => convMatches(c, a))) return false;
  return true;
}
const withUsers = (c: Conv) => ({
  ...c,
  members: c.members.map((m) => ({
    ...m,
    user: { id: m.userId, name: m.userId, username: m.userId, avatarUrl: null, status: "ACTIVE" },
  })),
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => caller }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({
  moderateText: async () => ({ allowed: true }),
  moderateMedia: async () => ({ allowed: true }),
}));
vi.mock("@/lib/storage", () => ({ MEDIA_LIMITS: {}, verifyUploadedSize: vi.fn(), keyFromPublicUrl: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateConversationEmbedding: vi.fn() }));
vi.mock("@/lib/translation-server", () => ({ deleteTranslationsOf: vi.fn() }));
vi.mock("@/lib/view-once-media", () => ({ destroyViewOnceMedia: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: (...a: unknown[]) => publishEvent(...a), publishEvents: vi.fn() }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: (a: unknown) => afterMessageSent(a) }));
vi.mock("@/lib/hidden-chats", () => ({
  isMembershipLocked: async (m: { hiddenAt: Date | null }) => m.hiddenAt !== null,
  isConversationLocked: async (userId: string, conversationId: string) =>
    Boolean(conv(conversationId)?.members.find((m) => m.userId === userId)?.hiddenAt),
}));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (a: string, b: string) => isBlocked(a, b),
  isBlockedWithAny: async (a: string, others: string[]) => others.some((o) => isBlocked(a, o)),
  getBlockedEitherWayIds: async (a: string) =>
    new Set(blocks.flatMap(([x, y]) => (x === a ? [y] : y === a ? [x] : []))),
}));
vi.mock("@/lib/prisma", () => {
  const record =
    (what: string) =>
    async (...a: unknown[]) => {
      writes(what, ...a);
      return { count: 1, id: "new", conversationId: CHAT };
    };
  const prisma = {
    conversation: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where, select }: { where: { id: string }; select?: any }) => {
        const c = conv(where.id);
        if (!c) return null;
        if (select?.collabBoardPost) {
          const authorId = collabAuthorByChat.get(c.id);
          return { collabBoardPost: authorId ? { authorId } : null };
        }
        return withUsers(c);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: { where: any }) => conversations.filter((c) => convMatches(c, where)).map(withUsers),
      update: record("conversation.update"),
      delete: record("conversation.delete"),
    },
    conversationMember: {
      findUnique: async ({ where }: { where: { conversationId_userId: { conversationId: string; userId: string } } }) => {
        const { conversationId, userId } = where.conversationId_userId;
        const m = conv(conversationId)?.members.find((x) => x.userId === userId);
        return m ? { id: `${conversationId}:${userId}`, conversationId, ...m } : null;
      },
      // markMessagesDelivered (where: userId + conversation fragment) and leaveGroup's remaining members.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: { where: any }) => {
        if (where.userId) {
          return conversations
            .filter((c) => c.members.some((m) => m.userId === where.userId) && convMatches(c, where.conversation))
            .map((c) => ({ conversationId: c.id }));
        }
        return (conv(where.conversationId)?.members ?? []).map((m) => ({ userId: m.userId }));
      },
      count: async ({ where }: { where: { conversationId: string } }) => conv(where.conversationId)?.members.length ?? 0,
      deleteMany: record("conversationMember.deleteMany"),
      update: record("conversationMember.update"),
      updateMany: record("conversationMember.updateMany"),
      createMany: record("conversationMember.createMany"),
      upsert: record("conversationMember.upsert"),
    },
    message: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const m = messages.find((x) => x.id === where.id);
        if (!m) return null;
        return {
          ...m,
          mediaType: "NONE",
          mediaUrl: null,
          mediaThumbnailUrl: null,
          moderationStatus: "PUBLISHED",
          deletedForEveryoneAt: null,
          deletedForUserIds: [],
          viewOnce: false,
          giftSendId: null,
          storyId: null,
          conversation: { isGroup: true, members: conv(m.conversationId)!.members },
        };
      },
      findMany: async () => [],
      create: record("message.create"),
      update: record("message.update"),
      updateMany: record("message.updateMany"),
    },
    messageReaction: {
      findUnique: async () => null,
      findMany: async () => [],
      upsert: record("messageReaction.upsert"),
      delete: record("messageReaction.delete"),
      deleteMany: record("messageReaction.deleteMany"),
    },
    messageCorrection: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === CORR ? { id: CORR, messageId: M_AUTHOR, authorId: PA } : null,
      findMany: async () => [],
      upsert: record("messageCorrection.upsert"),
      delete: record("messageCorrection.delete"),
      deleteMany: record("messageCorrection.deleteMany"),
    },
    contentTranslation: { deleteMany: record("contentTranslation.deleteMany") },
    groupJoinRequest: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: { where: any }) => {
        if (where.id === JR) {
          const c = conv(CHAT)!;
          return {
            id: JR,
            status: "PENDING",
            userId: OUT,
            conversationId: CHAT,
            conversation: { isGroup: true, createdById: c.createdById, members: c.members.map((m) => ({ userId: m.userId })) },
          };
        }
        return null;
      },
      create: record("groupJoinRequest.create"),
      update: record("groupJoinRequest.update"),
      updateMany: record("groupJoinRequest.updateMany"),
    },
    connection: { count: async ({ where }: { where: { OR: unknown[] } }) => where.OR.length },
    user: { count: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length },
    block: { findFirst: async () => null },
    notification: { createMany: record("notification.createMany") },
    auditLog: { create: record("auditLog.create") },
    $executeRaw: record("$executeRaw"),
    // createNonE2eeMessage's locked re-read of the destination's members.
    $queryRaw: async (_sql: TemplateStringsArray, conversationId: string) =>
      (conv(conversationId)?.members ?? []).map((m) => ({ isGroup: conv(conversationId)!.isGroup, e2eeEnabledAt: m.e2eeEnabledAt })),
    $transaction: async (arg: unknown): Promise<unknown> =>
      typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
  };
  return { prisma };
});

const actions = await import("./messages");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const as = (id: string, isAdmin = false) => {
  caller = { id, name: id, isAdmin };
};

beforeEach(() => {
  vi.clearAllMocks();
  as(PA);
  blocks = [
    [AUTHOR, PA], // the author blocked PA
    [PB, PC], // two participants
  ];
  conversations = [
    {
      id: CHAT,
      isGroup: true,
      discoverable: true,
      name: "Collab chat",
      createdById: AUTHOR,
      members: [member(AUTHOR), member(PA), member(PB), member(PC)],
    },
    {
      id: PLAIN,
      isGroup: true,
      discoverable: false,
      name: "Plain group",
      createdById: AUTHOR,
      members: [member(AUTHOR), member(PA), member(PB)],
    },
  ];
  messages = [
    { id: M_AUTHOR, conversationId: CHAT, senderId: AUTHOR, content: "hello" },
    { id: M_PA, conversationId: CHAT, senderId: PA, content: "mine" },
    { id: M_PLAIN, conversationId: PLAIN, senderId: PA, content: "plain" },
  ];
});

/** What `run` answers PA (the chat is hidden from them) and OUT (not in it), with nothing written for PA. */
async function hiddenAndOutsider<T>(run: () => Promise<T>): Promise<{ hidden: T; outsider: T }> {
  as(PA);
  const hidden = await run();
  const paWrites = writes.mock.calls.length;
  as(OUT);
  const outsider = await run();
  expect(paWrites, "nothing written for the member the chat is hidden from").toBe(0);
  return { hidden, outsider };
}

describe("message actions on a collab chat hidden by a block with its author", () => {
  it("answer exactly what a non-member gets, and write nothing", async () => {
    const cases: [string, () => Promise<unknown>][] = [
      ["sendMessage", () => actions.sendMessage(form({ conversationId: CHAT, content: "hi" }))],
      ["getConversationMessages", () => actions.getConversationMessages(CHAT)],
      ["deleteMessageForMe", () => actions.deleteMessageForMe(M_AUTHOR)],
      ["toggleMessageReaction", () => actions.toggleMessageReaction(M_AUTHOR, "👍")],
      ["suggestCorrection", () => actions.suggestCorrection(M_AUTHOR, form({ correctedText: "hullo" }))],
      ["forwardMessage (source)", () => actions.forwardMessage(M_AUTHOR, [PLAIN])],
    ];
    for (const [name, run] of cases) {
      writes.mockClear();
      const { hidden, outsider } = await hiddenAndOutsider(run);
      expect(hidden, name).toEqual(outsider);
    }
    expect(afterMessageSent).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("refuse a join request as not_found, even once the author has left the chat (no member block to catch it)", async () => {
    expect(await actions.requestToJoinGroup(CHAT)).toEqual({ error: "not_found" });
    conv(CHAT)!.members = conv(CHAT)!.members.filter((m) => m.userId !== AUTHOR);
    blocks.push([AUTHOR, OUT]);
    as(OUT);
    expect(await actions.requestToJoinGroup(CHAT)).toEqual({ error: "not_found" });
    expect(writes).not.toHaveBeenCalled();
    blocks.pop();
    expect(await actions.requestToJoinGroup(CHAT)).toEqual({ error: null });
  });

  it("refuse the sender's own message in it with the generic not_found (edit, delete for everyone, remove correction)", async () => {
    expect(await actions.editMessage(M_PA, form({ content: "edited" }))).toEqual({ error: "not_found" });
    expect(await actions.deleteMessageForEveryone(M_PA)).toEqual({ error: "not_found" });
    expect(await actions.removeCorrection(CORR)).toEqual({ error: "not_found" });
    // ... the same answer as a message id that doesn't exist.
    expect(await actions.editMessage("cnope000000001", form({ content: "edited" }))).toEqual({ error: "not_found" });
    expect(writes).not.toHaveBeenCalled();
  });

  it("leave its lastReadAt and every message's read state alone (no read marking at all)", async () => {
    expect(await actions.getConversationMessages(CHAT)).toEqual({ error: "not_a_member", messages: [], conversation: null });
    expect(writes).not.toHaveBeenCalled();
  });

  it("are refused the same way when the member also hid the chat with the PIN (no hidden_locked tell)", async () => {
    conv(CHAT)!.members.find((m) => m.userId === PA)!.hiddenAt = new Date();
    expect(await actions.sendMessage(form({ conversationId: CHAT, content: "hi" }))).toEqual({ error: "not_a_member" });
    expect(await actions.getConversationMessages(CHAT)).toEqual({ error: "not_a_member", messages: [], conversation: null });
    expect(await actions.deleteMessageForMe(M_AUTHOR)).toEqual({ error: "not_a_member" });
    expect(await actions.editMessage(M_PA, form({ content: "x" }))).toEqual({ error: "not_found" });
    expect(writes).not.toHaveBeenCalled();
  });

  it("don't offer it as a share or forward destination, and a forward into it fails", async () => {
    const share = await actions.getMyConversationsForShare();
    expect(share.conversations.map((c) => c.id)).toEqual([PLAIN]);
    const targets = await actions.getForwardTargets();
    expect(targets.targets.map((t) => t.id)).toEqual([PLAIN]);
    expect(await actions.forwardMessage(M_PLAIN, [CHAT])).toEqual({ error: "unavailable" });
    expect(await actions.forwardMessage(M_PLAIN, [CHAT, PLAIN])).toEqual({ error: null, sent: 1, failed: 1 });
    // The one copy that went out went to the plain group.
    expect(afterMessageSent).toHaveBeenCalledTimes(1);
    expect(afterMessageSent.mock.calls[0][0]).toMatchObject({ conversationId: PLAIN });
  });

  it("never marks its messages delivered", async () => {
    await actions.markMessagesDelivered();
    const call = writes.mock.calls.find(([what]) => what === "message.updateMany");
    expect(call?.[1].where.conversationId.in).toEqual([PLAIN]);
  });

  it("refuse group management as not_found, also for a creator the chat is hidden from", async () => {
    // A participant (not the creator): the chat doesn't exist for them.
    expect(await actions.renameGroupChat(CHAT, form({ name: "New" }))).toEqual({ error: "not_found" });
    expect(await actions.setGroupDiscoverable(CHAT, false)).toEqual({ error: "not_found" });
    expect(await actions.addGroupMembers(CHAT, form({ memberIds: OUT }))).toEqual({ error: "not_found" });
    expect(await actions.respondToJoinRequest(JR, true)).toEqual({ error: "not_found" });
    // The author left, so PA became the chat's creator: still nothing.
    conv(CHAT)!.createdById = PA;
    expect(await actions.renameGroupChat(CHAT, form({ name: "New" }))).toEqual({ error: "not_found" });
    expect(await actions.respondToJoinRequest(JR, true)).toEqual({ error: "not_found" });
    expect(await actions.deleteGroupChat(CHAT)).toEqual({ error: "not_found" });
    expect(writes).not.toHaveBeenCalled();
  });

  it("still lets a site admin delete it from /admin/groups (moderation, not a member-facing surface)", async () => {
    as(ADMIN, true);
    await expect(actions.deleteGroupChat(CHAT)).rejects.toThrow("REDIRECT:/messages");
    expect(writes.mock.calls.map(([what]) => what)).toContain("conversation.delete");
  });

  it("don't gate leaveGroup server-side (like leaveCollab; no UI entry point for them): only their own membership goes", async () => {
    await expect(actions.leaveGroup(CHAT)).rejects.toThrow("REDIRECT:/messages");
    const deletes = writes.mock.calls.filter(([what]) => what === "conversationMember.deleteMany");
    expect(deletes).toHaveLength(1);
    expect(deletes[0][1]).toEqual({ where: { conversationId: CHAT, userId: PA } });
  });
});

describe("everyone else is unaffected", () => {
  it("the author keeps their own collab chat (send, read, react, edit)", async () => {
    as(AUTHOR);
    expect(await actions.sendMessage(form({ conversationId: CHAT, content: "hi" }))).toMatchObject({ error: null });
    expect(await actions.getConversationMessages(CHAT)).toMatchObject({ error: null });
    expect(await actions.toggleMessageReaction(M_PA, "👍")).toMatchObject({ error: null });
    expect(await actions.editMessage(M_AUTHOR, form({ content: "edited" }))).toMatchObject({ error: null });
    expect((await actions.getMyConversationsForShare()).conversations.map((c) => c.id).sort()).toEqual([CHAT, PLAIN].sort());
  });

  it("a participant blocked only by another participant (not the author) keeps the chat", async () => {
    as(PC);
    expect(await actions.sendMessage(form({ conversationId: CHAT, content: "hi" }))).toMatchObject({ error: null });
    expect(await actions.getConversationMessages(CHAT)).toMatchObject({ error: null });
    as(PB);
    expect(await actions.getConversationMessages(CHAT)).toMatchObject({ error: null });
  });

  it("an ordinary group with the same people is untouched for the blocked member", async () => {
    as(PA);
    expect(await actions.sendMessage(form({ conversationId: PLAIN, content: "hi" }))).toMatchObject({ error: null });
    expect(await actions.getConversationMessages(PLAIN)).toMatchObject({ error: null });
    expect(await actions.editMessage(M_PLAIN, form({ content: "edited" }))).toMatchObject({ error: null });
  });

  it("everything is back for PA once the block is lifted (nothing was changed)", async () => {
    blocks = [];
    as(PA);
    expect(await actions.getConversationMessages(CHAT)).toMatchObject({ error: null });
    expect((await actions.getMyConversationsForShare()).conversations.map((c) => c.id).sort()).toEqual([CHAT, PLAIN].sort());
  });
});
