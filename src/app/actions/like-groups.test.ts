import { beforeEach, describe, expect, it, vi } from "vitest";

// Like groups (src/lib/like-groups.ts): a Muse and the feed post(s) of the same video share ONE like count. These run
// the real actions (toggleLike, toggleMuseReaction, toggleMuseRepost, shareToMuse, deleteMuse) against a small
// in-memory database that emulates the Prisma calls they make, the raw SQL in like-groups.ts and the per-group advisory
// lock, so concurrency, visibility, blocks and notifications are checked on real data rather than on call shapes.

type Post = {
  id: string;
  authorId: string;
  likeGroupId: string | null;
  likeCount: number;
  shareCount: number;
  moderationStatus: string;
  visibility: string;
  circleId: string | null;
  repostOfId: string | null;
  mediaType: string;
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  videoDurationSeconds: number | null;
  embedProvider: string | null;
  embedId: string | null;
  content: string;
};
type Muse = {
  id: string;
  authorId: string;
  likeGroupId: string | null;
  likeCount: number;
  repostCount: number;
  shareCount: number;
  moderationStatus: string;
  mediaType: string;
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  videoDurationSeconds: number | null;
  embedProvider: string | null;
  embedId: string | null;
  audioUrl: string | null;
  caption: string | null;
  sharedPostId: string | null;
};
type Like = { id: string; userId: string; postId: string };
type Reaction = { id: string; museId: string; userId: string; emoji: string };

const HEART = "❤️";
const db = {
  posts: new Map<string, Post>(),
  muses: new Map<string, Muse>(),
  likes: [] as Like[],
  reactions: [] as Reaction[],
  museReposts: [] as { id: string; userId: string; museId: string; postId: string | null }[],
  notifications: [] as { recipientId: string; actorId: string; type: string; postId?: string; museId?: string }[],
  blocks: [] as [string, string][],
  /** postId -> users who can't see it (stands in for getVisiblePostsWhere / canViewPost). */
  hiddenFrom: new Map<string, Set<string>>(),
};
/** Every query the actions make, for the batching (no N+1) check. */
const calls: string[] = [];
let idSeq = 0;
const newId = (p: string) => `${p}${(++idSeq).toString().padStart(10, "0")}`;

let currentUser = { id: "cuserA0000001", name: "A", isAdmin: false };
const pushActivityNotification = vi.fn();

