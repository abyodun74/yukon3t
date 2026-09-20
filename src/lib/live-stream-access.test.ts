import { beforeEach, describe, expect, it, vi } from "vitest";

const membershipFindUnique = vi.fn();
const circleFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    circleMembership: { findUnique: (...a: unknown[]) => membershipFindUnique(...a) },
    circle: { findUnique: (...a: unknown[]) => circleFindUnique(...a) },
  },
}));

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
    expect(await canAccessLiveStream({ circleId: null, hostId: "host" }, viewer)).toBe(true);
    expect(circleFindUnique).not.toHaveBeenCalled();
  });

  it("lets anyone into a PUBLIC Circle's stream (it is listed on Home)", async () => {
    circleFindUnique.mockResolvedValue({ visibility: "PUBLIC" });
    membershipFindUnique.mockResolvedValue(null);
    expect(await canAccessLiveStream({ circleId: "c1", hostId: "host" }, viewer)).toBe(true);
  });

  it("lets a member into a PRIVATE Circle's stream", async () => {
    circleFindUnique.mockResolvedValue({ visibility: "PRIVATE" });
    membershipFindUnique.mockResolvedValue({ id: "m1", role: "MEMBER" });
    expect(await canAccessLiveStream({ circleId: "c1", hostId: "host" }, viewer)).toBe(true);
  });

  it("keeps a non-member out of a PRIVATE Circle's stream", async () => {
    circleFindUnique.mockResolvedValue({ visibility: "PRIVATE" });
    membershipFindUnique.mockResolvedValue(null);
    expect(await canAccessLiveStream({ circleId: "c1", hostId: "host" }, viewer)).toBe(false);
  });

  it("denies a stream whose Circle no longer exists", async () => {
    circleFindUnique.mockResolvedValue(null);
    expect(await canAccessLiveStream({ circleId: "gone", hostId: "host" }, viewer)).toBe(false);
  });

  it("always admits the host and site admins", async () => {
    circleFindUnique.mockResolvedValue({ visibility: "PRIVATE" });
    membershipFindUnique.mockResolvedValue(null);
    expect(await canAccessLiveStream({ circleId: "c1", hostId: "viewer" }, viewer)).toBe(true);
    expect(await canAccessLiveStream({ circleId: "c1", hostId: "host" }, { id: "x", isAdmin: true })).toBe(true);
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
