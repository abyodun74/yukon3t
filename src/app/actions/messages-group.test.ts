import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminGroupDeleteReason,
  blockBetweenWhere,
  canAnswerJoinRequest,
  groupJoinRequestRefusal,
  groupMembersEligible,
} from "@/lib/group-chat-rules";

// Group chat controls (actions/messages.ts + src/lib/group-chat-rules.ts): joining by request only for a discoverable
// group and never across a block, rate-limited; adding members only ACTIVE and unblocked people; answering a join
// request only while it is PENDING, re-checking the requester; an admin deleting someone else's group is audit-logged.

const ME = "cme00000000001"; // the group's creator
const ADMIN = "cad00000000001";
const BO = "cbo00000000001"; // already in the group
const CY = "ccy00000000001"; // a connection of ME
const DI = "cdi00000000001"; // suspended
const EV = "cev00000000001"; // blocked by BO
const GROUP = "cgr00000000001";
const PRIVATE_GROUP = "cgr00000000002";
const DM = "cdm00000000001";

let caller = { id: ME, isAdmin: false };
let limited = false;
const status: Record<string, string> = { [ME]: "ACTIVE", [ADMIN]: "ACTIVE", [BO]: "ACTIVE", [CY]: "ACTIVE", [DI]: "SUSPENDED", [EV]: "ACTIVE" };
const blocks: [string, string][] = [[BO, EV]];
type Conv = { id: string; isGroup: boolean; discoverable: boolean; name: string; createdById: string | null; members: string[] };
let conversations: Conv[] = [];
type JoinReq = { id: string; conversationId: string; userId: string; status: string };
let requests: JoinReq[] = [];
const memberCreateMany = vi.fn();
const memberUpsert = vi.fn();
const joinCreate = vi.fn();
const auditCreate = vi.fn((a: unknown) => a);
const conversationDelete = vi.fn((a: unknown) => a);

const isBlocked = (a: string, b: string) => blocks.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => caller }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => !limited }));
vi.mock("@/lib/moderation", () => ({ moderateText: vi.fn(), moderateMedia: vi.fn() }));
vi.mock("@/lib/storage", () => ({ MEDIA_LIMITS: {}, verifyUploadedSize: vi.fn(), keyFromPublicUrl: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateConversationEmbedding: vi.fn() }));
vi.mock("@/lib/translation-server", () => ({ deleteTranslationsOf: vi.fn() }));
vi.mock("@/lib/view-once-media", () => ({ destroyViewOnceMedia: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn(), publishEvents: vi.fn() }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({ isMembershipLocked: vi.fn(), isConversationLocked: vi.fn() }));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (a: string, b: string) => isBlocked(a, b),
  isBlockedWithAny: async (a: string, others: string[]) => others.some((o) => isBlocked(a, o)),
  getBlockedEitherWayIds: async () => new Set(),
}));

type In = { in: string[] };
vi.mock("@/lib/prisma", () => {
  const conv = (id: string) => conversations.find((c) => c.id === id) ?? null;
  const prisma = {
    conversation: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: { members?: unknown } }) => {
        const c = conv(where.id);
        if (!c) return null;
        return { ...c, members: c.members.map((userId) => ({ userId })), ...(select ? {} : {}) };
      },
      delete: (a: unknown) => conversationDelete(a),
    },
    conversationMember: {
      createMany: (a: unknown) => memberCreateMany(a),
      count: async ({ where }: { where: { conversationId: string } }) => conv(where.conversationId)?.members.length ?? 0,
      upsert: (a: unknown) => memberUpsert(a),
    },
    connection: {
      count: async ({ where }: { where: { OR: unknown[] } }) => where.OR.length,
    },
    user: {
      count: async ({ where }: { where: { id: In; status: string } }) =>
        where.id.in.filter((id) => status[id] === where.status).length,
    },
    block: {
      findFirst: async ({ where }: { where: { OR: { blockerId: In; blockedId: In }[] } }) =>
        blocks.some(([x, y]) => where.OR.some((w) => w.blockerId.in.includes(x) && w.blockedId.in.includes(y)))
          ? { id: "b" }
          : null,
    },
    groupJoinRequest: {
      findUnique: async ({ where }: { where: { id?: string; conversationId_userId?: { conversationId: string; userId: string } } }) => {
        const r = where.id
          ? requests.find((x) => x.id === where.id)
          : requests.find(
              (x) =>
                x.conversationId === where.conversationId_userId!.conversationId &&
                x.userId === where.conversationId_userId!.userId,
            );
        if (!r) return null;
        const c = conv(r.conversationId)!;
        return { ...r, conversation: { isGroup: c.isGroup, createdById: c.createdById, members: c.members.map((userId) => ({ userId })) } };
      },
      create: (a: unknown) => joinCreate(a),
      update: vi.fn(),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
        const r = requests.find((x) => x.id === where.id && x.status === where.status);
        if (!r) return { count: 0 };
        r.status = data.status;
        return { count: 1 };
      },
    },
    auditLog: { create: (a: unknown) => auditCreate(a) },
    notification: { createMany: vi.fn() },
    $transaction: async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])),
  };
  return { prisma };
});