function blockedEitherWay(a: string, b: string) {
  return db.blocks.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
function canSee(postId: string, userId: string) {
  const p = db.posts.get(postId);
  return Boolean(p && p.moderationStatus === "PUBLISHED" && !db.hiddenFrom.get(postId)?.has(userId) && !blockedEitherWay(userId, p.authorId));
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function groupLikers(groupId: string) {
  const ids = new Set<string>();
  for (const l of db.likes) if (db.posts.get(l.postId)?.likeGroupId === groupId) ids.add(l.userId);
  for (const r of db.reactions) if (db.muses.get(r.museId)?.likeGroupId === groupId) ids.add(r.userId);
  return ids;
}

type W = Record<string, unknown>;
function matchPost(p: Post, where: W): boolean {
  if (Array.isArray(where.AND)) return (where.AND as W[]).every((w) => matchPost(p, w));
  if ("__visibleTo" in where) return canSee(p.id, where.__visibleTo as string);
  if ("id" in where && p.id !== where.id) return false;
  if ("authorId" in where && p.authorId !== where.authorId) return false;
  if ("likeGroupId" in where) {
    const v = where.likeGroupId as unknown;
    if (v && typeof v === "object" && "not" in (v as W)) return p.likeGroupId !== null;
    if (p.likeGroupId !== v) return false;
  }
  return true;
}
function matchMuse(m: Muse, where: W): boolean {
  if ("id" in where && m.id !== where.id) return false;
  if ("likeGroupId" in where) {
    const v = where.likeGroupId as unknown;
    if (v && typeof v === "object" && "not" in (v as W)) return m.likeGroupId !== null;
    if (m.likeGroupId !== v) return false;
  }
  if ("moderationStatus" in where && m.moderationStatus !== where.moderationStatus) return false;
  if (where.authorId && typeof where.authorId === "object") {
    if (((where.authorId as W).notIn as string[]).includes(m.authorId)) return false;
  } else if ("authorId" in where && m.authorId !== where.authorId) return false;
  return true;
}
function matchLike(l: Like, where: W) {
  if (where.userId && l.userId !== where.userId) return false;
  if (where.post) {
    const p = db.posts.get(l.postId);
    if (!p || !matchPost(p, where.post as W)) return false;
  }
  return true;
}
function matchReaction(r: Reaction, where: W) {
  if (where.userId && r.userId !== where.userId) return false;
  if (where.museId && r.museId !== where.museId) return false;
  if (where.muse) {
    const m = db.muses.get(r.museId);
    if (!m || !matchMuse(m, where.muse as W)) return false;
  }
  return true;
}
function applyData<T extends Record<string, unknown>>(row: T, data: W) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as W)) (row as W)[k] = (row[k] as number) + ((v as W).increment as number);
    else if (v && typeof v === "object" && "decrement" in (v as W)) (row as W)[k] = (row[k] as number) - ((v as W).decrement as number);
    else (row as W)[k] = v;
  }
  return row;
}
function deletePostCascade(id: string) {
  db.posts.delete(id);
  db.likes = db.likes.filter((l) => l.postId !== id);
}
function deleteMuseCascade(id: string) {
  db.muses.delete(id);
  db.reactions = db.reactions.filter((r) => r.museId !== id);
  db.museReposts = db.museReposts.filter((r) => r.museId !== id);
}

// --- the advisory lock: transactions holding the same key run one at a time ---
const lockTails = new Map<string, Promise<void>>();

