import { beforeEach, describe, expect, it, vi } from "vitest";

// setRsvp against a mocked database: Going / Maybe / taking a reply back, the recount, who is told.
const user = { id: "me", isAdmin: false };
const checkRateLimit = vi.fn();
const canViewPost = vi.fn();
const notifySubscribers = vi.fn();
const notificationCreate = vi.fn();
const postFindUnique = vi.fn();
let rows: { userId: string; status: "GOING" | "MAYBE" }[] = [];
const postUpdate = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: (...a: unknown[]) => notifySubscribers(...a) }));
vi.mock("@/lib/post-visibility", () => ({
  canViewPost: (...a: unknown[]) => canViewPost(...a),
  isMembersOnlyPost: async () => false,
}));
vi.mock("@/lib/circle-permissions", () => ({
  filterCircleContentViewers: async (_c: string, ids: string[]) => ids,
}));
vi.mock("@/lib/prisma", () => {
  const key = (where: { userId_postId: { userId: string } }) => where.userId_postId.userId;
  const tx = {
    $queryRaw: vi.fn(async () => []),
    postRsvp: {
      findUnique: async ({ where }: { where: { userId_postId: { userId: string } } }) =>
        rows.find((r) => r.userId === key(where)) ?? null,
      create: async ({ data }: { data: { userId: string; status: "GOING" | "MAYBE" } }) => {
        rows.push({ userId: data.userId, status: data.status });
      },
      update: async ({ where, data }: { where: { userId_postId: { userId: string } }; data: { status: "GOING" | "MAYBE" } }) => {
        rows = rows.map((r) => (r.userId === key(where) ? { ...r, status: data.status } : r));
      },
      delete: async ({ where }: { where: { userId_postId: { userId: string } } }) => {
        rows = rows.filter((r) => r.userId !== key(where));
      },
      groupBy: async () =>
        (["GOING", "MAYBE"] as const)
          .map((status) => ({ status, _count: { _all: rows.filter((r) => r.status === status).length } }))
          .filter((g) => g._count._all > 0),
    },
    post: { update: (...a: unknown[]) => postUpdate(...a) },
  };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      post: { findUnique: (...a: unknown[]) => postFindUnique(...a) },
      notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    },
  };
});

import { setRsvp } from "@/app/actions/rsvp";

const event = {
  id: "p1",
  authorId: "author",
  circleId: "c1",
  channelId: null,
  eventAt: new Date(Date.now() + 86_400_000),
  eventCancelledAt: null,
  moderationStatus: "PUBLISHED",
  circle: { slug: "runners" },
};

beforeEach(() => {
  vi.clearAllMocks();
  rows = [{ userId: "other", status: "GOING" }];
  checkRateLimit.mockResolvedValue(true);
  canViewPost.mockResolvedValue(true);
  postFindUnique.mockResolvedValue(event);
});

describe("setRsvp", () => {
  it("answers Maybe without telling the author or subscribers, and recounts both", async () => {
    expect(await setRsvp("p1", { status: "MAYBE" })).toEqual({ error: null, status: "MAYBE", rsvpCount: 1, maybeCount: 1 });
    expect(postUpdate).toHaveBeenCalledWith({ where: { id: "p1" }, data: { rsvpCount: 1, maybeCount: 1 } });
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(notifySubscribers).not.toHaveBeenCalled();
  });
  it("switches Maybe to Going and tells the author then, once", async () => {
    rows.push({ userId: "me", status: "MAYBE" });
    expect(await setRsvp("p1", { status: "GOING" })).toMatchObject({ status: "GOING", rsvpCount: 2, maybeCount: 0 });
    expect(notificationCreate.mock.calls[0][0].data).toMatchObject({ recipientId: "author", type: "EVENT_RSVP" });
    expect(notifySubscribers).toHaveBeenCalledWith("me", "SUBSCRIPTION_RSVP", { postId: "p1" });
    vi.clearAllMocks();
    await setRsvp("p1", { status: "GOING" });
    expect(notificationCreate).not.toHaveBeenCalled();
  });
  it("takes a reply back", async () => {
    rows.push({ userId: "me", status: "GOING" });
    expect(await setRsvp("p1", { status: null })).toEqual({ error: null, status: null, rsvpCount: 1, maybeCount: 0 });
    expect(rows.some((r) => r.userId === "me")).toBe(false);
  });
  it("refuses a cancelled or hidden event, an unknown status, and when rate limited", async () => {
    postFindUnique.mockResolvedValue({ ...event, eventCancelledAt: new Date() });
    expect(await setRsvp("p1", { status: "GOING" })).toEqual({ error: "cancelled" });
    postFindUnique.mockResolvedValue(event);
    canViewPost.mockResolvedValue(false);
    expect(await setRsvp("p1", { status: "GOING" })).toEqual({ error: "not_found" });
    expect(await setRsvp("p1", { status: "INTERESTED" })).toEqual({ error: "invalid" });
    checkRateLimit.mockResolvedValue(false);
    expect(await setRsvp("p1", { status: "GOING" })).toEqual({ error: "rate_limited" });
    expect(rows).toEqual([{ userId: "other", status: "GOING" }]);
  });
  it("keeps working for an event post outside any Circle", async () => {
    postFindUnique.mockResolvedValue({ ...event, circleId: null, circle: null });
    expect(await setRsvp("p1", { status: "GOING" })).toMatchObject({ error: null, rsvpCount: 2 });
  });
});
