import { describe, it, expect } from "vitest";
import {
  canCollabInviterStillInvite,
  canInviteToCollab,
  collabInviteAction,
  collabInviteExcludesInvitee,
  collabInviteStillStands,
  isStaleCollabInvite,
  planCollabInvites,
  type CollabInviterStanding,
  type ExistingCollabInvite,
} from "@/lib/collab-invite";
import { selectCircleInvitees } from "@/lib/collab-circle-invite";

const collab = { id: "c1", authorId: "author" };

function inviter(
  id: string,
  status: string,
  collabParticipations: CollabInviterStanding["collabParticipations"],
): CollabInviterStanding {
  return { id, status, collabParticipations };
}

describe("canInviteToCollab", () => {
  it("allows the author and OWNER/MODERATOR participants only, with no site-admin shortcut", () => {
    expect(canInviteToCollab(collab, null, "author")).toBe(true);
    expect(canInviteToCollab(collab, { role: "OWNER" }, "author")).toBe(true);
    expect(canInviteToCollab(collab, { role: "OWNER" }, "other-owner")).toBe(true);
    expect(canInviteToCollab(collab, { role: "MODERATOR" }, "mod")).toBe(true);
    expect(canInviteToCollab(collab, { role: "PARTICIPANT" }, "p")).toBe(false);
    expect(canInviteToCollab(collab, null, "site-admin")).toBe(false);
  });
});

describe("canCollabInviterStillInvite", () => {
  it("holds for the author and a current co-admin with an ACTIVE account", () => {
    expect(canCollabInviterStillInvite(collab, { id: "author", status: "ACTIVE" }, { role: "OWNER" })).toBe(true);
    expect(canCollabInviterStillInvite(collab, { id: "author", status: "ACTIVE" }, null)).toBe(true);
    expect(canCollabInviterStillInvite(collab, { id: "mod", status: "ACTIVE" }, { role: "MODERATOR" })).toBe(true);
  });

  it("fails once the inviter was demoted, left or removed", () => {
    expect(canCollabInviterStillInvite(collab, { id: "mod", status: "ACTIVE" }, { role: "PARTICIPANT" })).toBe(false);
    expect(canCollabInviterStillInvite(collab, { id: "mod", status: "ACTIVE" }, null)).toBe(false);
    expect(canCollabInviterStillInvite(collab, { id: "mod", status: "ACTIVE" }, undefined)).toBe(false);
  });

  it("fails for an inactive or missing inviter account, the author included", () => {
    expect(canCollabInviterStillInvite(collab, { id: "mod", status: "SUSPENDED" }, { role: "MODERATOR" })).toBe(false);
    expect(canCollabInviterStillInvite(collab, { id: "author", status: "BANNED" }, { role: "OWNER" })).toBe(false);
    expect(canCollabInviterStillInvite(collab, null, { role: "MODERATOR" })).toBe(false);
  });
});

describe("collabInviteStillStands / isStaleCollabInvite", () => {
  const coAdmin = inviter("mod", "ACTIVE", [{ collabId: "c1", role: "MODERATOR" }]);
  const demoted = inviter("mod", "ACTIVE", [{ collabId: "c1", role: "PARTICIPANT" }]);
  const left = inviter("mod", "ACTIVE", []);
  const suspended = inviter("mod", "SUSPENDED", [{ collabId: "c1", role: "MODERATOR" }]);

  it("only counts the inviter's role in this collab", () => {
    expect(collabInviteStillStands(collab, coAdmin)).toBe(true);
    expect(collabInviteStillStands(collab, inviter("mod", "ACTIVE", [{ collabId: "c2", role: "MODERATOR" }]))).toBe(
      false,
    );
    expect(collabInviteStillStands(collab, inviter("author", "ACTIVE", []))).toBe(true);
    expect(collabInviteStillStands(collab, null)).toBe(false);
  });

  it("marks a PENDING invite stale once its inviter no longer qualifies", () => {
    expect(isStaleCollabInvite(collab, { status: "PENDING", inviter: demoted })).toBe(true);
    expect(isStaleCollabInvite(collab, { status: "PENDING", inviter: left })).toBe(true);
    expect(isStaleCollabInvite(collab, { status: "PENDING", inviter: suspended })).toBe(true);
    expect(isStaleCollabInvite(collab, { status: "PENDING", inviter: null })).toBe(true);
    expect(isStaleCollabInvite(collab, { status: "PENDING", inviter: coAdmin })).toBe(false);
  });

  it("never marks an answered invite stale", () => {
    expect(isStaleCollabInvite(collab, { status: "DECLINED", inviter: left })).toBe(false);
    expect(isStaleCollabInvite(collab, { status: "ACCEPTED", inviter: left })).toBe(false);
  });
});