function makeClient(lock: (key: string) => Promise<void>) {
  const log = async (name: string) => {
    calls.push(name);
    await tick();
  };
  return {
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes("pg_advisory_xact_lock")) {
        calls.push("lock");
        await lock(values[0] as string);
        return 1;
      }
      await log("raw:inherit");
      if (sql.includes('INSERT INTO "Like"')) {
        const [postId, groupId, , authorId] = values as string[];
        let n = 0;
        for (const userId of groupLikers(groupId)) {
          if (blockedEitherWay(userId, authorId)) continue;
          if (db.likes.some((l) => l.userId === userId && l.postId === postId)) continue;
          db.likes.push({ id: newId("clike"), userId, postId });
          n++;
        }
        return n;
      }
      if (sql.includes('INSERT INTO "MuseReaction"')) {
        const [museId, emoji, groupId, , authorId] = values as string[];
        let n = 0;
        for (const userId of groupLikers(groupId)) {
          if (blockedEitherWay(userId, authorId)) continue;
          if (db.reactions.some((r) => r.userId === userId && r.museId === museId)) continue;
          db.reactions.push({ id: newId("creact"), museId, userId, emoji });
          n++;
        }
        return n;
      }
      throw new Error(`unexpected raw SQL: ${sql}`);
    },
    async $queryRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
      await log("raw:count");
      return [{ n: groupLikers(values[0] as string).size }];
    },
    post: {
      async findUnique({ where }: { where: { id: string } }) {
        await log("post.findUnique");
        const p = db.posts.get(where.id);
        return p ? { ...p, circle: null } : null;
      },
      async findFirst({ where }: { where: W }) {
        await log("post.findFirst");
        return [...db.posts.values()].find((p) => matchPost(p, where)) ?? null;
      },
      async findMany({ where, distinct }: { where: W; distinct?: string[] }) {
        await log("post.findMany");
        const rows = [...db.posts.values()].filter((p) => matchPost(p, where));
        return distinct ? [...new Map(rows.map((r) => [r.likeGroupId, r])).values()] : rows;
      },
      async create({ data }: { data: W }) {
        await log("post.create");
        const row = {
          likeGroupId: null,
          likeCount: 0,
          shareCount: 0,
          circleId: null,
          repostOfId: null,
          videoUrl: null,
          videoThumbnailUrl: null,
          videoDurationSeconds: null,
          embedProvider: null,
          embedId: null,
          ...data,
          id: newId("cpost"),
        } as Post;
        db.posts.set(row.id, row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: W }) {
        await log("post.update");
        return applyData(db.posts.get(where.id)!, data);
      },
      async updateMany({ where, data }: { where: W; data: W }) {
        await log("post.updateMany");
        const rows = [...db.posts.values()].filter((p) => matchPost(p, where));
        rows.forEach((p) => applyData(p, data));
        return { count: rows.length };
      },
      async deleteMany({ where }: { where: W }) {
        await log("post.deleteMany");
        const ids =
          where.id && typeof where.id === "object"
            ? ((where.id as W).in as string[])
            : [...db.posts.values()].filter((p) => matchPost(p, where)).map((p) => p.id);
        ids.forEach(deletePostCascade);
        return { count: ids.length };
      },
    },
    muse: {
      async findUnique({ where }: { where: { id: string } }) {
        await log("muse.findUnique");
        const m = db.muses.get(where.id);
        return m ? { ...m, author: { name: "Muse author", username: "museauthor" } } : null;
      },
      async findMany({ where, distinct }: { where: W; distinct?: string[] }) {
        await log("muse.findMany");
        const rows = [...db.muses.values()].filter((m) => matchMuse(m, where));
        return distinct ? [...new Map(rows.map((r) => [r.likeGroupId, r])).values()] : rows;
      },
      async create({ data }: { data: W }) {
        await log("muse.create");
        const row = {
          likeGroupId: null,
          likeCount: 0,
          repostCount: 0,
          shareCount: 0,
          audioUrl: null,
          sharedPostId: null,
          caption: null,
          ...data,
          id: newId("cmuse"),
        } as Muse;
        db.muses.set(row.id, row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: W }) {
        await log("muse.update");
        return applyData(db.muses.get(where.id)!, data);
      },
      async updateMany({ where, data }: { where: W; data: W }) {
        await log("muse.updateMany");
        const rows = [...db.muses.values()].filter((m) => matchMuse(m, where));
        rows.forEach((m) => applyData(m, data));
        return { count: rows.length };
      },
      async delete({ where }: { where: { id: string } }) {
        await log("muse.delete");
        deleteMuseCascade(where.id);
      },
    },
    like: {
      async findUnique({ where }: { where: { userId_postId: { userId: string; postId: string } } }) {
        await log("like.findUnique");
        const { userId, postId } = where.userId_postId;
        return db.likes.find((l) => l.userId === userId && l.postId === postId) ?? null;
      },
      async findMany({ where }: { where: W }) {
        await log("like.findMany");
        return db.likes.filter((l) => matchLike(l, where)).map((l) => ({ post: { likeGroupId: db.posts.get(l.postId)!.likeGroupId } }));
      },
      async create({ data }: { data: { userId: string; postId: string } }) {
        await log("like.create");
        if (db.likes.some((l) => l.userId === data.userId && l.postId === data.postId)) throw new Error("P2002");
        db.likes.push({ id: newId("clike"), ...data });
      },
      async createMany({ data }: { data: { userId: string; postId: string }[] }) {
        await log("like.createMany");
        for (const d of data) {
          if (!db.posts.has(d.postId)) throw new Error("FK");
          if (!db.likes.some((l) => l.userId === d.userId && l.postId === d.postId)) db.likes.push({ id: newId("clike"), ...d });
        }
      },
      async deleteMany({ where }: { where: W }) {
        await log("like.deleteMany");
        const before = db.likes.length;
        db.likes = db.likes.filter((l) => !matchLike(l, where));
        return { count: before - db.likes.length };
      },
      async count({ where }: { where: W }) {
        await log("like.count");
        return db.likes.filter((l) => matchLike(l, where)).length;
      },
    },
    museReaction: {
      async findUnique({ where }: { where: { museId_userId: { museId: string; userId: string } } }) {
        await log("museReaction.findUnique");
        const { museId, userId } = where.museId_userId;
        return db.reactions.find((r) => r.museId === museId && r.userId === userId) ?? null;
      },
      async findMany({ where }: { where: W }) {
        await log("museReaction.findMany");
        return db.reactions.filter((r) => matchReaction(r, where)).map((r) => ({ muse: { likeGroupId: db.muses.get(r.museId)!.likeGroupId } }));
      },
      async create({ data }: { data: { museId: string; userId: string; emoji: string } }) {
        await log("museReaction.create");
        if (db.reactions.some((r) => r.museId === data.museId && r.userId === data.userId)) throw new Error("P2002");
        db.reactions.push({ id: newId("creact"), ...data });
      },
      async createMany({ data }: { data: { museId: string; userId: string; emoji: string }[] }) {
        await log("museReaction.createMany");
        for (const d of data) {
          if (!db.reactions.some((r) => r.museId === d.museId && r.userId === d.userId)) db.reactions.push({ id: newId("creact"), ...d });
        }
      },
      async update({ where, data }: { where: { id: string }; data: { emoji: string } }) {
        await log("museReaction.update");
        db.reactions.find((r) => r.id === where.id)!.emoji = data.emoji;
      },
      async delete({ where }: { where: { id: string } }) {
        await log("museReaction.delete");
        db.reactions = db.reactions.filter((r) => r.id !== where.id);
      },
      async deleteMany({ where }: { where: W }) {
        await log("museReaction.deleteMany");
        const before = db.reactions.length;
        db.reactions = db.reactions.filter((r) => !matchReaction(r, where));
        return { count: before - db.reactions.length };
      },
      async count({ where }: { where: W }) {
        await log("museReaction.count");
        return db.reactions.filter((r) => matchReaction(r, where)).length;
      },
      async groupBy({ where }: { where: { museId: string } }) {
        await log("museReaction.groupBy");
        const counts = new Map<string, number>();
        for (const r of db.reactions) if (r.museId === where.museId) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
        return [...counts].map(([emoji, n]) => ({ emoji, _count: { emoji: n } }));
      },
    },
    museRepost: {
      async findUnique({ where }: { where: { userId_museId: { userId: string; museId: string } } }) {
        await log("museRepost.findUnique");
        const { userId, museId } = where.userId_museId;
        return db.museReposts.find((r) => r.userId === userId && r.museId === museId) ?? null;
      },
      async create({ data }: { data: { userId: string; museId: string; postId: string } }) {
        await log("museRepost.create");
        db.museReposts.push({ id: newId("crepost"), ...data });
      },
      async delete({ where }: { where: { id: string } }) {
        await log("museRepost.delete");
        db.museReposts = db.museReposts.filter((r) => r.id !== where.id);
      },
    },
    notification: {
      async create({ data }: { data: (typeof db.notifications)[number] }) {
        await log("notification.create");
        db.notifications.push(data);
      },
    },
    share: {
      async create() {
        await log("share.create");
      },
    },
  };
}

