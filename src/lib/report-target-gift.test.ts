import { beforeEach, describe, expect, it, vi } from "vitest";

// Reporting a digital gift (ReportTargetType GIFT, src/lib/report-target.ts): only its recipient can, only while
// gifts are on for them and the gift is theirs to see; the accused is always the sender, read from the gift itself.

let send: { senderId: string | null; recipientId: string; status: string } | null;

vi.mock("@/lib/prisma", () => ({
  prisma: { giftSend: { findUnique: async () => send } },
}));
vi.mock("@/lib/post-visibility", () => ({ getVisiblePostsWhere: async () => ({}) }));
vi.mock("@/lib/circle-invite-data", () => ({ loadStandingCircleInvites: async () => new Map() }));
vi.mock("@/lib/collab-invites-server", () => ({ loadStandingCollabInvite: async () => null }));

import { accusedUserIdOf, reportableTargetAccused } from "@/lib/report-target";

const recipient = { id: "rec", isAdmin: true };

beforeEach(() => {
  send = { senderId: "snd", recipientId: "rec", status: "OPENED" };
});

describe("GIFT reports", () => {
  it("lets the recipient report a gift they can see, naming the sender", async () => {
    expect(await reportableTargetAccused("GIFT", "g1", recipient)).toBe("snd");
    send!.status = "DELIVERED";
    expect(await reportableTargetAccused("GIFT", "g1", recipient)).toBe("snd");
    send!.status = "HIDDEN_BY_RECIPIENT";
    expect(await reportableTargetAccused("GIFT", "g1", recipient)).toBe("snd");
  });

  it("refuses anyone else, a gift that is gone or revoked, and a recipient gifts aren't on for", async () => {
    expect(await reportableTargetAccused("GIFT", "g1", { id: "someone", isAdmin: true })).toBeNull();
    expect(await reportableTargetAccused("GIFT", "g1", { id: "rec", isAdmin: false })).toBeNull();
    send!.status = "REVOKED";
    expect(await reportableTargetAccused("GIFT", "g1", recipient)).toBeNull();
    send = null;
    expect(await reportableTargetAccused("GIFT", "g1", recipient)).toBeNull();
  });

  it("can't be filed once the sender's account is gone; the admin side still finds the sender while it exists", async () => {
    send!.senderId = null;
    expect(await reportableTargetAccused("GIFT", "g1", recipient)).toBeNull();
    send!.senderId = "snd";
    expect(await accusedUserIdOf("GIFT", "g1")).toBe("snd");
  });
});
