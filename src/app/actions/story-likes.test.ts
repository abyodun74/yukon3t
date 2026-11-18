import { beforeEach, describe, expect, it, vi } from "vitest";

// Story likes end to end against a small in-memory database, with the REAL visibility gate (loadViewableStory ->
// profile-access rules, blocks either way, connections, expiry) and the real advisory-lock coalescing emulated:
// toggleStoryLike's idempotency, that only someone who can view the story can like it, that the count and who liked
// reach the author only (getStoryReactionSummary / getStoryViewers), and that a burst of likes notifies at most once
// per liker per story.

type U = { id: string; name: string | null; status: string; isAdmin: boolean; isGuestPreview: boolean; postsVisibility: string };
type Story = { id: string; authorId: string; expiresAt: Date };
type Like = { id: string; storyId: string; userId: string; createdAt: Date };
type Note = { id: string; recipientId: string; actorId: string; type: string; storyId: string | null };

const AUTHOR = "author";
const FRIEND = "friend";
const STRANGER = "stranger";
const BLOCKED = "blocked";

let users = new Map<string, U>();
let stories: Story[] = [];
let likes: Like[] = [];
let notes: Note[] = [];
let views: { storyId: string; viewerId: string; viewedAt: Date; viewer: { id: string; name: string | null } }[] = [];
let connections: { requesterId: string; targetId: string; status: string }[] = [];
let blocks: { blockerId: string; blockedId: string }[] = [];
let nextId = 1;
let currentUser: { id: string; name: string | null; isAdmin: boolean };
let rateAllowed = true;
// Simulates the expiry sweep deleting the story after the visibility check passed but before the like is written.
let sweepBeforeWrite = false;
const pushActivityNotification = vi.fn(async (...args: unknown[]) => {
  void args;
});
const tick = () => new Promise((r) => setTimeout(r, 1));

const user = (id: string, over: Partial<U> = {}): U => ({
  id,
  name: `Name ${id}`,
  status: "ACTIVE",
  isAdmin: false,
  isGuestPreview: false,
  postsVisibility: "CONNECTIONS_ONLY",
  ...over,
});

function blockMatches(where: { OR: { blockerId: unknown; blockedId: unknown }[] }) {
  return blocks.some((b) =>
    where.OR.some(
      (c) =>
        (c.blockerId === b.blockerId || (typeof c.blockerId === "object" && (c.blockerId as { in: string[] }).in.includes(b.blockerId))) &&
        (c.blockedId === b.blockedId || (typeof c.blockedId === "object" && (c.blockedId as { in: string[] }).in.includes(b.blockedId))),
    ),
  );
}

function likeWhere(where: { storyId?: string; userId?: string | { notIn: string[] } }) {
  return (l: Like) =>
    (where.storyId === undefined || l.storyId === where.storyId) &&
    (where.userId === undefined ||
      (typeof where.userId === "string" ? l.userId === where.userId : !where.userId.notIn.includes(l.userId)));
}

// Advisory locks: held from $executeRaw until the transaction's callback settles.
const lockTails = new Map<string, Promise<void>>();

function makeClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    story: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const s = stories.find((x) => x.id === where.id);
        return s ? { ...s } : null;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
    },
    block: {
      findFirst: async ({ where }: { where: { OR: { blockerId: unknown; blockedId: unknown }[] } }) =>
        blockMatches(where) ? { id: "b" } : null,
      findMany: async ({ where }: { where: { OR: [{ blockerId: string }, { blockedId: string }] } }) =>
        blocks.filter((b) => b.blockerId === where.OR[0].blockerId || b.blockedId === where.OR[1].blockedId),
    },
    connection: {
      findFirst: async ({ where }: { where: { OR: { requesterId: string; targetId: string }[] } }) =>
        connections.find(
          (c) => c.status === "ACCEPTED" && where.OR.some((o) => o.requesterId === c.requesterId && o.targetId === c.targetId),
        ) ?? null,
    },
    storyLike: {
      findUnique: async ({ where }: { where: { storyId_userId: { storyId: string; userId: string } } }) =>
        likes.find((l) => l.storyId === where.storyId_userId.storyId && l.userId === where.storyId_userId.userId) ?? null,
      createMany: async ({ data }: { data: { storyId: string; userId: string }[] }) => {
        let count = 0;
        if (sweepBeforeWrite) stories = [];
        for (const d of data) {
          if (!stories.some((s) => s.id === d.storyId)) throw new Error("foreign key");
          if (likes.some((l) => l.storyId === d.storyId && l.userId === d.userId)) continue;
          likes.push({ id: `l${nextId++}`, ...d, createdAt: new Date(Date.now() + nextId) });
          count++;
        }
        return { count };
      },
      deleteMany: async ({ where }: { where: { storyId: string; userId: string } }) => {
        const before = likes.length;
        likes = likes.filter((l) => !likeWhere(where)(l));
        return { count: before - likes.length };
      },
      count: async ({ where }: { where: { storyId: string; userId?: { notIn: string[] } } }) =>
        likes.filter(likeWhere(where)).length,
      findMany: async ({ where, take }: { where: { storyId: string; userId?: { notIn: string[] } }; take: number }) =>
        likes
          .filter(likeWhere(where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take)
          .map((l) => ({ createdAt: l.createdAt, user: { id: l.userId, name: users.get(l.userId)?.name ?? null } })),
    },
    storyReaction: { findMany: async () => [] },
    storyView: {
      findMany: async ({ where }: { where: { storyId: string } }) => views.filter((v) => v.storyId === where.storyId),
      count: async ({ where }: { where: { storyId: string } }) => views.filter((v) => v.storyId === where.storyId).length,
    },
    notification: {
      findFirst: async ({ where }: { where: Omit<Note, "id"> }) => {
        await tick();
        return (
          notes.find(
            (n) =>
              n.recipientId === where.recipientId && n.actorId === where.actorId && n.type === where.type && n.storyId === where.storyId,
          ) ?? null
        );
      },
      create: async ({ data }: { data: Omit<Note, "id"> }) => {
        await tick();
        const n = { id: `n${nextId++}`, ...data };
        notes.push(n);
        return n;
      },
    },
  };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const held: (() => void)[] = [];
    const tx = {
      ...client,
      $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
        const prev = lockTails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>((r) => (release = r));
        lockTails.set(key, prev.then(() => mine));
        await prev;
        held.push(release);
        return 1;
      },
    };
    try {
      return await fn(tx);
    } finally {
      for (const r of held) r();
    }
  };
  return client;
}

vi.mock("@/lib/prisma", () => ({ prisma: makeClient() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireVerifiedUser: async () => currentUser,
  requireVerifiedViewer: async () => currentUser,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => rateAllowed }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: (...a: unknown[]) => pushActivityNotification(...a) }));
// Only what stories.ts imports for its other actions; none of it runs here.
vi.mock("@/lib/moderation", () => ({ moderateText: vi.fn(), moderateMedia: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: {},
  STORY_LIFETIME_MS: 86_400_000,
  verifyUploadedSize: vi.fn(),
  keyFromPublicUrl: vi.fn(),
}));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn(), sendPushToUsers: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUser: vi.fn(), sendFcmActivityToUsers: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({ getMembersHidingConversation: async () => [] }));

const { toggleStoryLike } = await import("@/app/actions/story-likes");
const { getStoryViewers, getStoryReactionSummary } = await import("@/app/actions/stories");

const as = (id: string) => {
  currentUser = { id, name: users.get(id)?.name ?? null, isAdmin: false };
};

beforeEach(() => {
  users = new Map([AUTHOR, FRIEND, STRANGER, BLOCKED].map((id) => [id, user(id)]));
  stories = [{ id: "s1", authorId: AUTHOR, expiresAt: new Date(Date.now() + 3_600_000) }];
  likes = [];
  notes = [];
  views = [];
  connections = [
    { requesterId: FRIEND, targetId: AUTHOR, status: "ACCEPTED" },
    { requesterId: AUTHOR, targetId: BLOCKED, status: "ACCEPTED" },
  ];
  blocks = [];
  rateAllowed = true;
  sweepBeforeWrite = false;
  pushActivityNotification.mockClear();
  lockTails.clear();
  as(FRIEND);
});