const prismaFake = {
  ...makeClient(async () => {}),
  async $transaction(arg: unknown) {
    if (Array.isArray(arg)) return Promise.all(arg);
    const releases: (() => void)[] = [];
    const tx = makeClient(async (key) => {
      const prev = lockTails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((r) => (release = r));
      lockTails.set(key, prev.then(() => mine));
      await prev;
      releases.push(release);
    });
    try {
      return await (arg as (t: typeof tx) => Promise<unknown>)(tx);
    } finally {
      releases.forEach((r) => r());
    }
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaFake }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireVerifiedUser: async () => currentUser,
  requireVerifiedViewer: async () => currentUser,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/post-visibility", () => ({
  getVisiblePostsWhere: async (userId: string) => ({ __visibleTo: userId }),
  canViewPost: async (postId: string, userId: string) => canSee(postId, userId),
  isMembersOnlyPost: async () => false,
}));
vi.mock("@/lib/blocks", () => ({
  getBlockedEitherWayIds: async (userId: string) =>
    new Set(db.blocks.flatMap(([a, b]) => (a === userId ? [b] : b === userId ? [a] : []))),
  isBlockedEitherWay: async (a: string, b: string) => blockedEitherWay(a, b),
}));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: (...a: unknown[]) => pushActivityNotification(...a) }));
vi.mock("@/lib/circle-permissions", () => ({ filterCircleContentViewers: async (_c: string, ids: string[]) => ids }));
vi.mock("@/lib/revalidate-post", () => ({ revalidatePostViews: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ moderateMedia: vi.fn(), moderateText: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: {},
  HIVE_VIDEO_MODERATION_MAX_SECONDS: 60,
  MAX_STORY_VIDEO_SECONDS: 120,
  MAX_MUSE_VIDEO_DURATION_SECONDS: 300,
  STORY_LIFETIME_MS: 86_400_000,
  verifyUploadedSize: vi.fn(),
  keyFromPublicUrl: vi.fn(),
}));
vi.mock("@/lib/owned-uploads", () => ({ deleteOwnedUploads: vi.fn() }));
vi.mock("@/lib/cloudflare-stream", () => ({ isStreamConfigured: () => false, createStreamCopy: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn() }));
vi.mock("@/lib/channel-permissions", () => ({ canAccessChannel: vi.fn() }));

