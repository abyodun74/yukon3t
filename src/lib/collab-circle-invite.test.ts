import { describe, it, expect } from "vitest";
import {
  COLLAB_CIRCLE_INVITE_MAX,
  selectCircleInvitees,
  splitVisibleInvites,
} from "@/lib/collab-circle-invite";

const active = (userId: string) => ({ userId, status: "ACTIVE" });

function select(overrides: Partial<Parameters<typeof selectCircleInvitees>[0]> = {}) {
  return selectCircleInvitees({
    inviterId: "me",
    members: [active("me"), active("a"), active("b")],
    participantIds: [],
    existingInviteeIds: [],
    blockedIds: [],
    hiddenPeerIds: [],
    ...overrides,
  });
}

describe("selectCircleInvitees", () => {
  it("invites every other active member", () => {
    expect(select()).toEqual({ ok: true, inviteeIds: ["a", "b"], skipped: 0 });
  });

  it("leaves out the inviter without counting them as skipped", () => {
    expect(select({ members: [active("me")] })).toEqual({ ok: true, inviteeIds: [], skipped: 0 });
  });

  it("skips existing participants", () => {
    expect(select({ participantIds: ["a"] })).toEqual({ ok: true, inviteeIds: ["b"], skipped: 1 });
  });

  it("skips anyone already invited, whether pending, accepted or declined", () => {
    expect(select({ existingInviteeIds: ["a", "b"] })).toEqual({ ok: true, inviteeIds: [], skipped: 2 });
  });

  it("skips people invited individually in the same request", () => {
    expect(select({ alsoInvitingIds: ["b"] })).toEqual({ ok: true, inviteeIds: ["a"], skipped: 1 });
  });

  it("skips people blocked either way", () => {
    expect(select({ blockedIds: ["a"] })).toEqual({ ok: true, inviteeIds: ["b"], skipped: 1 });
  });

  it("skips the inviter's hidden-chat peers", () => {
    expect(select({ hiddenPeerIds: ["b"] })).toEqual({ ok: true, inviteeIds: ["a"], skipped: 1 });
  });

  it("skips accounts that aren't active", () => {
    const members = ["DEACTIVATED", "SUSPENDED", "BANNED", "DELETED"].map((status, i) => ({ userId: `u${i}`, status }));
    expect(select({ members: [...members, active("a")] })).toEqual({ ok: true, inviteeIds: ["a"], skipped: 4 });
  });

  it("counts someone in two of the chosen Circles once", () => {
    const members = [active("me"), active("a"), active("b"), active("me"), active("a"), { userId: "b", status: "ACTIVE" }];
    expect(select({ members })).toEqual({ ok: true, inviteeIds: ["a", "b"], skipped: 0 });
    expect(select({ members, blockedIds: ["a"] })).toEqual({ ok: true, inviteeIds: ["b"], skipped: 1 });
  });

  it("allows exactly the cap", () => {
    const members = Array.from({ length: COLLAB_CIRCLE_INVITE_MAX }, (_, i) => active(`u${i}`));
    const result = select({ members });
    expect(result.ok && result.inviteeIds.length).toBe(COLLAB_CIRCLE_INVITE_MAX);
  });

  it("refuses the whole request past the cap instead of inviting a subset", () => {
    const members = Array.from({ length: COLLAB_CIRCLE_INVITE_MAX + 1 }, (_, i) => active(`u${i}`));
    expect(select({ members })).toEqual({ ok: false, error: "too_large", eligible: COLLAB_CIRCLE_INVITE_MAX + 1 });
  });

  it("applies the cap after the exclusions", () => {
    const members = Array.from({ length: COLLAB_CIRCLE_INVITE_MAX + 1 }, (_, i) => active(`u${i}`));
    const result = select({ members, existingInviteeIds: ["u0"] });
    expect(result).toEqual({
      ok: true,
      inviteeIds: members.slice(1).map((m) => m.userId),
      skipped: 1,
    });
  });

  it("takes a smaller cap", () => {
    expect(select({ max: 1 })).toEqual({ ok: false, error: "too_large", eligible: 2 });
  });
});

describe("splitVisibleInvites", () => {
  const invite = (inviteeId: string, inviterId: string, status = "PENDING") => ({ inviteeId, inviterId, status });

  it("shows the viewer's own invites, accepted ones, and people the viewer knows; counts the rest", () => {
    const invites = [
      invite("a", "me"),
      invite("b", "coadmin", "ACCEPTED"),
      invite("c", "coadmin"),
      invite("d", "coadmin", "DECLINED"),
      invite("e", "coadmin"),
    ];
    const { visible, hiddenCount } = splitVisibleInvites(invites, "me", new Set(["c"]));
    expect(visible.map((i) => i.inviteeId)).toEqual(["a", "b", "c"]);
    expect(hiddenCount).toBe(2);
  });

  it("hides nothing from the person who sent every invite", () => {
    const invites = [invite("a", "me"), invite("b", "me", "DECLINED")];
    expect(splitVisibleInvites(invites, "me", new Set())).toEqual({ visible: invites, hiddenCount: 0 });
  });
});