describe("toggleStoryLike", () => {
  it("likes and unlikes, and is idempotent for a repeated or retried request", async () => {
    expect(await toggleStoryLike("s1", true)).toEqual({ error: null, liked: true });
    expect(await toggleStoryLike("s1", true)).toEqual({ error: null, liked: true });
    expect(likes).toHaveLength(1);
    expect(await toggleStoryLike("s1", false)).toEqual({ error: null, liked: false });
    expect(await toggleStoryLike("s1", false)).toEqual({ error: null, liked: false });
    expect(likes).toHaveLength(0);
    // No state given: flips.
    expect(await toggleStoryLike("s1")).toEqual({ error: null, liked: true });
    expect(await toggleStoryLike("s1")).toEqual({ error: null, liked: false });
  });

  it("racing like requests store one like", async () => {
    await Promise.all([toggleStoryLike("s1", true), toggleStoryLike("s1", true), toggleStoryLike("s1", true)]);
    expect(likes).toHaveLength(1);
  });

  it("answers only the caller's own state, never a count or who else liked", async () => {
    as(STRANGER);
    users.set(AUTHOR, { ...users.get(AUTHOR)!, postsVisibility: "PUBLIC" });
    await toggleStoryLike("s1", true);
    as(FRIEND);
    const result = await toggleStoryLike("s1", true);
    expect(Object.keys(result).sort()).toEqual(["error", "liked"]);
  });

  it("refuses anyone who can't view the story: not connected to a friends-only author", async () => {
    as(STRANGER);
    expect(await toggleStoryLike("s1", true)).toEqual({ error: "not_found" });
    expect(likes).toHaveLength(0);
  });

  it("refuses across a block, whichever way it goes", async () => {
    as(BLOCKED);
    blocks = [{ blockerId: AUTHOR, blockedId: BLOCKED }];
    expect(await toggleStoryLike("s1", true)).toEqual({ error: "not_found" });
    blocks = [{ blockerId: BLOCKED, blockedId: AUTHOR }];
    expect(await toggleStoryLike("s1", true)).toEqual({ error: "not_found" });
    expect(likes).toHaveLength(0);
  });

  it("refuses an expired, missing or hidden-author story, and a deactivated author", async () => {
    stories[0]!.expiresAt = new Date(Date.now() - 1000);
    expect(await toggleStoryLike("s1", true)).toEqual({ error: "not_found" });
    expect(await toggleStoryLike("nope", true)).toEqual({ error: "not_found" });
    stories[0]!.expiresAt = new Date(Date.now() + 3_600_000);
    users.set(AUTHOR, { ...users.get(AUTHOR)!, postsVisibility: "HIDDEN" });
    expect(await toggleStoryLike("s1", true)).toEqual({ error: "not_found" });
    users.set(AUTHOR, { ...users.get(AUTHOR)!, postsVisibility: "CONNECTIONS_ONLY", status: "DEACTIVATED" });
    expect(await toggleStoryLike("s1", true)).toEqual({ error: "not_found" });
    expect(likes).toHaveLength(0);
  });

  it("answers not_found when the story is swept between the check and the write", async () => {
    sweepBeforeWrite = true;
    expect(await toggleStoryLike("s1", true)).toEqual({ error: "not_found" });
    expect(likes).toHaveLength(0);
    expect(notes).toHaveLength(0);
  });

  it("has no heart for the author's own story", async () => {
    as(AUTHOR);
    expect(await toggleStoryLike("s1", true)).toEqual({ error: "own_story" });
    expect(likes).toHaveLength(0);
  });

  it("is rate-limited and validates its input", async () => {
    rateAllowed = false;
    expect(await toggleStoryLike("s1", true)).toEqual({ error: "rate_limited" });
    rateAllowed = true;
    expect(await toggleStoryLike("", true)).toEqual({ error: "invalid" });
    expect(await toggleStoryLike("s1", "yes" as unknown as boolean)).toEqual({ error: "invalid" });
    expect(likes).toHaveLength(0);
  });
});