const { toggleLike } = await import("@/app/actions/likes");
const { toggleMuseReaction, toggleMuseRepost, deleteMuse } = await import("@/app/actions/muse");
const { shareToMuse } = await import("@/app/actions/shares");

const MUSE_AUTHOR = "cmuseauthor01";
const RESHARER = "cresharer0001";
const A = "cuserA0000001";
const B = "cuserB0000001";
const C = "cuserC0000001";

function as(id: string) {
  currentUser = { id, name: id, isAdmin: false };
}
function addMuse(overrides: Partial<Muse> = {}): Muse {
  const m: Muse = {
    id: newId("cmuse"),
    authorId: MUSE_AUTHOR,
    likeGroupId: null,
    likeCount: 0,
    repostCount: 0,
    shareCount: 0,
    moderationStatus: "PUBLISHED",
    mediaType: "VIDEO",
    videoUrl: "https://media.example/clip.mp4",
    videoThumbnailUrl: null,
    videoDurationSeconds: 20,
    embedProvider: null,
    embedId: null,
    audioUrl: null,
    caption: "clip",
    sharedPostId: null,
    ...overrides,
  };
  db.muses.set(m.id, m);
  return m;
}
function addPost(overrides: Partial<Post> = {}): Post {
  const p: Post = {
    id: newId("cpost"),
    authorId: RESHARER,
    likeGroupId: null,
    likeCount: 0,
    shareCount: 0,
    moderationStatus: "PUBLISHED",
    visibility: "PUBLIC",
    circleId: null,
    repostOfId: null,
    mediaType: "VIDEO",
    videoUrl: "https://media.example/clip.mp4",
    videoThumbnailUrl: null,
    videoDurationSeconds: 20,
    embedProvider: null,
    embedId: null,
    content: "a video",
    ...overrides,
  };
  db.posts.set(p.id, p);
  return p;
}
/** A Muse reshared to Home by RESHARER through the real action: the group both directions start from. */
async function museWithReshare() {
  const muse = addMuse();
  as(RESHARER);
  const res = await toggleMuseRepost(muse.id);
  if (!("reposted" in res) || !res.reposted) throw new Error("reshare failed");
  const postId = db.museReposts.find((r) => r.museId === muse.id)!.postId!;
  return { muse: db.muses.get(muse.id)!, post: db.posts.get(postId)! };
}
const countsOf = (...ids: string[]) => ids.map((id) => (db.posts.get(id) ?? db.muses.get(id))!.likeCount);
const likedPost = (userId: string, postId: string) => db.likes.some((l) => l.userId === userId && l.postId === postId);
const reactedMuse = (userId: string, museId: string) => db.reactions.find((r) => r.userId === userId && r.museId === museId);

