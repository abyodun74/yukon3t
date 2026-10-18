import { describe, it, expect } from "vitest";
import {
  CIRCLE_INVITE_MAX,
  canInviteToCircle,
  canInviterStillInvite,
  circleInviteAction,
  eligibleCircleInvitees,
  planCircleInvites,
  selectCircleInvitees,
  type CircleInviteExclusions,
} from "@/lib/circle-invite";

function exclusions(overrides: Partial<CircleInviteExclusions> = {}): CircleInviteExclusions {
  const ids = ["a", "b", "c", "d", "e", "me"];
  return {
    inviterId: "me",
    connectionIds: ["a", "b", "c", "d", "e"],
    memberIds: [],
    blockedIds: [],
    hiddenPeerIds: [],
    statusById: new Map(ids.map((id) => [id, "ACTIVE"])),
    ...overrides,
  };
}

describe("canInviteToCircle", () => {
  it("allows the owner and a co-admin only", () => {
    const circle = { createdById: "owner" };
    expect(canInviteToCircle(circle, null, "owner")).toBe(true);
    expect(canInviteToCircle(circle, { role: "MODERATOR" }, "mod")).toBe(true);
    expect(canInviteToCircle(circle, { role: "MEMBER" }, "member")).toBe(false);
    expect(canInviteToCircle(circle, null, "stranger")).toBe(false);
  });
});

describe("canInviterStillInvite", () => {
  const circle = { createdById: "owner" };

  it("keeps an invite from the active owner or an active co-admin", () => {
    expect(canInviterStillInvite(circle, { id: "owner", status: "ACTIVE" }, { role: "OWNER" })).toBe(true);
    expect(canInviterStillInvite(circle, { id: "owner", status: "ACTIVE" }, null)).toBe(true);
    expect(canInviterStillInvite(circle, { id: "mod", status: "ACTIVE" }, { role: "MODERATOR" })).toBe(true);
  });

  it("drops it once the co-admin is demoted or no longer a member", () => {
    expect(canInviterStillInvite(circle, { id: "mod", status: "ACTIVE" }, { role: "MEMBER" })).toBe(false);
    expect(canInviterStillInvite(circle, { id: "mod", status: "ACTIVE" }, null)).toBe(false);
    expect(canInviterStillInvite(circle, { id: "mod", status: "ACTIVE" }, undefined)).toBe(false);
  });

  it("drops it when the inviter's account isn't ACTIVE or is gone", () => {
    expect(canInviterStillInvite(circle, { id: "mod", status: "SUSPENDED" }, { role: "MODERATOR" })).toBe(false);
    expect(canInviterStillInvite(circle, { id: "owner", status: "BANNED" }, { role: "OWNER" })).toBe(false);
    expect(canInviterStillInvite(circle, null, { role: "MODERATOR" })).toBe(false);
  });
});

describe("eligibleCircleInvitees", () => {
  it("keeps eligible connections in order", () => {
    expect(eligibleCircleInvitees(["c", "a"], exclusions())).toEqual(["c", "a"]);
  });

  it("leaves out anyone who isn't an accepted connection", () => {
    expect(eligibleCircleInvitees(["a", "stranger"], exclusions())).toEqual(["a"]);
  });

  it("leaves out the inviter even if listed as a connection", () => {
    expect(eligibleCircleInvitees(["me", "a"], exclusions({ connectionIds: ["a", "me"] }))).toEqual(["a"]);
  });

  it("leaves out existing members", () => {
    expect(eligibleCircleInvitees(["a", "b"], exclusions({ memberIds: ["b"] }))).toEqual(["a"]);
  });

  it("leaves out anyone blocked either way (with the inviter or the owner)", () => {
    expect(eligibleCircleInvitees(["a", "b", "c"], exclusions({ blockedIds: ["a", "c"] }))).toEqual(["b"]);
  });

  it("leaves out the inviter's hidden-chat peers", () => {
    expect(eligibleCircleInvitees(["a", "b"], exclusions({ hiddenPeerIds: ["a"] }))).toEqual(["b"]);
  });

  it("leaves out non-ACTIVE and unknown accounts", () => {
    const statusById = new Map([
      ["a", "SUSPENDED"],
      ["b", "ACTIVE"],
      ["c", "BANNED"],
    ]);
    expect(eligibleCircleInvitees(["a", "b", "c", "d"], exclusions({ statusById }))).toEqual(["b"]);
  });

  it("returns each person once", () => {
    expect(eligibleCircleInvitees(["a", "a", "b", "a"], exclusions())).toEqual(["a", "b"]);
  });
});

describe("selectCircleInvitees", () => {
  it("dedupes and counts the people it skipped", () => {
    expect(selectCircleInvitees(["a", "a", "b", "stranger"], exclusions({ memberIds: ["b"] }))).toEqual({
      ok: true,
      inviteeIds: ["a"],
      skipped: 2,
    });
  });

  it("allows exactly the cap", () => {
    const ids = Array.from({ length: CIRCLE_INVITE_MAX }, (_, i) => `u${i}`);
    const result = selectCircleInvitees(ids, exclusions({ connectionIds: ids, statusById: new Map(ids.map((id) => [id, "ACTIVE"])) }));
    expect(result).toEqual({ ok: true, inviteeIds: ids, skipped: 0 });
  });

  it("refuses the whole request past the cap (50), counted after dedupe", () => {
    expect(CIRCLE_INVITE_MAX).toBe(50);
    const ids = Array.from({ length: CIRCLE_INVITE_MAX + 1 }, (_, i) => `u${i}`);
    expect(selectCircleInvitees(ids, exclusions())).toEqual({ ok: false, error: "too_many" });
    // 51 entries, but only 50 distinct people.
    const dupes = [...ids.slice(0, CIRCLE_INVITE_MAX), ids[0]];
    expect(selectCircleInvitees(dupes, exclusions()).ok).toBe(true);
  });
});

describe("circleInviteAction", () => {
  it("creates when there is no row", () => {
    expect(circleInviteAction(null, false)).toBe("create");
    expect(circleInviteAction(undefined, false)).toBe("create");
  });

  it("leaves a PENDING invite alone", () => {
    expect(circleInviteAction({ id: "i", status: "PENDING" }, false)).toBe("noop");
  });

  it("resets a DECLINED invite", () => {
    expect(circleInviteAction({ id: "i", status: "DECLINED" }, false)).toBe("reset");
  });

  it("resets an ACCEPTED invite once they're no longer a member", () => {
    expect(circleInviteAction({ id: "i", status: "ACCEPTED" }, false)).toBe("reset");
    expect(circleInviteAction({ id: "i", status: "ACCEPTED" }, true)).toBe("noop");
  });
});

describe("planCircleInvites", () => {
  it("splits invitees by what happens to each", () => {
    const plan = planCircleInvites({
      inviteeIds: ["new", "pending", "declined", "left", "requester"],
      existingInvites: new Map([
        ["pending", { id: "i1", status: "PENDING" }],
        ["declined", { id: "i2", status: "DECLINED" }],
        ["left", { id: "i3", status: "ACCEPTED" }],
        ["requester", { id: "i4", status: "DECLINED" }],
      ]),
      memberIds: [],
      pendingRequestUserIds: ["requester"],
    });
    expect(plan).toEqual({
      approveRequests: ["requester"],
      create: ["new"],
      reset: [
        { inviteId: "i2", inviteeId: "declined" },
        { inviteId: "i3", inviteeId: "left" },
      ],
      unchanged: ["pending"],
    });
  });
});
