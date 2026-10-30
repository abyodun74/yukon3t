import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { Prisma } from "@/generated/prisma/client";
import {
  countConversationsWithUnread,
  latestMessageAtByConversation,
  latestMessagesByConversation,
} from "@/lib/latest-messages";

function render(call: unknown[]) {
  const [strings, ...values] = call as [readonly string[], ...unknown[]];
  const query = Prisma.sql(strings, ...values);
  return { sql: query.sql.replace(/\s+/g, " "), values: query.values };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("latestMessagesByConversation", () => {
  it("asks for one row per conversation (LATERAL ... LIMIT 1), never every message", async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    await latestMessagesByConversation(["c1", "c2"]);
    const { sql, values } = render(db.$queryRaw.mock.calls[0]);
    expect(sql).toContain("CROSS JOIN LATERAL");
    expect(sql).toMatch(/WHERE "conversationId" = c\."id" ORDER BY "createdAt" DESC LIMIT 1/);
    expect(sql).toContain(`WHERE c."id" IN (?,?)`);
    expect(values).toEqual(["c1", "c2"]);
  });

  it("maps rows by conversation, absent for a chat with no messages", async () => {
    const at = new Date("2026-10-01T00:00:00Z");
    db.$queryRaw.mockResolvedValueOnce([
      { conversationId: "c1", createdAt: at, senderId: "u2", content: "hi", mediaType: "NONE", moderationStatus: "PUBLISHED" },
    ]);
    const map = await latestMessagesByConversation(["c1", "c2"]);
    expect(map.get("c1")).toEqual({
      conversationId: "c1",
      createdAt: at,
      senderId: "u2",
      content: "hi",
      mediaType: "NONE",
      moderationStatus: "PUBLISHED",
    });
    expect(map.has("c2")).toBe(false);
  });

  it("runs no query for no ids, and de-duplicates and chunks large lists", async () => {
    expect((await latestMessagesByConversation([])).size).toBe(0);
    expect(db.$queryRaw).not.toHaveBeenCalled();

    db.$queryRaw.mockResolvedValue([]);
    const ids = Array.from({ length: 1500 }, (_, i) => `c${i}`);
    await latestMessageAtByConversation([...ids, "c0"]);
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(render(db.$queryRaw.mock.calls[0]).values).toHaveLength(1000);
    expect(render(db.$queryRaw.mock.calls[1]).values).toHaveLength(500);
  });
});

describe("latestMessageAtByConversation", () => {
  it("returns only the newest time per chat", async () => {
    const at = new Date("2026-10-02T00:00:00Z");
    db.$queryRaw.mockResolvedValueOnce([{ conversationId: "c1", createdAt: at }]);
    const map = await latestMessageAtByConversation(["c1"]);
    expect(map.get("c1")).toEqual(at);
    expect(render(db.$queryRaw.mock.calls[0]).sql).toContain("LIMIT 1");
  });
});

describe("countConversationsWithUnread", () => {
  it("counts non-hidden memberships with a newer message from someone else not deleted for the user", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ unread: 3 }]);
    expect(await countConversationsWithUnread("me")).toBe(3);
    const { sql, values } = render(db.$queryRaw.mock.calls[0]);
    expect(sql).toContain(`cm."hiddenAt" IS NULL`);
    expect(sql).toContain(`m."senderId" <> ?`);
    expect(sql).toContain(`NOT (? = ANY (m."deletedForUserIds"))`);
    expect(sql).toContain(`(cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")`);
    expect(values).toEqual(["me", "me", "me"]);
  });

  it("is zero when nothing comes back", async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    expect(await countConversationsWithUnread("me")).toBe(0);
  });
});