beforeEach(() => {
  db.posts.clear();
  db.muses.clear();
  db.likes = [];
  db.reactions = [];
  db.museReposts = [];
  db.notifications = [];
  db.blocks = [];
  db.hiddenFrom.clear();
  lockTails.clear();
  calls.length = 0;
  pushActivityNotification.mockClear();
  as(A);
});

describe("group resolution", () => {
  it("a Muse's reshare post joins the Muse's group, named after the Muse", async () => {
    const { muse, post } = await museWithReshare();
    expect(muse.likeGroupId).toBe(muse.id);
    expect(post.likeGroupId).toBe(muse.id);
  });

  it("a post shared to Muse and the Muse made from it form one group, named after the post", async () => {
    const post = addPost({ authorId: C });
    as(A);
    const res = await shareToMuse(post.id);
    expect(res.error).toBeNull();
    const muse = db.muses.get((res as { museId: string }).museId)!;
    expect(db.posts.get(post.id)!.likeGroupId).toBe(post.id);
    expect(muse.likeGroupId).toBe(post.id);
  });

  it("a reshare post shared to Muse again stays in the same group", async () => {
    const { muse, post } = await museWithReshare();
    as(B);
    const res = await shareToMuse(post.id);
    expect(db.muses.get((res as { museId: string }).museId)!.likeGroupId).toBe(muse.id);
  });
});

describe("one like across Feed and Muse", () => {
  it("a reaction on the Muse likes the reshare post too, with the same count", async () => {
    const { muse, post } = await museWithReshare();
    as(A);
    const res = await toggleMuseReaction(muse.id, "😂");
    expect(res).toMatchObject({ error: null, likeCount: 1 });
    expect(likedPost(A, post.id)).toBe(true);
    expect(reactedMuse(A, muse.id)?.emoji).toBe("😂");
    expect(countsOf(muse.id, post.id)).toEqual([1, 1]);
  });

  it("a like on the reshare post shows on the Muse as a heart, with the same count", async () => {
    const { muse, post } = await museWithReshare();
    as(A);
    expect(await toggleLike(post.id)).toEqual({ error: null, liked: true, likeCount: 1 });
    expect(reactedMuse(A, muse.id)?.emoji).toBe(HEART);
    expect(countsOf(muse.id, post.id)).toEqual([1, 1]);
  });

  it("unliking on either side removes the like from every member", async () => {
    const { muse, post } = await museWithReshare();
    as(A);
    await toggleLike(post.id);
    // The Muse side now holds a heart: picking the heart again is the unlike.
    expect(await toggleMuseReaction(muse.id, HEART)).toMatchObject({ likeCount: 0 });
    expect(likedPost(A, post.id)).toBe(false);
    expect(reactedMuse(A, muse.id)).toBeUndefined();

    await toggleMuseReaction(muse.id, "🔥");
    expect(await toggleLike(post.id)).toEqual({ error: null, liked: false, likeCount: 0 });
    expect(reactedMuse(A, muse.id)).toBeUndefined();
    expect(countsOf(muse.id, post.id)).toEqual([0, 0]);
  });

  it("changing the emoji on the Muse keeps the like and the count", async () => {
    const { muse, post } = await museWithReshare();
    as(A);
    await toggleMuseReaction(muse.id, "😂");
    expect(await toggleMuseReaction(muse.id, "🔥")).toMatchObject({ likeCount: 1 });
    expect(likedPost(A, post.id)).toBe(true);
    expect(countsOf(muse.id, post.id)).toEqual([1, 1]);
  });

  it("counts distinct people: overlapping likers on both sides count once", async () => {
    const { muse, post } = await museWithReshare();
    // Before groups existed: A liked both, B only the post, C only the Muse.
    db.likes.push({ id: "l1", userId: A, postId: post.id }, { id: "l2", userId: B, postId: post.id });
    db.reactions.push({ id: "r1", museId: muse.id, userId: A, emoji: "😂" }, { id: "r2", museId: muse.id, userId: C, emoji: "🔥" });
    as("cuserD0000001");
    expect(await toggleLike(post.id)).toEqual({ error: null, liked: true, likeCount: 4 });
    expect(countsOf(muse.id, post.id)).toEqual([4, 4]);
  });

  it("keeps every member's counter equal to the distinct likers under concurrent likes", async () => {
    const { muse, post } = await museWithReshare();
    const second = addPost({ authorId: B, likeGroupId: muse.id });
    const users = Array.from({ length: 8 }, (_, i) => `cconc${String(i).padStart(8, "0")}`);
    await Promise.all(
      users.map(async (u, i) => {
        currentUser = { id: u, name: u, isAdmin: false };
        const target = i % 3;
        if (target === 0) return toggleLike(post.id);
        if (target === 1) return toggleLike(second.id);
        return toggleMuseReaction(muse.id, "👍");
      }),
    );
    expect(countsOf(muse.id, post.id, second.id)).toEqual([8, 8, 8]);
    for (const u of users) {
      expect(likedPost(u, post.id) && likedPost(u, second.id) && Boolean(reactedMuse(u, muse.id))).toBe(true);
    }
  });

  it("leaves ordinary posts alone (no group: own likes, own count)", async () => {
    const post = addPost({ authorId: C, likeCount: 2 });
    as(A);
    expect(await toggleLike(post.id)).toEqual({ error: null, liked: true, likeCount: 3 });
    expect(calls).not.toContain("lock");
  });
});

