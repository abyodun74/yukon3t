import { beforeEach, describe, expect, it, vi } from "vitest";

// markReadByTarget pages through the caller's whole unread backlog (bounded), so a row for the opened target that is
// older than the newest few hundred still clears. Regression: it read only the 200 newest unread rows.

const ME = "cme00000000001";
const OTHER = "cother00000001";
const user = { id: ME };
const notifyBadgeChange = vi.fn();
const findManyCalls = vi.fn();

type Row = {
  id: string;
  recipientId: string;
  type: string;
  readAt: Date | null;
  createdAt: Date;
  actorId: string;
  conversationId: string | null;
  postId: string | null;
};
let rows: Row[] = [];

function inWhere(row: Row, where: Record<string, unknown>): boolean {
  if (where.recipientId !== undefined && row.recipientId !== where.recipientId) return false;
  if ("readAt" in where && where.readAt === null && row.readAt !== null) return false;
  const ids = (where.id as { in?: string[] } | undefined)?.in;
  if (ids && !ids.includes(row.id)) return false;
  const or = where.OR as { createdAt: { lt: Date } | Date; id?: { lt: string } }[] | undefined;
  if (or) {
    const [older, sameTime] = or;
    const lt = (older.createdAt as { lt: Date }).lt;
    const isOlder = row.createdAt < lt;
    const tieBreak = row.createdAt.getTime() === (sameTime.createdAt as Date).getTime() && row.id < sameTime.id!.lt;
    if (!isOlder && !tieBreak) return false;
  }
  return true;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireUser: async () => user }));
vi.mock("@/lib/realtime-server", () => ({ notifyBadgeChange: (id: string) => notifyBadgeChange(id) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findMany: async (args: { where: Record<string, unknown>; take: number }) => {
        findManyCalls(args);
        return rows
          .filter((r) => inWhere(r, args.where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
          .slice(0, args.take)
          .map((r) => ({
            ...r,
            recipientId: r.recipientId,
            message: null,
            messageData: null,
            liveStreamId: null,
            museId: null,
            museCommentId: null,
            storyId: null,
            actor: { id: r.actorId, name: "A" },
            circle: null,
            collab: null,
            channel: null,
          }));
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { readAt: Date } }) => {
        let count = 0;
        for (const r of rows) {
          if (inWhere(r, where)) {
            r.readAt = data.readAt;
            count += 1;
          }
        }
        return { count };
      },
    },
  },
}));

const { markReadByTarget } = await import("@/app/actions/notifications");

const base = new Date("2026-11-01T00:00:00Z").getTime();
function row(i: number, overrides: Partial<Row>): Row {
  return {
    id: `n${String(i).padStart(6, "0")}`,
    recipientId: ME,
    type: "POST_LIKE",
    readAt: null,
    // Newest first by index: n000000 is the newest.
    createdAt: new Date(base - i * 1000),
    actorId: "cactor00000001",
    conversationId: null,
    postId: "cpostelse00001",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
});

describe("markReadByTarget", () => {
  it("clears a row for the target that sits behind more than 200 newer unread rows", async () => {
    for (let i = 0; i < 1200; i++) rows.push(row(i, {}));
    rows.push(row(1200, { type: "MESSAGE", conversationId: "cconv000000001", postId: null }));
    rows.push(row(1201, { type: "MESSAGE", conversationId: "cconv000000002", postId: null }));
    rows.push(row(1202, { type: "MESSAGE", conversationId: "cconv000000001", postId: null, recipientId: OTHER }));

    expect(await markReadByTarget("/messages/cconv000000001")).toEqual({ error: null });

    const unread = rows.filter((r) => !r.readAt).map((r) => r.id);
    expect(unread).toHaveLength(1202);
    expect(rows.find((r) => r.id === "n001200")!.readAt).not.toBeNull();
    expect(rows.find((r) => r.id === "n001201")!.readAt).toBeNull();
    expect(rows.find((r) => r.id === "n001202")!.readAt).toBeNull();
    expect(notifyBadgeChange).toHaveBeenCalledWith(ME);
    // Pages of 500: three reads for 1203 visible rows, every one scoped to the caller's unread rows.
    expect(findManyCalls).toHaveBeenCalledTimes(3);
    for (const [args] of findManyCalls.mock.calls) {
      expect(args.where).toMatchObject({ recipientId: ME, readAt: null });
      expect(args.take).toBe(500);
    }
  });

  it("stops after 20 pages however large the backlog", async () => {
    for (let i = 0; i < 10_600; i++) rows.push(row(i, {}));
    await markReadByTarget("/messages/cconv000000001");
    expect(findManyCalls).toHaveBeenCalledTimes(20);
    expect(notifyBadgeChange).not.toHaveBeenCalled();
  });

  it("refuses a target that isn't an in-app path", async () => {
    expect(await markReadByTarget("https://example.com/x")).toEqual({ error: "invalid" });
    expect(findManyCalls).not.toHaveBeenCalled();
  });
});
