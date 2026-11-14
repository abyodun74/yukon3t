import { beforeEach, describe, expect, it, vi } from "vitest";

// actions/muse-comments.ts against an in-memory database: who sees what (blocks either way, inactive authors, flagged
// text), replies always landing under a top-level comment, Muse.commentCount staying exact while replies and deletes
// race (the row locks are modelled as real async mutexes), cascade deletes, likes, limiter wiring and who is notified.

type Status = "PUBLISHED" | "FLAGGED" | "REMOVED";
type Row = {
  id: string;
  museId: string;
  parentId: string | null;
  authorId: string;
  content: string;
  gifUrl?: string | null;
  moderationStatus: Status;
  createdAt: Date;
};

const MUSE = "cmuse000000001";
const OWNER = "cowner00000001";
const ME = "cme00000000001";
const ALICE = "calice00000001";
const BOB = "cbob0000000001";
const BLOCKED = "cblocked000001";
const GONE = "cgone000000001";

let user: { id: string; name: string; avatarUrl: string | null; isAdmin: boolean } | null;
let rows: Map<string, Row>;
let muse: { id: string; authorId: string; moderationStatus: Status; commentCount: number };
let likes: { commentId: string; userId: string }[];
let blocks: [string, string][];
const userStatus: Record<string, string> = {};
let idSeq = 0;
let clock = Date.parse("2026-11-13T10:00:00Z");

const checkRateLimit = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true);
const moderateText = vi.fn<(t: string) => Promise<{ allowed: boolean; flaggedCategories: string[] }>>(async () => ({
  allowed: true,
  flaggedCategories: [],
}));
const notificationCreate = vi.fn<(a: unknown) => Promise<object>>(async () => ({}));
const pushActivityNotification = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const findManyCalls: unknown[] = [];

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// Row locks: SELECT ... FOR UPDATE waits for the holder's transaction to end.
const lockTails = new Map<string, Promise<void>>();
async function acquire(id: string, held: (() => void)[]) {
  const prev = lockTails.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  lockTails.set(id, prev.then(() => mine));
  await prev;
  held.push(release);
}

function authorOf(id: string) {
  return { id, name: id.slice(1, 6), username: id.slice(1, 6), avatarUrl: null, status: userStatus[id] ?? "ACTIVE" };
}
function project(r: Row) {
  return { id: r.id, parentId: r.parentId, content: r.content, gifUrl: r.gifUrl ?? null, createdAt: r.createdAt, author: authorOf(r.authorId) };
}
function blockedEitherWay(a: string, b: string) {
  return blocks.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
// Enough of Prisma's where for the queries the actions make.
function matches(r: Row, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") {
      if (!(value as Record<string, unknown>[]).some((w) => matches(r, w))) return false;
      continue;
    }
    if (key === "author") {
      if ((value as { status: string }).status !== authorOf(r.authorId).status) return false;
      continue;
    }
    const field = r[key as keyof Row];
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const op = value as { in?: string[]; notIn?: string[]; lt?: unknown; gt?: unknown };
      if (op.in && !op.in.includes(field as string)) return false;
      if (op.notIn && op.notIn.includes(field as string)) return false;
      if (op.lt !== undefined && !(compare(field, op.lt) < 0)) return false;
      if (op.gt !== undefined && !(compare(field, op.gt) > 0)) return false;
    } else if (value instanceof Date) {
      if ((field as Date).getTime() !== value.getTime()) return false;
    } else if (field !== value) return false;
  }
  return true;
}
function deleteCascade(id: string) {
  for (const r of [...rows.values()]) if (r.parentId === id) deleteCascade(r.id);
  rows.delete(id);
  likes = likes.filter((l) => l.commentId !== id);
}

function makeTx(held: (() => void)[]) {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      await tick();
      const id = String(values[0]);
      if (strings.join("?").includes("FOR UPDATE")) await acquire(id, held);
      const row = rows.get(id);
      return row ? [{ id: row.id, moderationStatus: row.moderationStatus }] : [];
    },
    museComment: {
      create: async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
        await tick();
        if (data.parentId && !rows.has(data.parentId)) throw new Error("foreign key violation");
        const row: Row = { ...data, id: `cnew${String(++idSeq).padStart(10, "0")}`, createdAt: new Date((clock += 1000)) };
        rows.set(row.id, row);
        return project(row);
      },
      count: async ({ where }: { where: Record<string, unknown> }) => {
        await tick();
        return [...rows.values()].filter((r) => matches(r, where)).length;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        await tick();
        if (!rows.has(where.id)) throw new Error("record not found");
        deleteCascade(where.id);
      },
    },
    muse: {
      update: async ({ data }: { data: { commentCount: { increment?: number; decrement?: number } } }) => {
        await tick();
        muse.commentCount += (data.commentCount.increment ?? 0) - (data.commentCount.decrement ?? 0);
        return { commentCount: muse.commentCount };
      },
    },
  };
}