describe("notifications", () => {
  it("notifies the owner of the side liked, once per liker for the group, never for propagated likes", async () => {
    const { muse, post } = await museWithReshare();
    db.notifications = [];
    pushActivityNotification.mockClear();
    as(A);
    await toggleMuseReaction(muse.id, "😂");
    await toggleMuseReaction(muse.id, "🔥"); // emoji swap: still the same like
    expect(db.notifications).toEqual([{ recipientId: MUSE_AUTHOR, actorId: A, type: "MUSE_LIKE", museId: muse.id }]);

    as(B);
    await toggleLike(post.id);
    expect(db.notifications.slice(1)).toEqual([{ recipientId: RESHARER, actorId: B, type: "POST_LIKE", postId: post.id }]);
    expect(pushActivityNotification).toHaveBeenCalledTimes(2);
  });

  it("does not notify again when someone already counted likes another member", async () => {
    const { muse, post } = await museWithReshare();
    // A liked the Muse before the reshare post existed in their view (hidden), so the post holds no like of theirs.
    db.hiddenFrom.set(post.id, new Set([A]));
    as(A);
    await toggleMuseReaction(muse.id, "😂");
    db.hiddenFrom.clear();
    db.notifications = [];
    await toggleLike(post.id);
    expect(likedPost(A, post.id)).toBe(true);
    expect(db.notifications).toEqual([]);
    expect(countsOf(muse.id, post.id)).toEqual([1, 1]);
  });
});