const { requestToJoinGroup, respondToJoinRequest, addGroupMembers, deleteGroupChat } = await import("./messages");

function members(...ids: string[]) {
  const fd = new FormData();
  for (const id of ids) fd.append("memberIds", id);
  return fd;
}

beforeEach(() => {
  caller = { id: ME, isAdmin: false };
  limited = false;
  conversations = [
    { id: GROUP, isGroup: true, discoverable: true, name: "Hikers", createdById: ME, members: [ME, BO] },
    { id: PRIVATE_GROUP, isGroup: true, discoverable: false, name: "Family", createdById: ME, members: [ME, BO] },
    { id: DM, isGroup: false, discoverable: false, name: "", createdById: null, members: [ME, BO] },
  ];
  requests = [];
  for (const fn of [memberCreateMany, memberUpsert, joinCreate, auditCreate, conversationDelete]) fn.mockClear();
});

describe("group-chat-rules", () => {
  it("lets a non-member ask to join only a discoverable group they share no block with", () => {
    const base = { isGroup: true, discoverable: true, isMember: false, blockedWithAMember: false };
    expect(groupJoinRequestRefusal(base)).toBeNull();
    expect(groupJoinRequestRefusal({ ...base, discoverable: false })).toBe("not_found");
    expect(groupJoinRequestRefusal({ ...base, blockedWithAMember: true })).toBe("not_found");
    expect(groupJoinRequestRefusal({ ...base, isGroup: false })).toBe("not_found");
    expect(groupJoinRequestRefusal({ ...base, isMember: true })).toBe("already_member");
  });

  it("answers only PENDING requests and admits only active, unblocked people", () => {
    expect(canAnswerJoinRequest("PENDING")).toBe(true);
    expect(canAnswerJoinRequest("APPROVED")).toBe(false);
    expect(canAnswerJoinRequest("DECLINED")).toBe(false);
    expect(groupMembersEligible({ newIds: [CY], activeCount: 1, blockBetween: false })).toBe(true);
    expect(groupMembersEligible({ newIds: [CY, DI], activeCount: 1, blockBetween: false })).toBe(false);
    expect(groupMembersEligible({ newIds: [CY], activeCount: 1, blockBetween: true })).toBe(false);
    expect(groupMembersEligible({ newIds: [], activeCount: 0, blockBetween: false })).toBe(false);
    expect(blockBetweenWhere([CY], [ME, CY]).OR).toHaveLength(2);
    expect(adminGroupDeleteReason({ id: GROUP, name: "Hikers", memberCount: 2 })).toContain(GROUP);
  });
});

describe("requestToJoinGroup", () => {
  it("files a request for a discoverable group", async () => {
    caller = { id: CY, isAdmin: false };
    expect(await requestToJoinGroup(GROUP)).toEqual({ error: null });
    expect(joinCreate).toHaveBeenCalledWith({ data: { conversationId: GROUP, userId: CY } });
  });

  it("refuses a non-discoverable group, a DM and a group with someone blocked either way, all as not_found", async () => {
    caller = { id: CY, isAdmin: false };
    expect(await requestToJoinGroup(PRIVATE_GROUP)).toEqual({ error: "not_found" });
    expect(await requestToJoinGroup(DM)).toEqual({ error: "not_found" });
    caller = { id: EV, isAdmin: false };
    expect(await requestToJoinGroup(GROUP)).toEqual({ error: "not_found" });
    expect(joinCreate).not.toHaveBeenCalled();
  });

  it("is rate-limited", async () => {
    caller = { id: CY, isAdmin: false };
    limited = true;
    expect(await requestToJoinGroup(GROUP)).toEqual({ error: "rate_limited" });
    expect(joinCreate).not.toHaveBeenCalled();
  });
});