vi.mock("@/lib/auth-guards", () => {
  const guard = async () => {
    if (!user) throw new Error("not signed in");
    return user;
  };
  return { requireVerifiedUser: guard, requireVerifiedViewer: guard };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/moderation", () => ({ moderateText: (t: string) => moderateText(t) }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: (...a: unknown[]) => pushActivityNotification(...a) }));
vi.mock("@/lib/prisma-errors", () => ({ isUniqueConstraintError: (e: unknown) => (e as Error)?.message === "unique" }));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (a: string, b: string) => blockedEitherWay(a, b),
  getBlockedEitherWayIds: async (me: string) =>
    new Set(blocks.flatMap(([x, y]) => (x === me ? [y] : y === me ? [x] : []))),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: ReturnType<typeof makeTx>) => unknown) => {
      const held: (() => void)[] = [];
      try {
        return await fn(makeTx(held));
      } finally {
        for (const release of held) release();
      }
    },
    muse: {
      findUnique: async () => ({ id: muse.id, authorId: muse.authorId, moderationStatus: muse.moderationStatus }),
    },
    museComment: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const r = rows.get(where.id);
        if (!r) return null;
        return { ...r, author: authorOf(r.authorId), muse: { authorId: muse.authorId } };
      },
      findMany: async (args: {
        where: Record<string, unknown>;
        orderBy: { createdAt: "asc" | "desc" }[];
        take?: number;
      }) => {
        findManyCalls.push(args);
        const dir = args.orderBy?.[0]?.createdAt === "desc" ? -1 : 1;
        return [...rows.values()]
          .filter((r) => matches(r, args.where))
          .sort((a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)))
          .slice(0, args.take ?? Infinity)
          .map(project);
      },
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        const counts = new Map<string, number>();
        for (const r of rows.values()) if (matches(r, where)) counts.set(r.parentId!, (counts.get(r.parentId!) ?? 0) + 1);
        return [...counts].map(([parentId, n]) => ({ parentId, _count: { _all: n } }));
      },
    },
    museCommentLike: {
      groupBy: async ({ where }: { where: { commentId: { in: string[] } } }) => {
        const counts = new Map<string, number>();
        for (const l of likes) if (where.commentId.in.includes(l.commentId)) counts.set(l.commentId, (counts.get(l.commentId) ?? 0) + 1);
        return [...counts].map(([commentId, n]) => ({ commentId, _count: { _all: n } }));
      },
      findMany: async ({ where }: { where: { userId: string; commentId: { in: string[] } } }) =>
        likes.filter((l) => l.userId === where.userId && where.commentId.in.includes(l.commentId)),
      findUnique: async ({ where }: { where: { commentId_userId: { commentId: string; userId: string } } }) =>
        likes.find((l) => l.commentId === where.commentId_userId.commentId && l.userId === where.commentId_userId.userId)
          ? { id: "like" }
          : null,
      create: async ({ data }: { data: { commentId: string; userId: string } }) => {
        if (likes.some((l) => l.commentId === data.commentId && l.userId === data.userId)) throw new Error("unique");
        likes.push(data);
      },
      deleteMany: async ({ where }: { where: { commentId: string; userId: string } }) => {
        likes = likes.filter((l) => !(l.commentId === where.commentId && l.userId === where.userId));
      },
      count: async ({ where }: { where: { commentId: string } }) => likes.filter((l) => l.commentId === where.commentId).length,
    },
    notification: { create: (a: unknown) => notificationCreate(a) },
  },
}));

const {
  createMuseComment,
  deleteMuseComment,
  getMuseCommentReplies,
  getMuseCommentThread,
  getMuseComments,
  toggleMuseCommentLike,
} = await import("@/app/actions/muse-comments");

