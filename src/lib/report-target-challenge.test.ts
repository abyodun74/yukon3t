import { beforeEach, describe, expect, it, vi } from "vitest";

// Reporting a challenge (ReportTargetType CHALLENGE, Gift Universe Phase B, src/lib/report-target.ts): by someone who
// took part in it, while challenges are on for them and they can still see it (a PRIVATE Circle's only while still a
// member); the accused is always its host, read from the challenge itself; a host can't report their own.

let challenge: {
  hostId: string | null;
  circle: { visibility: string; members: { id: string }[] } | null;
  participants: { id: string }[];
} | null;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    challenge: {
      findUnique: async ({ select }: { select: Record<string, unknown> }) =>
        challenge && ("participants" in select ? challenge : { hostId: challenge.hostId }),
    },
  },
}));
vi.mock("@/lib/post-visibility", () => ({ getVisiblePostsWhere: async () => ({}) }));
vi.mock("@/lib/circle-invite-data", () => ({ loadStandingCircleInvites: async () => new Map() }));
vi.mock("@/lib/collab-invites-server", () => ({ loadStandingCollabInvite: async () => null }));

import { accusedUserIdOf, reportableTargetAccused } from "@/lib/report-target";

const participant = { id: "p", isAdmin: true };

beforeEach(() => {
  challenge = { hostId: "host", circle: { visibility: "PUBLIC", members: [] }, participants: [{ id: "row" }] };
});

describe("CHALLENGE reports", () => {
  it("lets a participant report it, naming its host", async () => {
    expect(await reportableTargetAccused("CHALLENGE", "c1", participant)).toBe("host");
    challenge!.circle = null; // a live challenge
    expect(await reportableTargetAccused("CHALLENGE", "c1", participant)).toBe("host");
  });

  it("refuses a non-participant, someone challenges aren't on for, and a PRIVATE Circle's ex-member", async () => {
    challenge!.participants = [];
    expect(await reportableTargetAccused("CHALLENGE", "c1", participant)).toBeNull();
    challenge!.participants = [{ id: "row" }];
    expect(await reportableTargetAccused("CHALLENGE", "c1", { id: "p", isAdmin: false })).toBeNull();
    challenge!.circle = { visibility: "PRIVATE", members: [] };
    expect(await reportableTargetAccused("CHALLENGE", "c1", participant)).toBeNull();
    challenge!.circle = { visibility: "PRIVATE", members: [{ id: "m" }] };
    expect(await reportableTargetAccused("CHALLENGE", "c1", participant)).toBe("host");
  });

  it("never lets the host report their own, nor anyone once the host's account is gone", async () => {
    expect(await reportableTargetAccused("CHALLENGE", "c1", { id: "host", isAdmin: true })).toBeNull();
    challenge!.hostId = null;
    expect(await reportableTargetAccused("CHALLENGE", "c1", participant)).toBeNull();
    challenge = null;
    expect(await reportableTargetAccused("CHALLENGE", "c1", participant)).toBeNull();
  });

  it("finds the host on the admin side", async () => {
    expect(await accusedUserIdOf("CHALLENGE", "c1")).toBe("host");
  });
});