describe("visibility and blocks", () => {
  it("never creates a like on a member the liker can't see, but counts them once everywhere", async () => {
    const { muse, post } = await museWithReshare();
    db.hiddenFrom.set(post.id, new Set([A]));
    as(A);
    await toggleMuseReaction(muse.id, "😂");
    expect(likedPost(A, post.id)).toBe(false);
    expect(countsOf(muse.id, post.id)).toEqual([1, 1]);
  });

  it("never adds a reaction to a Muse whose author is blocked either way with the liker", async () => {
    const { muse, post } = await museWithReshare();
    db.blocks.push([MUSE_AUTHOR, A]);
    as(A);
    await toggleLike(post.id);
    expect(reactedMuse(A, muse.id)).toBeUndefined();
    expect(countsOf(muse.id, post.id)).toEqual([1, 1]);
  });

  it("refuses a like on a post the viewer can't see", async () => {
    const { post } = await museWithReshare();
    db.hiddenFrom.set(post.id, new Set([A]));
    as(A);
    expect(await toggleLike(post.id)).toEqual({ error: "not_found" });
    expect(db.likes).toEqual([]);
  });
});

describe("members joining and leaving", () => {
  it("a new reshare inherits the group's likers and count at once (minus people blocked with the resharer)", async () => {
    const muse = addMuse();
    as(A);
    await toggleMuseReaction(muse.id, "😂");
    as(B);
    await toggleMuseReaction(muse.id, "🔥");
    db.blocks.push([RESHARER, B]);
    as(RESHARER);
    await toggleMuseRepost(muse.id);
    const postId = db.museReposts[0].postId!;
    expect(likedPost(A, postId)).toBe(true);
    expect(likedPost(B, postId)).toBe(false);
    expect(countsOf(muse.id, postId)).toEqual([2, 2]);
  });

  it("a Muse shared from a liked post inherits its likers as hearts", async () => {
    const post = addPost({ authorId: C });
    as(A);
    await toggleLike(post.id); // ordinary post at this point: no group yet
    as(B);
    const res = await shareToMuse(post.id);
    const museId = (res as { museId: string }).museId;
    expect(reactedMuse(A, museId)?.emoji).toBe(HEART);
    expect(countsOf(museId, post.id)).toEqual([1, 1]);
  });

  it("undoing the reshare deletes only that post's likes; the Muse keeps its own and is recounted", async () => {
    const { muse, post } = await museWithReshare();
    as(A);
    await toggleLike(post.id);
    // B could see only the post: their like lives only there.
    db.blocks.push([MUSE_AUTHOR, B]);
    as(B);
    await toggleLike(post.id);
    expect(countsOf(muse.id)).toEqual([2]);
    as(RESHARER);
    await toggleMuseRepost(muse.id);
    expect(db.posts.has(post.id)).toBe(false);
    expect(reactedMuse(A, muse.id)?.emoji).toBe(HEART);
    expect(countsOf(muse.id)).toEqual([1]);
  });

  it("deleting the Muse keeps the reshare post's likes and its count", async () => {
    const { muse, post } = await museWithReshare();
    as(A);
    await toggleMuseReaction(muse.id, "😂");
    as(MUSE_AUTHOR);
    expect(await deleteMuse(muse.id)).toEqual({ error: null });
    expect(likedPost(A, post.id)).toBe(true);
    expect(countsOf(post.id)).toEqual([1]);
  });
});

describe("batching", () => {
  it("a like costs the same number of queries whatever the group's size", async () => {
    const small = await museWithReshare();
    as(A);
    calls.length = 0;
    await toggleLike(small.post.id);
    const smallCalls = calls.length;

    const big = await museWithReshare();
    for (let i = 0; i < 25; i++) addPost({ authorId: `cbig${String(i).padStart(9, "0")}`, likeGroupId: big.muse.id });
    for (let i = 0; i < 10; i++) addMuse({ authorId: `cbm${String(i).padStart(10, "0")}`, likeGroupId: big.muse.id });
    as(A);
    calls.length = 0;
    await toggleLike(big.post.id);
    expect(calls.length).toBe(smallCalls);
    expect(countsOf(big.muse.id)).toEqual([1]);
    expect([...db.posts.values()].filter((p) => p.likeGroupId === big.muse.id).every((p) => p.likeCount === 1)).toBe(true);
  });
});
