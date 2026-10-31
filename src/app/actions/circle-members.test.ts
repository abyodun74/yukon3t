import { beforeEach, describe, expect, it, vi } from "vitest";

// loadCircleMembers (actions/circles.ts): "Load more" on a Circle's member lists. Same rule as the Circle page: the
// viewer must see the Circle's content (a PRIVATE Circle only its members, site admins included) and be a member or
// the owner; channel access flags only for a Circle admin and only for a channel of this Circle.

const ME = "cme00000000001";
const CIRCLE = "ccircle0000001";
const CHANNEL = "cchannel000001";
const OTHER_CHANNEL = "cchannel000002";

let user = { id: ME, email: "me@example.com", isAdmin: false };
let membership: { role: string } | null = { role: "MEMBER" };
let circle: { id: string; createdById: string; visibility: "PUBLIC" | "PRIVATE" } | null;
const membershipFindMany = vi.fn();
const channelMembershipFindMany = vi.fn();
const channelFindUnique = vi.fn();
const rateLimit = vi.fn(async () => true);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireUser: async () => user, requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => rateLimit() }));
vi.mock("@/lib/device-id", () => ({ getDeviceId: async () => null, getDeviceLabel: async () => "test" }));
vi.mock("@/lib/device-trust", () => ({ evaluateDevice: vi.fn(), trustDevice: vi.fn(), touchKnownDevice: vi.fn() }));
vi.mock("@/lib/device-challenge", () => ({ createDeviceChallenge: vi.fn(), verifyDeviceChallenge: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ moderateText: vi.fn(), moderateImage: vi.fn(), moderateMediaChecks: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: {},
  HIVE_VIDEO_MODERATION_MAX_SECONDS: 60,
  VIDEO_INSTANT_PUBLISH_MAX_SECONDS: 600,
}));
vi.mock("@/lib/circle-permissions", () => ({
  isCircleAdmin: (c: { createdById: string }, m: { role: string } | null, u: { id: string; isAdmin: boolean }) =>
    c.createdById === u.id || m?.role === "MODERATOR" || u.isAdmin,
  getCircleMembership: async () => membership,
}));
vi.mock("@/lib/cloudflare-stream", () => ({ isStreamConfigured: () => false, createStreamCopy: vi.fn() }));
vi.mock("@/lib/feed-category", () => ({ classifyPostCategory: vi.fn() }));
vi.mock("@/lib/post-created", () => ({ afterPostCreated: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateCircleEmbedding: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn(), notifyBadgeChange: vi.fn() }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: vi.fn() }));
vi.mock("@/lib/blocks", () => ({ isBlockedWithAny: async () => false }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    circle: { findUnique: async () => circle },
    channel: { findUnique: (a: unknown) => channelFindUnique(a) },
    circleMembership: { findMany: (a: unknown) => membershipFindMany(a) },
    channelMembership: { findMany: (a: unknown) => channelMembershipFindMany(a) },
  },
}));

const { loadCircleMembers } = await import("@/app/actions/circles");

function rows(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const n = from + i;
    return {
      id: `cm${String(n).padStart(10, "0")}`,
      joinedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
      role: n === 1 ? "OWNER" : "MEMBER",
      user: { id: `cu${String(n).padStart(10, "0")}`, name: `User ${n}`, username: null, avatarUrl: null },
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: ME, email: "me@example.com", isAdmin: false };
  membership = { role: "MEMBER" };
  circle = { id: CIRCLE, createdById: "cowner00000001", visibility: "PUBLIC" };
  membershipFindMany.mockResolvedValue(rows(1, 51));
  channelMembershipFindMany.mockResolvedValue([]);
  channelFindUnique.mockResolvedValue({ circleId: CIRCLE });
});

