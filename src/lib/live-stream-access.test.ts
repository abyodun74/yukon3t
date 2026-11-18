import { beforeEach, describe, expect, it, vi } from "vitest";

const membershipFindUnique = vi.fn();
const circleFindUnique = vi.fn();
const inviteFindUnique = vi.fn();
const viewerFindUnique = vi.fn();
const blockedWithAny = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    circleMembership: { findUnique: (...a: unknown[]) => membershipFindUnique(...a) },
    circle: { findUnique: (...a: unknown[]) => circleFindUnique(...a) },
    liveStreamInvite: { findUnique: (...a: unknown[]) => inviteFindUnique(...a) },
    liveStreamViewer: { findUnique: (...a: unknown[]) => viewerFindUnique(...a) },
  },
}));
vi.mock("@/lib/blocks", () => ({ isBlockedWithAny: (...a: unknown[]) => blockedWithAny(...a) }));

import { canAccessLiveStream } from "./live-stream-access";
import { filterRecipients } from "./notify-subscribers";
import { isMembersOnly } from "./post-visibility";

const viewer = { id: "viewer", isAdmin: false };

describe("canAccessLiveStream", () => {
  beforeEach(() => {
    membershipFindUnique.mockReset();
    circleFindUnique.mockReset();
  });

  it("lets anyone into an 'Everyone' stream without any lookup", async () => {
    expect(await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: null, targetUserId: null, hostId: "host" }, viewer)).toBe(true);
    expect(circleFindUnique).not.toHaveBeenCalled();
  });

  it("lets anyone into a PUBLIC Circle's stream (it is listed on Home)", async () => {
    circleFindUnique.mockResolvedValue({ visibility: "PUBLIC" });
    membershipFindUnique.mockResolvedValue(null);
    expect(await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: "c1", targetUserId: null, hostId: "host" }, viewer)).toBe(true);
  });

  it("lets a member into a PRIVATE Circle's stream", async () => {
    circleFindUnique.mockResolvedValue({ visibility: "PRIVATE" });
    membershipFindUnique.mockResolvedValue({ id: "m1", role: "MEMBER" });
    expect(await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: "c1", targetUserId: null, hostId: "host" }, viewer)).toBe(true);
  });

  it("keeps a non-member out of a PRIVATE Circle's stream", async () => {
    circleFindUnique.mockResolvedValue({ visibility: "PRIVATE" });
    membershipFindUnique.mockResolvedValue(null);
    expect(await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: "c1", targetUserId: null, hostId: "host" }, viewer)).toBe(false);
  });

  it("denies a stream whose Circle no longer exists", async () => {
    circleFindUnique.mockResolvedValue(null);
    expect(await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: "gone", targetUserId: null, hostId: "host" }, viewer)).toBe(false);
  });

  it("always admits the host and site admins", async () => {
    circleFindUnique.mockResolvedValue({ visibility: "PRIVATE" });
    membershipFindUnique.mockResolvedValue(null);
    expect(await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: "c1", targetUserId: null, hostId: "viewer" }, viewer)).toBe(true);
    expect(
      await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: "c1", targetUserId: null, hostId: "host" }, { id: "x", isAdmin: true }),
    ).toBe(true);
  });

  it("lets only the targeted person into a stream started with one specific user", async () => {
    expect(await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: null, targetUserId: "viewer", hostId: "host" }, viewer)).toBe(true);
    expect(await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: null, targetUserId: "someone-else", hostId: "host" }, viewer)).toBe(
      false,
    );
    expect(circleFindUnique).not.toHaveBeenCalled();
  });

  it("always admits the host of a targeted stream, even if they aren't the target", async () => {
    expect(await canAccessLiveStream({ id: "s1", selectedOnly: false, circleId: null, targetUserId: "someone-else", hostId: "viewer" }, viewer)).toBe(
      true,
    );
  });
});