function seed(id: string, authorId: string, parentId: string | null = null, moderationStatus: Status = "PUBLISHED") {
  rows.set(id, { id, museId: MUSE, parentId, authorId, content: `text ${id}`, moderationStatus, createdAt: new Date((clock += 1000)) });
  if (moderationStatus === "PUBLISHED") muse.commentCount++;
}
function form(content: string, replyToId?: string, gifUrl?: string) {
  const fd = new FormData();
  fd.set("content", content);
  if (replyToId) fd.set("replyToId", replyToId);
  if (gifUrl !== undefined) fd.set("gifUrl", gifUrl);
  return fd;
}
const GIF = "https://media2.giphy.com/media/abc123/giphy.gif";
const publishedCount = () => [...rows.values()].filter((r) => r.moderationStatus === "PUBLISHED").length;
const notified = () =>
  notificationCreate.mock.calls.map((c) => {
    const data = (c[0] as { data: { recipientId: string; type: string; museCommentId: string } }).data;
    return [data.recipientId, data.type] as const;
  });

beforeEach(() => {
  user = { id: ME, name: "Me", avatarUrl: "/api/avatar/me/a-t.webp", isAdmin: false };
  rows = new Map();
  muse = { id: MUSE, authorId: OWNER, moderationStatus: "PUBLISHED", commentCount: 0 };
  likes = [];
  blocks = [];
  for (const k of Object.keys(userStatus)) delete userStatus[k];
  idSeq = 0;
  lockTails.clear();
  findManyCalls.length = 0;
  checkRateLimit.mockClear().mockImplementation(async () => true);
  moderateText.mockClear().mockImplementation(async () => ({ allowed: true, flaggedCategories: [] }));
  notificationCreate.mockClear();
  pushActivityNotification.mockClear();
});

describe("reading comments", () => {
  it("lists top-level comments newest first, with exact visible reply counts and likes, hiding blocked and inactive authors", async () => {
    userStatus[GONE] = "SUSPENDED";
    blocks = [[ME, BLOCKED]];
    seed("ca00000000001", ALICE);
    seed("cr00000000001", BOB, "ca00000000001");
    seed("cr00000000002", BLOCKED, "ca00000000001");
    seed("cr00000000003", GONE, "ca00000000001");
    seed("cr00000000004", BOB, "ca00000000001", "FLAGGED");
    seed("cb00000000001", BLOCKED);
    seed("cc00000000001", GONE);
    seed("cd00000000001", BOB);
    likes = [
      { commentId: "ca00000000001", userId: ME },
      { commentId: "ca00000000001", userId: BOB },
    ];

    const page = await getMuseComments(MUSE);
    expect(page.error).toBeNull();
    expect(page.comments.map((c) => c.id)).toEqual(["cd00000000001", "ca00000000001"]);
    const a = page.comments[1];
    expect(a).toMatchObject({ replyCount: 1, likeCount: 2, likedByMe: true });
    expect(page.viewer).toEqual({ name: "Me", avatarUrl: "/api/avatar/me/a-t.webp" });
    expect(checkRateLimit).toHaveBeenCalledWith("museCommentList", ME);
    // Never a whole User row: exactly the author fields the sheet shows.
    expect(Object.keys(a.author).sort()).toEqual(["avatarUrl", "id", "name", "username"]);
  });

  it("pages with a (createdAt, id) cursor and never repeats a comment", async () => {
    for (let i = 0; i < 25; i++) seed(`cpage${String(i).padStart(8, "0")}`, ALICE);
    const first = await getMuseComments(MUSE);
    expect(first.comments).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await getMuseComments(MUSE, first.nextCursor);
    expect(second.comments).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.comments, ...second.comments].map((c) => c.id);
    expect(new Set(ids).size).toBe(25);
  });

  it("answers not_found for a Muse whose author is blocked either way, or that isn't published", async () => {
    blocks = [[OWNER, ME]];
    expect((await getMuseComments(MUSE)).error).toBe("not_found");
    blocks = [];
    muse.moderationStatus = "FLAGGED";
    expect((await getMuseComments(MUSE)).error).toBe("not_found");
  });

  it("loads replies oldest first, ten a page, only under a visible top-level comment", async () => {
    seed("ctop000000001", ALICE);
    for (let i = 0; i < 12; i++) seed(`crep${String(i).padStart(9, "0")}`, BOB, "ctop000000001");
    const first = await getMuseCommentReplies("ctop000000001");
    expect(first.replies.map((r) => r.id)).toEqual(Array.from({ length: 10 }, (_, i) => `crep${String(i).padStart(9, "0")}`));
    const rest = await getMuseCommentReplies("ctop000000001", first.nextCursor);
    expect(rest.replies).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
    // A reply has no replies of its own to list.
    expect((await getMuseCommentReplies("crep000000000")).error).toBe("not_found");
    // A blocked author's thread isn't there at all.
    blocks = [[ME, ALICE]];
    expect((await getMuseCommentReplies("ctop000000001")).error).toBe("not_found");
  });

  it("opens a notification's thread from a reply id: the top-level comment with its first replies", async () => {
    seed("ctop000000001", ALICE);
    seed("crep000000001", BOB, "ctop000000001");
    const result = await getMuseCommentThread(MUSE, "crep000000001");
    expect(result.thread?.comment.id).toBe("ctop000000001");
    expect(result.thread?.replies.map((r) => r.id)).toEqual(["crep000000001"]);
    expect((await getMuseCommentThread("cothermuse0001", "crep000000001")).error).toBe("not_found");
  });
});