describe("addGroupMembers", () => {
  it("adds an active, unblocked connection", async () => {
    expect(await addGroupMembers(GROUP, members(CY))).toEqual({ error: null });
    expect(memberCreateMany).toHaveBeenCalledTimes(1);
  });

  it("refuses an inactive account or someone blocked either way with a member, without saying which", async () => {
    expect(await addGroupMembers(GROUP, members(DI))).toEqual({ error: "unavailable" });
    expect(await addGroupMembers(GROUP, members(EV))).toEqual({ error: "unavailable" });
    expect(await addGroupMembers(GROUP, members(CY, EV))).toEqual({ error: "unavailable" });
    expect(memberCreateMany).not.toHaveBeenCalled();
  });
});

describe("respondToJoinRequest", () => {
  it("approves a pending request once; a second answer changes nothing", async () => {
    requests = [{ id: "r1", conversationId: GROUP, userId: CY, status: "PENDING" }];
    expect(await respondToJoinRequest("r1", true)).toEqual({ error: null });
    expect(memberUpsert).toHaveBeenCalledTimes(1);
    expect(requests[0].status).toBe("APPROVED");
    expect(await respondToJoinRequest("r1", true)).toEqual({ error: "not_found" });
    expect(await respondToJoinRequest("r1", false)).toEqual({ error: "not_found" });
    expect(memberUpsert).toHaveBeenCalledTimes(1);
    expect(requests[0].status).toBe("APPROVED");
  });

  it("never re-adds someone whose request was already declined", async () => {
    requests = [{ id: "r1", conversationId: GROUP, userId: CY, status: "DECLINED" }];
    expect(await respondToJoinRequest("r1", true)).toEqual({ error: "not_found" });
    expect(memberUpsert).not.toHaveBeenCalled();
  });

  it("re-checks the requester at approval: suspended or now blocked with a member is declined, not added", async () => {
    requests = [
      { id: "r1", conversationId: GROUP, userId: DI, status: "PENDING" },
      { id: "r2", conversationId: GROUP, userId: EV, status: "PENDING" },
    ];
    expect(await respondToJoinRequest("r1", true)).toEqual({ error: "unavailable" });
    expect(await respondToJoinRequest("r2", true)).toEqual({ error: "unavailable" });
    expect(memberUpsert).not.toHaveBeenCalled();
    expect(requests.map((r) => r.status)).toEqual(["DECLINED", "DECLINED"]);
  });

  it("is creator-only", async () => {
    requests = [{ id: "r1", conversationId: GROUP, userId: CY, status: "PENDING" }];
    caller = { id: BO, isAdmin: false };
    expect(await respondToJoinRequest("r1", true)).toEqual({ error: "forbidden" });
  });
});

describe("deleteGroupChat", () => {
  it("writes an AuditLog row when a site admin deletes someone else's group", async () => {
    caller = { id: ADMIN, isAdmin: true };
    await deleteGroupChat(GROUP);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetId: ME, action: "CONTENT_REMOVED", performedBy: ADMIN }),
    });
    expect(conversationDelete).toHaveBeenCalledWith({ where: { id: GROUP } });
  });

  it("writes none when the creator deletes their own group", async () => {
    await deleteGroupChat(GROUP);
    expect(auditCreate).not.toHaveBeenCalled();
    expect(conversationDelete).toHaveBeenCalledTimes(1);
  });

  it("still refuses a non-admin non-creator", async () => {
    caller = { id: BO, isAdmin: false };
    expect(await deleteGroupChat(GROUP)).toEqual({ error: "forbidden" });
    expect(conversationDelete).not.toHaveBeenCalled();
  });
});
