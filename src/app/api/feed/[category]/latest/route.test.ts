import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findManyInMemory } from "@/lib/test-support/in-memory-where";
import { encodeRotationCursor, rotationBucket } from "@/lib/feed-rotation";

// /api/feed/[category]/latest: Home's "Load more" and "newer posts" fetches. With rotation (the default) Load more
// follows a rotation cursor through the same 15-minute mix; every id query and the card query use the viewer's normal
// listable-posts rules, so blocked authors, held (FLAGGED) posts and HIDDEN accounts never appear; the admin
// "include private posts" view stays newest first.

const ME = "cme0000000001";
const BLOCKED = "cblocked00001";
const HIDDEN_AUTHOR = "chidden000001";
const NOW = Date.UTC(2026, 10, 17, 12, 5);
const HOUR = 3_600_000;

type FakePost = {
  id: string;
  createdAt: Date;
  authorId: string;
  moderationStatus: "PUBLISHED" | "FLAGGED";
  visibility: "PUBLIC" | "CONNECTIONS_ONLY";
  author: { status: "ACTIVE"; postsVisibility: "PUBLIC" | "HIDDEN" };
};

let posts: FakePost[] = [];
let user = { id: ME, isAdmin: false };
// Runs once, just before the card (hydration) query: a change landing between the id query and the cards.
let beforeCards: (() => void) | null = null;
const findMany = vi.fn((args: Parameters<typeof findManyInMemory>[1]) => {
  if (beforeCards && JSON.stringify(args?.where).includes('"id":{"in"')) {
    beforeCards();
    beforeCards = null;
  }
  return Promise.resolve(findManyInMemory(posts, args));
});

// The viewer's listable posts, standing in for getListablePostsWhere: published, not blocked either way, not from a
// HIDDEN account, and here also not CONNECTIONS_ONLY (this viewer has no connections).
const LISTABLE = {
  AND: [
    { moderationStatus: "PUBLISHED" },
    { NOT: { authorId: { in: [BLOCKED] } } },
    { NOT: { author: { postsVisibility: "HIDDEN" } } },
    { visibility: "PUBLIC" },
  ],
};

vi.mock("@/lib/auth-guards", () => {
  class AuthError extends Error {}
  return { AuthError, requireViewer: async () => user };
});
vi.mock("@/lib/prisma", () => ({ prisma: { post: { findMany: (a: never) => findMany(a) } } }));
vi.mock("@/lib/post-card-data", () => ({
  postCardInclude: {},
  attachViewerState: async (rows: FakePost[]) => rows,
}));
vi.mock("@/lib/post-visibility", () => ({
  getListablePostsWhere: async () => LISTABLE,
  NOT_MEMBERS_ONLY: {},
  LEAD_POST_ONLY: {},
}));
vi.mock("@/lib/feed-category", () => ({ buildCategoryFilter: async () => undefined }));

const { GET } = await import("./route");

function post(id: string, createdAtMs: number, extra: Partial<FakePost> = {}): FakePost {
  return {
    id,
    createdAt: new Date(createdAtMs),
    authorId: "cauthor000001",
    moderationStatus: "PUBLISHED",
    visibility: "PUBLIC",
    author: { status: "ACTIVE", postsVisibility: "PUBLIC" },
    ...extra,
  };
}

async function get(query: string) {
  const res = await GET(new Request(`https://yukon3t.com/api/feed/all/latest?${query}`), {
    params: Promise.resolve({ category: "all" }),
  });
  const body = (await res.json()) as { posts: FakePost[]; hasMore?: boolean; nextCursor?: string | null };
  return { status: res.status, ...body, ids: (body.posts ?? []).map((p) => p.id) };
}