describe("posting comments and replies", () => {
  it("refuses a signed-out / guest caller before touching anything", async () => {
    user = null;
    await expect(createMuseComment(MUSE, form("hi"))).rejects.toThrow();
    expect(rows.size).toBe(0);
  });

  it("uses the comment limiter", async () => {
    checkRateLimit.mockImplementation(async () => false);
    expect(await createMuseComment(MUSE, form("hi"))).toEqual({ error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith("comment", ME);
    expect(rows.size).toBe(0);
  });

  it("notifies the Muse's owner of a top-level comment, linked to it", async () => {
    const result = await createMuseComment(MUSE, form("nice"));
    expect(result.error).toBeNull();
    expect(muse.commentCount).toBe(1);
    expect(result).toMatchObject({ commentCount: 1, comment: { parentId: null, replyCount: 0 } });
    expect(notified()).toEqual([[OWNER, "MUSE_COMMENT"]]);
    const id = result.error === null ? result.comment.id : "";
    expect(pushActivityNotification).toHaveBeenCalledWith(OWNER, "MUSE_COMMENT", "Me", `/muse/${MUSE}?comment=${id}`);
  });

  it("attaches a reply to a reply to the same top-level comment, and notifies the person replied to and the owner once each", async () => {
    seed("ctop000000001", ALICE);
    seed("crep000000001", BOB, "ctop000000001");
    const result = await createMuseComment(MUSE, form("@bob yes", "crep000000001"));
    expect(result).toMatchObject({ error: null, comment: { parentId: "ctop000000001" } });
    expect(notified()).toEqual([
      [BOB, "COMMENT_REPLY"],
      [OWNER, "MUSE_COMMENT"],
    ]);
  });

  it("sends the owner one notification when the reply answers the owner's own comment", async () => {
    seed("ctop000000001", OWNER);
    await createMuseComment(MUSE, form("thanks", "ctop000000001"));
    expect(notified()).toEqual([[OWNER, "COMMENT_REPLY"]]);
  });

  it("never notifies the writer themself", async () => {
    user = { id: OWNER, name: "Owner", avatarUrl: null, isAdmin: false };
    seed("ctop000000001", OWNER);
    await createMuseComment(MUSE, form("me again", "ctop000000001"));
    await createMuseComment(MUSE, form("and again"));
    expect(notified()).toEqual([]);
  });

  it("refuses a reply to a comment by someone blocked either way, or by an inactive account, and notifies nobody", async () => {
    seed("cblk000000001", BLOCKED);
    seed("cgon000000001", GONE);
    blocks = [[BLOCKED, ME]];
    userStatus[GONE] = "BANNED";
    expect(await createMuseComment(MUSE, form("x", "cblk000000001"))).toEqual({ error: "not_found" });
    expect(await createMuseComment(MUSE, form("x", "cgon000000001"))).toEqual({ error: "not_found" });
    expect(notified()).toEqual([]);
    expect(rows.size).toBe(2);
  });

  it("refuses a reply to a comment on another Muse", async () => {
    rows.set("celse00000001", { id: "celse00000001", museId: "cothermuse0001", parentId: null, authorId: ALICE, content: "x", moderationStatus: "PUBLISHED", createdAt: new Date() });
    expect(await createMuseComment(MUSE, form("x", "celse00000001"))).toEqual({ error: "not_found" });
  });

  it("stores flagged text FLAGGED: not counted, not shown, nobody notified", async () => {
    seed("ctop000000001", ALICE);
    const before = muse.commentCount;
    moderateText.mockImplementation(async () => ({ allowed: false, flaggedCategories: ["harassment"] }));
    const result = await createMuseComment(MUSE, form("bad", "ctop000000001"));
    expect(result).toMatchObject({ error: null, moderationStatus: "FLAGGED", commentCount: null });
    expect(muse.commentCount).toBe(before);
    expect(notified()).toEqual([]);
    const thread = await getMuseCommentReplies("ctop000000001");
    expect(thread.replies).toEqual([]);
  });

  it("rejects empty and over-long text", async () => {
    expect(await createMuseComment(MUSE, form("   "))).toEqual({ error: "invalid" });
    expect(await createMuseComment(MUSE, form("x".repeat(1001)))).toEqual({ error: "invalid" });
  });
});

describe("deleting", () => {
  it("deletes a top-level comment with its replies and takes all of them off the count", async () => {
    seed("ctop000000001", ME);
    seed("crep000000001", ALICE, "ctop000000001");
    seed("crep000000002", BOB, "ctop000000001");
    seed("crep000000003", BOB, "ctop000000001", "FLAGGED");
    seed("cother0000001", BOB);
    const result = await deleteMuseComment("ctop000000001");
    expect(result).toEqual({ error: null, commentCount: 1 });
    expect([...rows.keys()]).toEqual(["cother0000001"]);
    expect(muse.commentCount).toBe(publishedCount());
  });

  it("deletes only the reply, and allows the reply's author, the Muse's owner and an admin, nobody else", async () => {
    seed("ctop000000001", ALICE);
    seed("crep000000001", BOB, "ctop000000001");
    expect(await deleteMuseComment("crep000000001")).toEqual({ error: "forbidden" });
    user = { id: OWNER, name: "Owner", avatarUrl: null, isAdmin: false };
    expect(await deleteMuseComment("crep000000001")).toEqual({ error: null, commentCount: 1 });
    expect([...rows.keys()]).toEqual(["ctop000000001"]);
  });

  it("keeps Muse.commentCount exact while replies, reply deletes and the parent's delete race", async () => {
    seed("ctop000000001", ME);
    seed("crep000000001", ALICE, "ctop000000001");
    seed("crep000000002", BOB, "ctop000000001");
    seed("cside00000001", BOB);
    const results = await Promise.allSettled([
      createMuseComment(MUSE, form("r1", "ctop000000001")),
      deleteMuseComment("crep000000001"),
      createMuseComment(MUSE, form("r2", "crep000000002")),
      deleteMuseComment("ctop000000001"),
      deleteMuseComment("crep000000001"),
      createMuseComment(MUSE, form("r3", "ctop000000001")),
      createMuseComment(MUSE, form("top")),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(muse.commentCount).toBe(publishedCount());
    expect(rows.has("ctop000000001")).toBe(false);
    expect([...rows.values()].some((r) => r.parentId === "ctop000000001")).toBe(false);
  });

  it("counts a doubled delete once", async () => {
    seed("ctop000000001", ME);
    seed("cside00000001", BOB);
    const [a, b] = await Promise.all([deleteMuseComment("ctop000000001"), deleteMuseComment("ctop000000001")]);
    expect([a.error, b.error].sort()).toEqual([null, "not_found"].sort());
    expect(muse.commentCount).toBe(1);
  });
});

describe("likes", () => {
  it("toggles a like on a reply and answers the exact count; refuses across a block", async () => {
    seed("ctop000000001", ALICE);
    seed("crep000000001", BOB, "ctop000000001");
    likes = [{ commentId: "crep000000001", userId: ALICE }];
    expect(await toggleMuseCommentLike("crep000000001")).toEqual({ error: null, liked: true, likeCount: 2 });
    expect(await toggleMuseCommentLike("crep000000001")).toEqual({ error: null, liked: false, likeCount: 1 });
    expect(checkRateLimit).toHaveBeenCalledWith("like", ME);
    blocks = [[ME, BOB]];
    expect(await toggleMuseCommentLike("crep000000001")).toEqual({ error: "not_found" });
    // The thread's top-level author blocked hides the whole thread, its replies included.
    blocks = [[ME, ALICE]];
    expect(await toggleMuseCommentLike("crep000000001")).toEqual({ error: "not_found" });
  });
});

describe("GIF comments and replies", () => {
  it("posts a GIF-only comment (no text, so nothing to moderate), counts it and shows it", async () => {
    const result = await createMuseComment(MUSE, form("", undefined, GIF));
    expect(result).toMatchObject({ error: null, moderationStatus: "PUBLISHED", commentCount: 1, comment: { content: "", gifUrl: GIF } });
    expect(moderateText).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith("comment", ME);
    expect(notified()).toEqual([[OWNER, "MUSE_COMMENT"]]);
    // The push never carries the comment, so never the GIF's URL.
    expect(JSON.stringify(pushActivityNotification.mock.calls)).not.toContain("giphy");
    const page = await getMuseComments(MUSE);
    expect(page.comments[0]).toMatchObject({ content: "", gifUrl: GIF });
  });

  it("posts a GIF with a caption, and still moderates the caption", async () => {
    moderateText.mockImplementation(async () => ({ allowed: false, flaggedCategories: ["harassment"] }));
    const result = await createMuseComment(MUSE, form("caption", undefined, GIF));
    expect(moderateText).toHaveBeenCalledWith("caption");
    expect(result).toMatchObject({ error: null, moderationStatus: "FLAGGED", commentCount: null });
    expect((await getMuseComments(MUSE)).comments).toEqual([]);
    expect(notified()).toEqual([]);
  });

  it("accepts a GIF reply, threaded under the top-level comment like any reply", async () => {
    seed("ctop000000001", ALICE);
    const result = await createMuseComment(MUSE, form("", "ctop000000001", GIF));
    expect(result).toMatchObject({ error: null, comment: { parentId: "ctop000000001", gifUrl: GIF } });
    const replies = await getMuseCommentReplies("ctop000000001");
    expect(replies.replies.map((r) => r.gifUrl)).toEqual([GIF]);
    expect(notified()).toEqual([
      [ALICE, "COMMENT_REPLY"],
      [OWNER, "MUSE_COMMENT"],
    ]);
  });

  it.each([
    ["plain http", "http://media.giphy.com/media/abc/giphy.gif"],
    ["another host", "https://example.com/giphy.gif"],
    ["a look-alike host", "https://evil-giphy.com/a.gif"],
    ["a host with giphy in the path only", "https://example.com/media.giphy.com/a.gif"],
    ["javascript:", "javascript:alert(1)//giphy.com"],
    ["data:", "data:image/gif;base64,R0lGOD"],
    ["not a URL", "giphy.gif"],
    ["an over-long URL", `https://media.giphy.com/media/${"a".repeat(2100)}/giphy.gif`],
  ])("refuses %s before storing anything", async (_label, url) => {
    expect(await createMuseComment(MUSE, form("hi", undefined, url))).toEqual({ error: "invalid" });
    expect(await createMuseComment(MUSE, form("", undefined, url))).toEqual({ error: "invalid" });
    expect(rows.size).toBe(0);
    expect(muse.commentCount).toBe(0);
  });

  it("needs text or a GIF", async () => {
    expect(await createMuseComment(MUSE, form("  ", undefined, "  "))).toEqual({ error: "invalid" });
    expect(await createMuseComment(MUSE, form(""))).toEqual({ error: "invalid" });
    expect(rows.size).toBe(0);
  });

  it("applies the comment limiter to GIF comments too", async () => {
    checkRateLimit.mockImplementation(async () => false);
    expect(await createMuseComment(MUSE, form("", undefined, GIF))).toEqual({ error: "rate_limited" });
    expect(rows.size).toBe(0);
  });

  it("hides a GIF comment by a blocked or inactive author like any other", async () => {
    rows.set("cgif000000001", { id: "cgif000000001", museId: MUSE, parentId: null, authorId: BLOCKED, content: "", gifUrl: GIF, moderationStatus: "PUBLISHED", createdAt: new Date((clock += 1000)) });
    rows.set("cgif000000002", { id: "cgif000000002", museId: MUSE, parentId: null, authorId: GONE, content: "", gifUrl: GIF, moderationStatus: "PUBLISHED", createdAt: new Date((clock += 1000)) });
    blocks = [[BLOCKED, ME]];
    userStatus[GONE] = "DEACTIVATED";
    expect((await getMuseComments(MUSE)).comments).toEqual([]);
  });
});