describe("notifications: one per liker per story", () => {
  it("notifies the author once, in a STORY_LIKE bell row plus a push to the story", async () => {
    await toggleStoryLike("s1", true);
    expect(notes).toEqual([expect.objectContaining({ recipientId: AUTHOR, actorId: FRIEND, type: "STORY_LIKE", storyId: "s1" })]);
    expect(pushActivityNotification).toHaveBeenCalledTimes(1);
    expect(pushActivityNotification).toHaveBeenCalledWith(AUTHOR, "STORY_LIKE", `Name ${FRIEND}`, `/u/${AUTHOR}?story=s1`);
  });

  it("a burst of like / unlike / like never notifies twice", async () => {
    for (let i = 0; i < 5; i++) {
      await toggleStoryLike("s1", true);
      await toggleStoryLike("s1", false);
    }
    await toggleStoryLike("s1", true);
    expect(notes).toHaveLength(1);
    expect(pushActivityNotification).toHaveBeenCalledTimes(1);
  });

  it("racing new likes (after an unlike) are coalesced by the lock into one row", async () => {
    await toggleStoryLike("s1", true);
    notes = [];
    pushActivityNotification.mockClear();
    likes = [];
    // Two tabs: each sees no like and no notification yet.
    const { notifyStoryLike } = await import("@/lib/story-likes-server");
    await Promise.all([
      notifyStoryLike({ id: "s1", authorId: AUTHOR }, { id: FRIEND, name: "F" }),
      notifyStoryLike({ id: "s1", authorId: AUTHOR }, { id: FRIEND, name: "F" }),
      notifyStoryLike({ id: "s1", authorId: AUTHOR }, { id: FRIEND, name: "F" }),
    ]);
    expect(notes).toHaveLength(1);
    expect(pushActivityNotification).toHaveBeenCalledTimes(1);
  });

  it("each liker notifies once on their own", async () => {
    users.set(AUTHOR, { ...users.get(AUTHOR)!, postsVisibility: "PUBLIC" });
    await toggleStoryLike("s1", true);
    as(STRANGER);
    await toggleStoryLike("s1", true);
    expect(notes.map((n) => n.actorId).sort()).toEqual([FRIEND, STRANGER].sort());
  });

  it("never notifies across a block or for the author themself", async () => {
    const { notifyStoryLike } = await import("@/lib/story-likes-server");
    blocks = [{ blockerId: AUTHOR, blockedId: FRIEND }];
    expect(await notifyStoryLike({ id: "s1", authorId: AUTHOR }, { id: FRIEND, name: "F" })).toBe(false);
    expect(await notifyStoryLike({ id: "s1", authorId: AUTHOR }, { id: AUTHOR, name: "A" })).toBe(false);
    expect(notes).toHaveLength(0);
    expect(pushActivityNotification).not.toHaveBeenCalled();
  });
});

describe("who sees likes: the author only", () => {
  beforeEach(async () => {
    users.set(AUTHOR, { ...users.get(AUTHOR)!, postsVisibility: "PUBLIC" });
    as(FRIEND);
    await toggleStoryLike("s1", true);
    as(STRANGER);
    await toggleStoryLike("s1", true);
    views = [
      { storyId: "s1", viewerId: FRIEND, viewedAt: new Date(1), viewer: { id: FRIEND, name: `Name ${FRIEND}` } },
      { storyId: "s1", viewerId: BLOCKED, viewedAt: new Date(2), viewer: { id: BLOCKED, name: `Name ${BLOCKED}` } },
    ];
  });

  it("the author gets the count and no heart of their own", async () => {
    as(AUTHOR);
    const summary = await getStoryReactionSummary("s1");
    expect(summary).toMatchObject({ error: null, liked: false, likeCount: 2 });
  });

  it("a viewer gets their own heart and never a count", async () => {
    as(FRIEND);
    expect(await getStoryReactionSummary("s1")).toMatchObject({ error: null, liked: true, likeCount: null });
    as(BLOCKED);
    expect(await getStoryReactionSummary("s1")).toMatchObject({ error: null, liked: false, likeCount: null });
  });

  it("the author's Seen-by sheet marks who liked, adds a liker with no recorded view, and leaves out blocked likers", async () => {
    as(AUTHOR);
    let result = await getStoryViewers("s1");
    expect(result.likeCount).toBe(2);
    expect(result.viewers.map((v) => [v.id, v.liked]).sort()).toEqual(
      [
        [BLOCKED, false],
        [FRIEND, true],
        [STRANGER, true],
      ].sort(),
    );
    blocks = [{ blockerId: STRANGER, blockedId: AUTHOR }];
    result = await getStoryViewers("s1");
    expect(result.likeCount).toBe(1);
    expect(result.viewers.find((v) => v.id === STRANGER)).toBeUndefined();
  });

  it("nobody but the author gets the sheet", async () => {
    for (const id of [FRIEND, STRANGER, BLOCKED]) {
      as(id);
      expect(await getStoryViewers("s1")).toEqual({ viewers: [], totalCount: 0, likeCount: 0 });
    }
  });

  it("someone who can't see the story gets nothing about its likes", async () => {
    users.set(AUTHOR, { ...users.get(AUTHOR)!, postsVisibility: "CONNECTIONS_ONLY" });
    as(STRANGER);
    expect(await getStoryReactionSummary("s1")).toMatchObject({ error: "not_found", liked: false, likeCount: null });
  });
});