describe("loadCircleMembers", () => {
  it("returns a page of 50 with a cursor to the next, selecting only the user fields the lists show", async () => {
    const result = await loadCircleMembers({ circleId: CIRCLE });
    expect(result.error).toBeNull();
    if (result.error !== null) return;
    expect(result.members).toHaveLength(50);
    expect(result.members[0]).toEqual({
      membershipId: "cm0000000001",
      joinedAt: "2026-01-01T00:00:01.000Z",
      role: "OWNER",
      user: { id: "cu0000000001", name: "User 1", username: null, avatarUrl: null },
    });
    expect(result.nextCursor).toEqual({ joinedAt: "2026-01-01T00:00:50.000Z", id: "cm0000000050" });
    const query = membershipFindMany.mock.calls[0][0];
    expect(query.take).toBe(51);
    expect(query.select.user).toEqual({ select: { id: true, name: true, username: true, avatarUrl: true } });
    expect(channelMembershipFindMany).not.toHaveBeenCalled();
  });

  it("continues after the cursor and ends the list", async () => {
    membershipFindMany.mockResolvedValue(rows(51, 3));
    const cursor = { joinedAt: "2026-01-01T00:00:50.000Z", id: "cm0000000050" };
    const result = await loadCircleMembers({ circleId: CIRCLE, cursor });
    expect(result.error === null && result.members.length).toBe(3);
    expect(result.error === null && result.nextCursor).toBeNull();
    expect(membershipFindMany.mock.calls[0][0].where).toEqual({
      circleId: CIRCLE,
      OR: [
        { joinedAt: { gt: new Date(cursor.joinedAt) } },
        { joinedAt: new Date(cursor.joinedAt), id: { gt: cursor.id } },
      ],
    });
  });

  it("lists nobody for a non-member of a PUBLIC Circle, as the page does", async () => {
    membership = null;
    const result = await loadCircleMembers({ circleId: CIRCLE });
    expect(result).toEqual({ error: null, members: [], nextCursor: null });
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("never opens a PRIVATE Circle to a non-member, site admins and its creator included", async () => {
    circle = { id: CIRCLE, createdById: ME, visibility: "PRIVATE" };
    membership = null;
    user = { ...user, isAdmin: true };
    const result = await loadCircleMembers({ circleId: CIRCLE, channelId: CHANNEL });
    expect(result).toEqual({ error: null, members: [], nextCursor: null });
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("lists a PRIVATE Circle's members to a member", async () => {
    circle = { id: CIRCLE, createdById: "cowner00000001", visibility: "PRIVATE" };
    const result = await loadCircleMembers({ circleId: CIRCLE });
    expect(result.error === null && result.members.length).toBe(50);
  });

  it("adds channel access flags for a Circle admin, for this Circle's channel only", async () => {
    membership = { role: "MODERATOR" };
    membershipFindMany.mockResolvedValue(rows(1, 3));
    channelMembershipFindMany.mockResolvedValue([{ userId: "cu0000000002" }]);
    const result = await loadCircleMembers({ circleId: CIRCLE, channelId: CHANNEL });
    expect(result.error === null && result.members.map((m) => m.hasChannelAccess)).toEqual([false, true, false]);
    expect(channelMembershipFindMany.mock.calls[0][0].where).toEqual({
      channelId: CHANNEL,
      userId: { in: ["cu0000000001", "cu0000000002", "cu0000000003"] },
    });

    channelMembershipFindMany.mockClear();
    channelFindUnique.mockResolvedValue({ circleId: "cothercircle01" });
    const elsewhere = await loadCircleMembers({ circleId: CIRCLE, channelId: OTHER_CHANNEL });
    expect(elsewhere.error === null && elsewhere.members.every((m) => m.hasChannelAccess === undefined)).toBe(true);
    expect(channelMembershipFindMany).not.toHaveBeenCalled();
  });

  it("gives a plain member no channel access flags", async () => {
    const result = await loadCircleMembers({ circleId: CIRCLE, channelId: CHANNEL });
    expect(result.error === null && result.members.every((m) => m.hasChannelAccess === undefined)).toBe(true);
    expect(channelFindUnique).not.toHaveBeenCalled();
  });

  it("refuses bad input, unknown Circles and a client over its limit", async () => {
    expect(await loadCircleMembers({ circleId: "not a cuid" })).toEqual({ error: "invalid" });
    expect(await loadCircleMembers({ circleId: CIRCLE, cursor: { joinedAt: "yesterday", id: "x" } })).toEqual({
      error: "invalid",
    });
    circle = null;
    expect(await loadCircleMembers({ circleId: CIRCLE })).toEqual({ error: "not_found" });
    rateLimit.mockResolvedValueOnce(false);
    expect(await loadCircleMembers({ circleId: CIRCLE })).toEqual({ error: "rate_limited" });
  });
});
