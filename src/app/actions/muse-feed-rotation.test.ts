import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findManyInMemory } from "@/lib/test-support/in-memory-where";
import { FEED_ORDER_COOKIE, decodeRotationCursor, isRotationCursor, permalinkRotationCursor } from "@/lib/feed-rotation";

// getMuseFeed (actions/muse.ts): a fresh recency-weighted mix every 15 minutes by default, newest first with the
// Latest switch; either way only PUBLISHED Muses by authors not blocked either way. A rotation cursor continues its
// mix whatever the switch says now; a plain id continues newest first; a permalink's cursor leaves its Muse out.

const ME = "cme0000000001";
const BLOCKED = "cblocked00001";
const NOW = Date.UTC(2026, 10, 17, 12, 5);
const HOUR = 3_600_000;
const user = { id: ME, isAdmin: false };

type FakeMuse = { id: string; createdAt: Date; authorId: string; moderationStatus: "PUBLISHED" | "FLAGGED" };
let muses: FakeMuse[] = [];
let orderCookie: string | undefined;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === FEED_ORDER_COOKIE && orderCookie ? { name, value: orderCookie } : undefined),
  }),
}));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedViewer: async () => user, requireVerifiedUser: async () => user }));
vi.mock("@/lib/post-visibility", () => ({ getVisiblePostsWhere: async () => ({}) }));
vi.mock("@/lib/blocks", () => ({
  getBlockedEitherWayIds: async () => new Set([BLOCKED]),
  isBlockedEitherWay: async () => false,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({ moderateMedia: vi.fn(), moderateText: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: {},
  HIVE_VIDEO_MODERATION_MAX_SECONDS: 60,
  MAX_STORY_VIDEO_SECONDS: 120,
  STORY_LIFETIME_MS: 86_400_000,
  verifyUploadedSize: vi.fn(),
  keyFromPublicUrl: vi.fn(),
}));
vi.mock("@/lib/owned-uploads", () => ({ deleteOwnedUploads: vi.fn() }));
vi.mock("@/lib/cloudflare-stream", () => ({ isStreamConfigured: () => false, createStreamCopy: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    muse: {
      findMany: async (args: Parameters<typeof findManyInMemory>[1]) =>
        findManyInMemory(muses, args).map((m) => ({
          ...m,
          caption: null,
          mediaType: "VIDEO",
          videoUrl: `https://media.example/${m.id}.mp4`,
          videoThumbnailUrl: null,
          videoDurationSeconds: 20,
          embedProvider: null,
          embedId: null,
          audioUrl: null,
          likeCount: 0,
          commentCount: 0,
          shareCount: 0,
          repostCount: 0,
          viewCount: 0,
          sharedPostId: null,
          likeGroupId: null,
          author: { id: m.authorId, name: "A", avatarUrl: null },
          reactions: [],
          reposts: [],
        })),
    },
    subscription: { findMany: async () => [] },
  },
}));

const { getMuseFeed } = await import("@/app/actions/muse");

async function readAll(cursor: string | null = null) {
  const seen: string[] = [];
  let next: string | null = cursor;
  let first = true;
  for (let i = 0; i < 100 && (first || next); i++) {
    const page = await getMuseFeed({ cursor: next });
    seen.push(...page.items.map((m) => m.id));
    next = page.nextCursor;
    first = false;
  }
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  orderCookie = undefined;
  muses = [
    ...Array.from({ length: 40 }, (_, i) => ({
      id: `cmuse${String(i).padStart(8, "0")}`,
      createdAt: new Date(NOW - 10 * 60_000 - i * 5 * HOUR),
      authorId: "cauthor000001",
      moderationStatus: "PUBLISHED" as const,
    })),
    { id: "cblockedmuse1", createdAt: new Date(NOW - HOUR), authorId: BLOCKED, moderationStatus: "PUBLISHED" },
    { id: "cflaggedmuse1", createdAt: new Date(NOW - 2 * HOUR), authorId: "cauthor000001", moderationStatus: "FLAGGED" },
  ];
});

afterEach(() => {
  vi.useRealTimers();
});

const visibleIds = () => muses.filter((m) => m.id.startsWith("cmuse")).map((m) => m.id);

describe("getMuseFeed", () => {
  it("is a rotated mix by default, covering every visible Muse once and no blocked or held one", async () => {
    const first = await getMuseFeed();
    expect(isRotationCursor(first.nextCursor)).toBe(true);
    const seen = await readAll();
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(visibleIds().sort());
    expect(seen).not.toEqual(visibleIds());
    expect(seen).not.toContain("cblockedmuse1");
    expect(seen).not.toContain("cflaggedmuse1");
  });

  it("is newest first with the Latest switch, paged by plain ids", async () => {
    orderCookie = "latest";
    const first = await getMuseFeed();
    expect(isRotationCursor(first.nextCursor)).toBe(false);
    expect(first.nextCursor).toBe(first.items[first.items.length - 1].id);
    expect(await readAll()).toEqual(visibleIds());
  });

  it("follows the cursor, not the switch, once a feed has started", async () => {
    const first = await getMuseFeed();
    orderCookie = "latest";
    const second = await getMuseFeed({ cursor: first.nextCursor });
    expect(isRotationCursor(second.nextCursor)).toBe(true);
    orderCookie = undefined;
    const rest = await readAll();
    expect(rest.slice(10, 20)).toEqual(second.items.map((m) => m.id));
  });

  it("starts a permalink's feed at the top of the mix without that Muse", async () => {
    const all = await readAll();
    const target = all[3];
    const seen = await readAll(permalinkRotationCursor(target, NOW));
    expect(seen).toEqual(all.filter((id) => id !== target));
    const page = await getMuseFeed({ cursor: permalinkRotationCursor(target, NOW) });
    expect(decodeRotationCursor(page.nextCursor)).toMatchObject({ x: target });
  });
});
