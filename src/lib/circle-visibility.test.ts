import { describe, expect, it, vi } from "vitest";

// buildVisiblePostsWhere is pure, but post-visibility.ts also holds the database half.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/blocks", () => ({ getBlockedEitherWayIds: vi.fn() }));

import {
  canSeeCircle,
  canSeeCircleContent,
  circleNotificationVisibleWhere,
  hiddenCircleWhere,
  keepCircleContentViewers,
  visibleCircleWhere,
  visibleOrInvitedCircleWhere,
} from "@/lib/circle-visibility";
import { buildVisiblePostsWhere } from "@/lib/post-visibility";

const PUBLIC = { visibility: "PUBLIC" };
const PRIVATE = { visibility: "PRIVATE" };

describe("canSeeCircle", () => {
  it("shows a PUBLIC Circle to everyone", () => {
    expect(canSeeCircle(PUBLIC, { isMember: false })).toBe(true);
    expect(canSeeCircle(PUBLIC, { isMember: true })).toBe(true);
  });

  it("shows a PRIVATE Circle to its members and to a standing invitee only", () => {
    expect(canSeeCircle(PRIVATE, { isMember: true })).toBe(true);
    expect(canSeeCircle(PRIVATE, { isMember: false, hasStandingInvite: true })).toBe(true);
    expect(canSeeCircle(PRIVATE, { isMember: false })).toBe(false);
    expect(canSeeCircle(PRIVATE, { isMember: false, hasStandingInvite: false })).toBe(false);
  });
});

describe("canSeeCircleContent", () => {
  it("opens a PUBLIC Circle to everyone and a PRIVATE one to members only (an invitee sees the header, not inside)", () => {
    expect(canSeeCircleContent(PUBLIC, false)).toBe(true);
    expect(canSeeCircleContent(PRIVATE, true)).toBe(true);
    expect(canSeeCircleContent(PRIVATE, false)).toBe(false);
  });
});

describe("Circle list filters", () => {
  it("lists PUBLIC Circles and the viewer's own PRIVATE ones", () => {
    expect(visibleCircleWhere("u1")).toEqual({
      OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: "u1" } } }],
    });
  });

  it("adds PRIVATE Circles with a PENDING invite for the viewer, for the page's sub-circle list", () => {
    expect(visibleOrInvitedCircleWhere("u1").OR).toContainEqual({
      invites: { some: { inviteeId: "u1", status: "PENDING" } },
    });
  });

  it("names the Circles that don't exist for a viewer", () => {
    expect(hiddenCircleWhere("u1")).toEqual({ visibility: "PRIVATE", members: { none: { userId: "u1" } } });
  });
});

describe("circleNotificationVisibleWhere", () => {
  const where = circleNotificationVisibleWhere("u1");
  const hidden = hiddenCircleWhere("u1");
  const excluded = (where.NOT as { OR: unknown[] }).OR;

  it("drops rows about a hidden Circle by every route a row can point at one", () => {
    expect(excluded).toContainEqual({ channel: { circle: hidden } });
    expect(excluded).toContainEqual({ post: { circle: hidden } });
    expect(excluded).toContainEqual({ post: { repostOf: { circle: hidden } } });
    expect(excluded).toContainEqual({ post: { sharedPost: { circle: hidden } } });
    expect(excluded).toContainEqual({ liveStream: { circle: hidden } });
  });

  it("keeps a row about the Circle itself while the reader holds a PENDING invite, and admins' CIRCLE_CREATED", () => {
    expect(excluded).toContainEqual({
      type: { not: "CIRCLE_CREATED" },
      circle: { ...hidden, invites: { none: { inviteeId: "u1", status: "PENDING" } } },
    });
  });
});

describe("keepCircleContentViewers", () => {
  it("keeps everyone for a PUBLIC Circle", () => {
    expect(keepCircleContentViewers(PUBLIC, ["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("keeps only current members for a PRIVATE one, in order", () => {
    expect(keepCircleContentViewers(PRIVATE, ["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
    expect(keepCircleContentViewers(PRIVATE, ["a"], [])).toEqual([]);
  });
});

describe("buildVisiblePostsWhere", () => {
  const input = { viewerId: "me", circleIds: ["c1"], connectionUserIds: [], blockedIds: new Set<string>() };

  it("lets the author see their own posts only outside PRIVATE Circles (members reach those through membership)", () => {
    const where = buildVisiblePostsWhere(input);
    expect(where.OR).toContainEqual({ circleId: { in: ["c1"] } });
    expect(where.OR).toContainEqual({
      authorId: "me",
      OR: [{ circleId: null }, { circle: { visibility: "PUBLIC" } }],
    });
    expect(where.OR).not.toContainEqual({ authorId: "me" });
  });

  it("hides a repost or share of a post in a PRIVATE Circle the viewer isn't in", () => {
    const where = buildVisiblePostsWhere(input);
    const hiddenOriginal = { circle: { visibility: "PRIVATE" }, circleId: { notIn: ["c1"] } };
    expect(where.NOT.OR).toContainEqual({ repostOf: hiddenOriginal });
    expect(where.NOT.OR).toContainEqual({ sharedPost: hiddenOriginal });
  });

  it("with no memberships, hides a repost or share of any PRIVATE Circle's post", () => {
    const where = buildVisiblePostsWhere({ ...input, circleIds: [] });
    expect(where.NOT.OR).toContainEqual({ repostOf: { circle: { visibility: "PRIVATE" } } });
    expect(where.OR).not.toContainEqual(expect.objectContaining({ circleId: { in: [] } }));
  });

  it("only reaches PRIVATE Circle posts through membership: no other branch admits a post in one", () => {
    const where = buildVisiblePostsWhere({ ...input, connectionUserIds: ["friend"] });
    const others = where.OR.filter((branch) => !("circleId" in branch && JSON.stringify(branch.circleId) === '{"in":["c1"]}'));
    for (const branch of others) {
      const text = JSON.stringify(branch);
      // Each remaining branch is either general-only (circleId: null) or PUBLIC-Circle-only.
      expect(text.includes('"circleId":null') || text.includes('"circle":{"visibility":"PUBLIC"}'), text).toBe(true);
    }
  });
});
