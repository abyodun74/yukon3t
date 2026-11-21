import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// getConversationMessages' read marking: the two receipts updates only look at messages from shortly before the
// caller's own lastReadAt onwards, run in one transaction with the lastReadAt write, and that write only happens when
// someone else's message is newer than it. The same transaction marks the caller's MESSAGE bell rows for this chat
// (and only this chat) read, and the caller's own badges are signalled whenever lastReadAt moved or a row cleared.
// Regression (2026-11): neither happened, so the Messages tab badge stayed lit until a focus resync, and a message
// that arrived while the thread was open (or any message in a Collab chat, opened on /collab/<id>) kept its bell row.

const ME = "cme00000000001";
const CONV = "cconv000000001";
const user = { id: ME, name: "Me", isAdmin: false };

let membership: { hiddenAt: Date | null; lastReadAt: Date | null } | null = null;
let locked = false;
const updateMany = vi.fn();
const executeRaw = vi.fn();
const transaction = vi.fn();
const publishEvent = vi.fn();
const notifyBadgeChange = vi.fn();
const notificationUpdateMany = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({ moderateText: vi.fn(), moderateMedia: vi.fn() }));
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
vi.mock("@/lib/realtime-server", () => ({
  publishEvent: (...a: unknown[]) => publishEvent(...a),
  publishEvents: vi.fn(),
  notifyBadgeChange: (id: string) => notifyBadgeChange(id),
}));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: vi.fn() }));
vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: vi.fn(), getBlockedEitherWayIds: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({
  isMembershipLocked: async () => locked,
  isConversationLocked: vi.fn(async () => false),
}));
// No collab group chats in these tests (the collab group-chat block rule is covered in collab-chat-visibility.test.ts).
vi.mock("@/lib/collab-chat-visibility-server", () => ({
  collabChatHiddenFor: async () => false,
  collabChatsHiddenFor: async () => new Set<string>(),
  collabChatRecipientsOnly: async (_conversationId: string, ids: Iterable<string>) => [...ids],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationMember: { findUnique: async () => membership },
    message: {
      updateMany: (args: unknown) => {
        updateMany(args);
        return { kind: "updateMany", args };
      },
      findMany: async () => [{ id: "m2" }, { id: "m1" }],
    },
    notification: {
      updateMany: (args: unknown) => {
        notificationUpdateMany(args);
        return { kind: "notificationUpdateMany", args };
      },
    },
    conversation: { findUnique: async () => ({ isGroup: false, name: null, members: [] }) },
    $executeRaw: (...call: unknown[]) => {
      executeRaw(...call);
      return { kind: "executeRaw" };
    },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}));

import { getConversationMessages } from "@/app/actions/messages";

function rawSql(call: unknown[]) {
  const [strings, ...values] = call as [readonly string[], ...unknown[]];
  const query = Prisma.sql(strings, ...values);
  return { sql: query.sql.replace(/\s+/g, " "), values: query.values };
}

beforeEach(() => {
  vi.clearAllMocks();
  locked = false;
  membership = { hiddenAt: null, lastReadAt: new Date("2026-10-01T12:00:00Z") };
  transaction.mockResolvedValue([{ count: 0 }, { count: 0 }, 0, { count: 0 }]);
});

describe("getConversationMessages read marking", () => {
  it("marks delivered/read only from 10 minutes before lastReadAt, in one transaction with the lastReadAt write", async () => {
    const result = await getConversationMessages(CONV);
    expect(result.error).toBeNull();
    expect(result.messages.map((m) => m.id)).toEqual(["m1", "m2"]);

    expect(transaction).toHaveBeenCalledTimes(1);
    const ops = transaction.mock.calls[0][0] as { kind: string }[];
    expect(ops.map((o) => o.kind)).toEqual(["updateMany", "updateMany", "executeRaw", "notificationUpdateMany"]);

    const markFrom = new Date("2026-10-01T11:50:00Z");
    const scope = { conversationId: CONV, senderId: { not: ME }, createdAt: { gte: markFrom } };
    expect(updateMany.mock.calls[0][0]).toMatchObject({ where: { ...scope, deliveredAt: null } });
    expect(updateMany.mock.calls[1][0]).toMatchObject({ where: { ...scope, readAt: null } });
  });

  it("scans the whole conversation the first time (no lastReadAt yet)", async () => {
    membership = { hiddenAt: null, lastReadAt: null };
    await getConversationMessages(CONV);
    const gte = (updateMany.mock.calls[0][0] as { where: { createdAt: { gte: Date } } }).where.createdAt.gte;
    expect(gte.getTime()).toBeLessThanOrEqual(0);
  });

  it("writes lastReadAt only when someone else's message is newer than it", async () => {
    await getConversationMessages(CONV);
    const { sql, values } = rawSql(executeRaw.mock.calls[0]);
    expect(sql).toContain(`UPDATE "ConversationMember" cm SET "lastReadAt" = ?`);
    expect(sql).toContain(`m."senderId" <> cm."userId"`);
    expect(sql).toContain(`(cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")`);
    expect(values.slice(1)).toEqual([CONV, ME]);
  });

  it("publishes the receipts signal only when a receipt changed", async () => {
    await getConversationMessages(CONV);
    expect(publishEvent).not.toHaveBeenCalled();

    transaction.mockResolvedValueOnce([{ count: 0 }, { count: 2 }, 1, { count: 0 }]);
    await getConversationMessages(CONV);
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  it("marks nothing for a locked hidden chat or a non-member", async () => {
    locked = true;
    expect((await getConversationMessages(CONV)).error).toBe("hidden_locked");
    locked = false;
    membership = null;
    expect((await getConversationMessages(CONV)).error).toBe("not_a_member");
    expect(transaction).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(notificationUpdateMany).not.toHaveBeenCalled();
    expect(notifyBadgeChange).not.toHaveBeenCalled();
  });

  it("marks read only the caller's MESSAGE rows of this conversation", async () => {
    await getConversationMessages(CONV);
    expect(notificationUpdateMany).toHaveBeenCalledTimes(1);
    const args = notificationUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: { readAt: Date } };
    expect(args.where).toEqual({ recipientId: ME, conversationId: CONV, type: "MESSAGE", readAt: null });
    expect(args.data.readAt).toBeInstanceOf(Date);
  });

  it("signals the caller's badges when lastReadAt moved or a bell row cleared, and only then", async () => {
    await getConversationMessages(CONV);
    expect(notifyBadgeChange).not.toHaveBeenCalled();

    // Opened with a new message in it: lastReadAt moves (the Messages tab count drops).
    transaction.mockResolvedValueOnce([{ count: 1 }, { count: 1 }, 1, { count: 0 }]);
    await getConversationMessages(CONV);
    expect(notifyBadgeChange).toHaveBeenCalledTimes(1);
    expect(notifyBadgeChange).toHaveBeenLastCalledWith(ME);

    // Already read up to date but its bell rows were still unread (the bell count drops).
    transaction.mockResolvedValueOnce([{ count: 0 }, { count: 0 }, 0, { count: 3 }]);
    await getConversationMessages(CONV);
    expect(notifyBadgeChange).toHaveBeenCalledTimes(2);
  });
});