describe("collabInviteAction", () => {
  it("creates, resets or leaves alone", () => {
    expect(collabInviteAction(null)).toBe("create");
    expect(collabInviteAction(undefined)).toBe("create");
    expect(collabInviteAction({ status: "PENDING", stale: false })).toBe("noop");
    expect(collabInviteAction({ status: "PENDING", stale: true })).toBe("reset");
    expect(collabInviteAction({ status: "DECLINED", stale: false })).toBe("reset");
    expect(collabInviteAction({ status: "ACCEPTED", stale: false })).toBe("noop");
  });
});

describe("collabInviteExcludesInvitee", () => {
  it("lets only a stale PENDING invite through", () => {
    expect(collabInviteExcludesInvitee({ status: "PENDING", stale: true })).toBe(false);
    expect(collabInviteExcludesInvitee({ status: "PENDING", stale: false })).toBe(true);
    expect(collabInviteExcludesInvitee({ status: "DECLINED", stale: false })).toBe(true);
    expect(collabInviteExcludesInvitee({ status: "ACCEPTED", stale: false })).toBe(true);
  });
});

describe("planCollabInvites", () => {
  const row = (inviteeId: string, status: string, stale = false, inviterId = "old"): ExistingCollabInvite => ({
    id: `inv-${inviteeId}`,
    inviteeId,
    status,
    inviterId,
    stale,
  });
  const existing = new Map(
    [row("pending", "PENDING"), row("stale", "PENDING", true), row("declined", "DECLINED"), row("accepted", "ACCEPTED")].map(
      (r) => [r.inviteeId, r],
    ),
  );

  it("splits individual invitees", () => {
    const plan = planCollabInvites({
      individualIds: ["new", "pending", "stale", "declined", "accepted"],
      circleIds: [],
      existing,
    });
    expect(plan.create).toEqual(["new"]);
    expect(plan.circleCreate).toEqual([]);
    expect(plan.reset).toEqual([
      { inviteId: "inv-stale", inviteeId: "stale", status: "PENDING", inviterId: "old", fromCircle: false },
      { inviteId: "inv-declined", inviteeId: "declined", status: "DECLINED", inviterId: "old", fromCircle: false },
    ]);
  });

  it("re-sends a stale invite through a Circle invite, which selectCircleInvitees lets through", () => {
    const rows = [...existing.values()];
    const selection = selectCircleInvitees({
      inviterId: "me",
      members: ["me", "new2", "pending", "stale", "declined", "accepted"].map((userId) => ({ userId, status: "ACTIVE" })),
      participantIds: [],
      existingInviteeIds: rows.filter(collabInviteExcludesInvitee).map((r) => r.inviteeId),
      blockedIds: [],
      hiddenPeerIds: [],
    });
    expect(selection).toEqual({ ok: true, inviteeIds: ["new2", "stale"], skipped: 3 });
    if (!selection.ok) return;
    const plan = planCollabInvites({ individualIds: [], circleIds: selection.inviteeIds, existing });
    expect(plan.create).toEqual([]);
    expect(plan.circleCreate).toEqual(["new2"]);
    expect(plan.reset).toEqual([
      { inviteId: "inv-stale", inviteeId: "stale", status: "PENDING", inviterId: "old", fromCircle: true },
    ]);
  });

  it("counts a stale invite a Circle invite re-sends against the new-invite cap", () => {
    const members = ["a", "stale"].map((userId) => ({ userId, status: "ACTIVE" }));
    const base = { inviterId: "me", members, participantIds: [], blockedIds: [], hiddenPeerIds: [], max: 1 };
    expect(selectCircleInvitees({ ...base, existingInviteeIds: [] })).toEqual({
      ok: false,
      error: "too_large",
      eligible: 2,
    });
    // A standing invite still excludes them, so only "a" is new.
    expect(selectCircleInvitees({ ...base, existingInviteeIds: ["stale"] })).toEqual({
      ok: true,
      inviteeIds: ["a"],
      skipped: 1,
    });
  });
});
