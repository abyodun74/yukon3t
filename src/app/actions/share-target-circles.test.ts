import { beforeEach, describe, expect, it, vi } from "vitest";

// getShareTargetCircles (actions/circles.ts): the "Post to a Circle" list when sharing in from another app. Only the
// caller's own memberships, only channels canAccessChannel would let them post in (owner/co-admin: every text
// channel), Circles with none left out, and a private parent's name only for its members.

const ME = "cme00000000001";

let user = { id: ME, email: "me@example.com", isAdmin: false };
let refuse = false;
const membershipFindMany = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireUser: async () => user,
  requireVerifiedUser: async () => {
    if (refuse) throw new Error("not verified");
    return user;
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
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
  getCircleMembership: vi.fn(),
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
  prisma: { circleMembership: { findMany: (a: unknown) => membershipFindMany(a) } },
}));

const { getShareTargetCircles } = await import("@/app/actions/circles");

type Ch = { id: string; name: string; slug: string; type: string; visibility: string; position: number; members: { userId: string }[] };
function ch(id: string, over: Partial<Ch> = {}): Ch {
  return { id, name: id, slug: id, type: "TEXT", visibility: "PUBLIC", position: 0, members: [], ...over };
}
function row(
  role: string,
  circle: { id: string; createdById?: string; parent?: unknown; channels: Ch[] },
) {
  return {
    role,
    circle: {
      name: circle.id,
      slug: circle.id,
      coverImageUrl: null,
      createdById: "cother0000001",
      parent: null,
      ...circle,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: ME, email: "me@example.com", isAdmin: false };
  refuse = false;
});

describe("getShareTargetCircles", () => {
  it("reads only the caller's own memberships", async () => {
    membershipFindMany.mockResolvedValue([]);
    await getShareTargetCircles();
    expect(membershipFindMany.mock.calls[0][0]).toMatchObject({ where: { userId: ME } });
  });

  it("refuses anyone requireVerifiedUser refuses (guests, unverified)", async () => {
    refuse = true;
    await expect(getShareTargetCircles()).rejects.toThrow();
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("offers a member the public and allow-listed channels, and an admin every text channel", async () => {
    const channels = [
      ch("general"),
      ch("staff", { visibility: "PRIVATE", position: 1 }),
      ch("vip", { visibility: "PRIVATE", position: 2, members: [{ userId: ME }] }),
    ];
    membershipFindMany.mockResolvedValue([
      row("MEMBER", { id: "cmember", channels }),
      row("MODERATOR", { id: "ccoadmin", channels }),
      row("OWNER", { id: "cowner", createdById: ME, channels }),
    ]);
    const { circles } = await getShareTargetCircles();
    const byId = Object.fromEntries(circles.map((c) => [c.id, c]));
    expect(byId.cmember.channels.map((c) => c.id)).toEqual(["general", "vip"]);
    expect(byId.cmember.role).toBe("member");
    expect(byId.ccoadmin.channels.map((c) => c.id)).toEqual(["general", "staff", "vip"]);
    expect(byId.ccoadmin.role).toBe("coadmin");
    expect(byId.cowner.channels.map((c) => c.id)).toEqual(["general", "staff", "vip"]);
    expect(byId.cowner.role).toBe("owner");
    expect(byId.ccoadmin.channels.find((c) => c.id === "staff")?.isPrivate).toBe(true);
  });

  it("leaves out a Circle where the caller can't post anywhere", async () => {
    membershipFindMany.mockResolvedValue([
      row("MEMBER", { id: "clocked", channels: [ch("staff", { visibility: "PRIVATE" })] }),
      row("MEMBER", { id: "copen", channels: [ch("general")] }),
    ]);
    const { circles } = await getShareTargetCircles();
    expect(circles.map((c) => c.id)).toEqual(["copen"]);
  });

  it("names a private parent Circle only to its members", async () => {
    membershipFindMany.mockResolvedValue([
      row("MEMBER", { id: "csub1", parent: { name: "Secret", visibility: "PRIVATE", members: [] }, channels: [ch("g")] }),
      row("MEMBER", {
        id: "csub2",
        parent: { name: "Inner", visibility: "PRIVATE", members: [{ id: "m1" }] },
        channels: [ch("g")],
      }),
      row("MEMBER", { id: "csub3", parent: { name: "Open", visibility: "PUBLIC", members: [] }, channels: [ch("g")] }),
    ]);
    const { circles } = await getShareTargetCircles();
    expect(circles.map((c) => c.parentName)).toEqual([null, "Inner", "Open"]);
  });

  it("sends the browser only the fields the picker shows", async () => {
    membershipFindMany.mockResolvedValue([row("MEMBER", { id: "cone", channels: [ch("general")] })]);
    const { circles } = await getShareTargetCircles();
    expect(Object.keys(circles[0]).sort()).toEqual(["channels", "coverImageUrl", "id", "name", "parentName", "role", "slug"]);
    expect(Object.keys(circles[0].channels[0]).sort()).toEqual(["id", "isPrivate", "name", "slug"]);
  });
});
