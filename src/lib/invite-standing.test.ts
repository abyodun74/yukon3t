import { describe, it, expect } from "vitest";
import { holdsInviteRight, inviterStillQualifies, pendingInviteClaimWhere } from "@/lib/invite-standing";

describe("holdsInviteRight", () => {
  it("allows the owner whatever their role, and only the listed roles otherwise", () => {
    expect(holdsInviteRight("owner", "owner", null, ["MODERATOR"])).toBe(true);
    expect(holdsInviteRight("owner", "mod", "MODERATOR", ["MODERATOR"])).toBe(true);
    expect(holdsInviteRight("owner", "x", "OWNER", ["OWNER", "MODERATOR"])).toBe(true);
    expect(holdsInviteRight("owner", "x", "OWNER", ["MODERATOR"])).toBe(false);
    expect(holdsInviteRight("owner", "x", "MEMBER", ["MODERATOR"])).toBe(false);
    expect(holdsInviteRight("owner", "x", null, ["MODERATOR"])).toBe(false);
    expect(holdsInviteRight("owner", "x", undefined, ["MODERATOR"])).toBe(false);
  });
});

describe("inviterStillQualifies", () => {
  it("needs an ACTIVE account as well as the right to invite", () => {
    expect(inviterStillQualifies("owner", { id: "owner", status: "ACTIVE" }, null, ["MODERATOR"])).toBe(true);
    expect(inviterStillQualifies("owner", { id: "owner", status: "SUSPENDED" }, null, ["MODERATOR"])).toBe(false);
    expect(inviterStillQualifies("owner", { id: "mod", status: "ACTIVE" }, "MODERATOR", ["MODERATOR"])).toBe(true);
    expect(inviterStillQualifies("owner", { id: "mod", status: "ACTIVE" }, "MEMBER", ["MODERATOR"])).toBe(false);
    expect(inviterStillQualifies("owner", null, "MODERATOR", ["MODERATOR"])).toBe(false);
    expect(inviterStillQualifies("owner", undefined, "MODERATOR", ["MODERATOR"])).toBe(false);
  });
});

describe("pendingInviteClaimWhere", () => {
  const where = pendingInviteClaimWhere({ id: "i1", inviteeId: "me", inviterId: "mod" });

  it("claims only the invitee's PENDING row from the inviter that was judged", () => {
    expect(where).toEqual({ id: "i1", inviteeId: "me", status: "PENDING", inviterId: "mod" });
  });

  // The DB applies `where` as an equality match; this is that match, so the cases a guarded claim must refuse are pinned.
  const matches = (row: { id: string; inviteeId: string; status: string; inviterId: string }) =>
    row.id === where.id &&
    row.inviteeId === where.inviteeId &&
    row.status === where.status &&
    row.inviterId === where.inviterId;

  it("matches nothing once the invite was answered, cancelled or re-sent by someone else", () => {
    const row = { id: "i1", inviteeId: "me", status: "PENDING", inviterId: "mod" };
    expect(matches(row)).toBe(true);
    // A second accept (double tap) or an accept after a decline: the row is no longer PENDING.
    expect(matches({ ...row, status: "ACCEPTED" })).toBe(false);
    expect(matches({ ...row, status: "DECLINED" })).toBe(false);
    // Re-sent by another admin in between (same row, new inviter): the old judgement doesn't carry over.
    expect(matches({ ...row, inviterId: "owner" })).toBe(false);
  });
});
