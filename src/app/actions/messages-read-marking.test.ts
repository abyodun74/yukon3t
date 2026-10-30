import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// getConversationMessages' read marking: the two receipts updates only look at messages from shortly before the
// caller's own lastReadAt onwards, run in one transaction with the lastReadAt write, and that write only happens when
// someone else's message is newer than it.

const ME = "cme00000000001";
const CONV = "cconv000000001";
const user = { id: ME, name: "Me", isAdmin: false };

let membership: { hiddenAt: Date | null; lastReadAt: Date | null } | null = null;
let locked = false;
const updateMany = vi.fn();
const executeRaw = vi.fn();
const transaction = vi.fn();
const publishEvent = vi.fn();

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
vi.mock("@/lib/realtime-server", () => ({ publishEvent: (...a: unknown[]) => publishEvent(...a), publishEvents: vi.fn() }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: vi.fn() }));
vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: vi.fn(), getBlockedEitherWayIds: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({
  isMembershipLocked: async () => locked,
  isConversationLocked: vi.fn(async () => false),
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
  transaction.mockResolvedValue([{ count: 0 }, { count: 0 }, 0]);
});

describe("getConversationMessages read marking", () => {
  it("marks delivered/read only from 10 minutes before lastReadAt, in one transaction with the lastReadAt write", async () => {
    const result = await getConversationMessages(CONV);
    expect(result.error).toBeNull();
    expect(result.messages.map((m) => m.id)).toEqual(["m1", "m2"]);

    expect(transaction).toHaveBeenCalledTimes(1);
    const ops = transaction.mock.calls[0][0] as { kind: string }[];
    expect(ops.map((o) => o.kind)).toEqual(["updateMany", "updateMany", "executeRaw"]);

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

    transaction.mockResolvedValueOnce([{ count: 0 }, { count: 2 }, 1]);
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
  });
});