describe("canAccessLiveStream: Only the people I selected", () => {
  const selected = { id: "s1", selectedOnly: true, circleId: null, targetUserId: null, hostId: "host" };

  beforeEach(() => {
    inviteFindUnique.mockReset().mockResolvedValue(null);
    viewerFindUnique.mockReset().mockResolvedValue(null);
    blockedWithAny.mockReset().mockResolvedValue(false);
  });

  it("lets in a person picked for it (an invite still open, accepted, declined or expired)", async () => {
    for (const status of ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED"]) {
      inviteFindUnique.mockResolvedValue({ status });
      expect(await canAccessLiveStream(selected, viewer)).toBe(true);
    }
    expect(inviteFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { liveStreamId_inviteeId: { liveStreamId: "s1", inviteeId: "viewer" } } }),
    );
  });

  it("keeps out anyone not picked, even though the stream has no Circle or person (it is not Everyone)", async () => {
    expect(await canAccessLiveStream(selected, viewer)).toBe(false);
    expect(circleFindUnique).not.toHaveBeenCalled();
  });

  it("keeps out someone whose invite was cancelled before they accepted it", async () => {
    inviteFindUnique.mockResolvedValue({ status: "CANCELLED" });
    expect(await canAccessLiveStream(selected, viewer)).toBe(false);
  });

  it("keeps someone on stage in, even with a cancelled invite, until they leave", async () => {
    inviteFindUnique.mockResolvedValue({ status: "CANCELLED" });
    viewerFindUnique.mockResolvedValue({ role: "GUEST" });
    expect(await canAccessLiveStream(selected, viewer)).toBe(true);
    viewerFindUnique.mockResolvedValue({ role: "COHOST" });
    expect(await canAccessLiveStream(selected, viewer)).toBe(true);
    // Left the stage (row gone) or only watching: no longer.
    viewerFindUnique.mockResolvedValue({ role: "VIEWER" });
    expect(await canAccessLiveStream(selected, viewer)).toBe(false);
  });

  it("keeps out a picked person once a block stands between them and the host", async () => {
    inviteFindUnique.mockResolvedValue({ status: "PENDING" });
    blockedWithAny.mockResolvedValue(true);
    expect(await canAccessLiveStream(selected, viewer)).toBe(false);
    expect(blockedWithAny).toHaveBeenCalledWith("viewer", ["host"]);
  });

  it("always admits the host and site admins without any lookup", async () => {
    expect(await canAccessLiveStream({ ...selected, hostId: "viewer" }, viewer)).toBe(true);
    expect(await canAccessLiveStream(selected, { id: "x", isAdmin: true })).toBe(true);
    expect(inviteFindUnique).not.toHaveBeenCalled();
  });
});

describe("filterRecipients", () => {
  const subs = [{ subscriberId: "a" }, { subscriberId: "b" }, { subscriberId: "c" }];

  it("keeps everyone when no allow-list is given", () => {
    expect(filterRecipients(subs)).toEqual(subs);
  });

  it("keeps only allow-listed subscribers", () => {
    expect(filterRecipients(subs, ["b", "z"])).toEqual([{ subscriberId: "b" }]);
  });

  it("an empty allow-list notifies nobody (a private Circle with no other members)", () => {
    expect(filterRecipients(subs, [])).toEqual([]);
  });
});

describe("isMembersOnly", () => {
  it("a general post or a PUBLIC Circle's public-channel post is not members-only", () => {
    expect(isMembersOnly(undefined, undefined)).toBe(false);
    expect(isMembersOnly(null, null)).toBe(false);
    expect(isMembersOnly("PUBLIC", "PUBLIC")).toBe(false);
    expect(isMembersOnly("PUBLIC", undefined)).toBe(false);
  });

  it("a PRIVATE Circle's post, or a private channel's, is members-only", () => {
    expect(isMembersOnly("PRIVATE", "PUBLIC")).toBe(true);
    expect(isMembersOnly("PRIVATE", undefined)).toBe(true);
    expect(isMembersOnly("PUBLIC", "PRIVATE")).toBe(true);
  });
});