const startCursor = () => encodeRotationCursor({ m: "r", b: rotationBucket(NOW), t: NOW, i: 0, l: null });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  user = { id: ME, isAdmin: false };
  findMany.mockClear();
  beforeCards = null;
  posts = [
    ...Array.from({ length: 50 }, (_, i) => post(`cpost${String(i).padStart(8, "0")}`, NOW - 10 * 60_000 - i * 3 * HOUR)),
    post("cblockedpost1", NOW - 2 * HOUR, { authorId: BLOCKED }),
    post("cflaggedpost1", NOW - 3 * HOUR, { moderationStatus: "FLAGGED" }),
    post("chiddenpost01", NOW - 4 * HOUR, { authorId: HIDDEN_AUTHOR, author: { status: "ACTIVE", postsVisibility: "HIDDEN" } }),
    post("cconnonly0001", NOW - 5 * HOUR, { visibility: "CONNECTIONS_ONLY" }),
  ];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rotated Load more", () => {
  it("pages through every listable post exactly once and nothing else", async () => {
    const seen: string[] = [];
    let cursor: string | null = startCursor();
    for (let i = 0; cursor && i < 50; i++) {
      const page = await get(`cursor=${encodeURIComponent(cursor)}&limit=20`);
      expect(page.status).toBe(200);
      seen.push(...page.ids);
      expect(page.hasMore).toBe(page.nextCursor !== null);
      cursor = page.nextCursor ?? null;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(posts.filter((p) => p.id.startsWith("cpost")).map((p) => p.id).sort());
    for (const hidden of ["cblockedpost1", "cflaggedpost1", "chiddenpost01", "cconnonly0001"]) {
      expect(seen).not.toContain(hidden);
    }
    // A mix, not newest first.
    const chronological = posts.filter((p) => p.id.startsWith("cpost")).map((p) => p.id);
    expect(seen).not.toEqual(chronological);
  });

  it("applies the viewer's rules to the id queries and to the cards", async () => {
    await get(`cursor=${encodeURIComponent(startCursor())}&limit=20`);
    expect(findMany).toHaveBeenCalled();
    for (const [args] of findMany.mock.calls) {
      expect(JSON.stringify(args?.where)).toContain(JSON.stringify(LISTABLE));
    }
  });

  it("drops a post that became invisible between the id query and the cards", async () => {
    const first = await get(`cursor=${encodeURIComponent(startCursor())}&limit=5`);
    const target = posts.find((p) => p.id === first.ids[0])!;
    beforeCards = () => {
      target.moderationStatus = "FLAGGED";
    };
    const again = await get(`cursor=${encodeURIComponent(startCursor())}&limit=5`);
    expect(again.ids).toEqual(first.ids.slice(1));
  });

  it("refuses a malformed cursor", async () => {
    expect((await get("cursor=r1.notvalid!!")).status).toBe(400);
    expect((await get("cursor=garbage")).status).toBe(400);
  });
});

describe("newest first", () => {
  it("the admin view ignores a rotation cursor and stays newest first, including posts outside the viewer's own rules", async () => {
    user = { id: ME, isAdmin: true };
    const page = await get(`scope=all&cursor=${encodeURIComponent(startCursor())}&limit=20`);
    expect(page.nextCursor).toBeUndefined();
    const times = page.posts.map((p) => new Date(p.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(page.ids).toContain("cconnonly0001");
    expect(page.ids).not.toContain("cflaggedpost1");
  });

  it("a non-admin asking for scope=all gets their own rules", async () => {
    const page = await get(`scope=all&before=${posts[0].id}&limit=20`);
    expect(page.ids).not.toContain("cconnonly0001");
  });

  it("pages posts made in the same millisecond in one stable order (id breaks the tie)", async () => {
    const same = NOW - HOUR;
    posts = ["cb", "ca", "cd", "cc", "ce"].map((id) => post(`${id}000000000`, same));
    const first = await get(`before=${posts.find((p) => p.id === "ce000000000")!.id}&limit=5`);
    expect(first.ids).toEqual(["cd000000000", "cc000000000", "cb000000000", "ca000000000"]);
    for (const [args] of findMany.mock.calls) {
      expect(args?.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    }
  });

  it("the newer-posts fetch returns only posts after the given time, newest first", async () => {
    posts.push(post("cnewer0000001", NOW - 60_000), post("cnewer0000002", NOW - 30_000));
    const page = await get(`after=${encodeURIComponent(new Date(NOW - 5 * 60_000).toISOString())}`);
    expect(page.ids).toEqual(["cnewer0000002", "cnewer0000001"]);
  });
});
