import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { circleMembership: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

import { canAccessLiveStream } from "./live-stream-access";
import { filterRecipients } from "./notify-subscribers";

const viewer = { id: "viewer", isAdmin: false };

describe("canAccessLiveStream", () => {
  beforeEach(() => findUnique.mockReset());

  it("lets anyone into an 'Everyone' stream without touching membership", async () => {
    expect(await canAccessLiveStream({ circleId: null, hostId: "host" }, viewer)).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("lets a member into their Circle's stream", async () => {
    findUnique.mockResolvedValue({ id: "m1", role: "MEMBER" });
    expect(await canAccessLiveStream({ circleId: "c1", hostId: "host" }, viewer)).toBe(true);
  });

  it("keeps a non-member out of a Circle's stream", async () => {
    findUnique.mockResolvedValue(null);
    expect(await canAccessLiveStream({ circleId: "c1", hostId: "host" }, viewer)).toBe(false);
  });

  it("always admits the host and site admins", async () => {
    findUnique.mockResolvedValue(null);
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

  it("an empty allow-list notifies nobody (a Circle with no other members)", () => {
    expect(filterRecipients(subs, [])).toEqual([]);
  });
});
