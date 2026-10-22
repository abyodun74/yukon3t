import { describe, expect, it } from "vitest";
import {
  NEW_MEMBER_MAX_AGE_MS,
  NEW_MEMBER_MIN_AGE_MS,
  NEW_MEMBER_PUSH_COOLDOWN_MS,
  NEW_MEMBER_RECIPIENT_ACTIVE_MS,
  blockPairKey,
  groupByActorAndCount,
  newMemberCandidateWhere,
  newMemberHref,
  newMemberMessageData,
  newMemberOthersIn,
  newMemberRecipientWhere,
  planNewMemberAlerts,
} from "@/lib/new-member-alerts";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

const now = new Date("2026-10-22T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("who is announced", () => {
  it("only verified, ACTIVE, Discover-visible, public accounts that onboarded 10 minutes to 3 days ago, once", () => {
    const where = newMemberCandidateWhere(now);
    expect(where.newMemberAnnouncedAt).toBeNull();
    expect(where.onboardedAt).toEqual({ gte: ago(NEW_MEMBER_MAX_AGE_MS), lte: ago(NEW_MEMBER_MIN_AGE_MS) });
    expect(where).toMatchObject({
      status: "ACTIVE",
      discoverable: true,
      postsVisibility: "PUBLIC",
      name: { not: null },
      isAdmin: false,
      isAppReviewDemo: false,
    });
    expect(where.OR).toEqual([{ emailVerified: { not: null } }, { phoneVerifiedAt: { not: null } }]);
  });
});

describe("who hears about it", () => {
  it("opted-in, ACTIVE, onboarded, recently seen accounts, never the App Review demo", () => {
    const where = newMemberRecipientWhere(now);
    expect(where).toMatchObject({
      newMemberAlerts: true,
      status: "ACTIVE",
      isAppReviewDemo: false,
      name: { not: null },
      country: { not: null },
      interests: { isEmpty: false },
    });
    expect(where.lastSeenAt).toEqual({ gte: ago(NEW_MEMBER_RECIPIENT_ACTIVE_MS) });
  });
});

describe("digest data and links", () => {
  it("stores nothing for one person and a count for a digest", () => {
    expect(newMemberMessageData(0)).toBeNull();
    expect(newMemberMessageData(3)).toBe("new_members:3");
    expect(newMemberOthersIn(null)).toBe(0);
    expect(newMemberOthersIn("new_members:3")).toBe(3);
    expect(newMemberOthersIn("video_flagged:sexual")).toBe(0);
  });

  it("links the push to exactly where the bell row leads", () => {
    for (const others of [0, 1, 5]) {
      const row: NotificationData = {
        id: "n1",
        type: "NEW_MEMBER_JOINED",
        recipientId: "me",
        readAt: null,
        createdAt: now,
        actor: { id: "new1", name: "Ada" },
        message: null,
        messageData: newMemberMessageData(others),
        postId: null,
        circle: null,
        conversationId: null,
        collab: null,
        liveStreamId: null,
        channel: null,
        museId: null,
        storyId: null,
      };
      expect(newMemberHref("new1", others)).toBe(notificationHref(row));
    }
    expect(newMemberHref("new1", 0)).toBe("/u/new1");
    expect(newMemberHref("new1", 2)).toBe("/discover?sort=recent");
  });

  it("keys a block the same whichever side made it", () => {
    expect(blockPairKey("a", "b")).toBe(blockPairKey("b", "a"));
  });
});

describe("planNewMemberAlerts", () => {
  const members = [{ id: "m3" }, { id: "m2" }, { id: "m1" }]; // newest first
  const fresh = { newMemberPushAt: null };

  it("one row per recipient naming the newest member, the rest as a count, and a push", () => {
    const plan = planNewMemberAlerts({
      members,
      recipients: [{ id: "r1", ...fresh }],
      blockedPairs: new Set(),
      openRows: new Map(),
      now,
    });
    expect(plan.creates).toEqual([{ recipientId: "r1", actorId: "m3", others: 2 }]);
    expect(plan.updates).toEqual([]);
    expect(plan.pushes).toEqual([{ recipientId: "r1", actorId: "m3", others: 2 }]);
  });

  it("a single new member is a plain row, not a digest", () => {
    const plan = planNewMemberAlerts({
      members: [{ id: "m1" }],
      recipients: [{ id: "r1", ...fresh }],
      blockedPairs: new Set(),
      openRows: new Map(),
      now,
    });
    expect(plan.creates).toEqual([{ recipientId: "r1", actorId: "m1", others: 0 }]);
  });

  it("leaves out blocked members either way, without counting them, and says nothing when none are left", () => {
    const plan = planNewMemberAlerts({
      members,
      recipients: [
        { id: "r1", ...fresh },
        { id: "r2", ...fresh },
      ],
      blockedPairs: new Set([blockPairKey("m3", "r1"), blockPairKey("r2", "m1")]),
      openRows: new Map(),
      now,
    });
    expect(plan.creates).toEqual([
      { recipientId: "r1", actorId: "m2", others: 1 },
      { recipientId: "r2", actorId: "m3", others: 1 },
    ]);

    const none = planNewMemberAlerts({
      members: [{ id: "m1" }],
      recipients: [{ id: "r1", ...fresh }],
      blockedPairs: new Set([blockPairKey("m1", "r1")]),
      openRows: new Map(),
      now,
    });
    expect(none).toEqual({ creates: [], updates: [], pushes: [] });
  });

  it("never tells new members about themselves", () => {
    const plan = planNewMemberAlerts({
      members: [{ id: "m1" }],
      recipients: [{ id: "m1", ...fresh }],
      blockedPairs: new Set(),
      openRows: new Map(),
      now,
    });
    expect(plan.creates).toEqual([]);
    expect(plan.pushes).toEqual([]);
  });

  it("grows an open unread row into a digest instead of adding another", () => {
    const single = planNewMemberAlerts({
      members: [{ id: "m2" }],
      recipients: [{ id: "r1", ...fresh }],
      blockedPairs: new Set(),
      openRows: new Map([["r1", { id: "row1", messageData: null }]]),
      now,
    });
    // The old actor becomes one of the "others".
    expect(single.updates).toEqual([{ rowId: "row1", recipientId: "r1", actorId: "m2", others: 1 }]);
    expect(single.creates).toEqual([]);

    const digest = planNewMemberAlerts({
      members,
      recipients: [{ id: "r1", ...fresh }],
      blockedPairs: new Set(),
      openRows: new Map([["r1", { id: "row1", messageData: "new_members:4" }]]),
      now,
    });
    // 1 previous actor + 4 previous others + 2 of the 3 new members; the newest is the actor.
    expect(digest.updates).toEqual([{ rowId: "row1", recipientId: "r1", actorId: "m3", others: 7 }]);
  });

  it("pushes a recipient at most once per cooldown, while the bell row still updates", () => {
    const plan = planNewMemberAlerts({
      members: [{ id: "m1" }],
      recipients: [
        { id: "recent", newMemberPushAt: ago(NEW_MEMBER_PUSH_COOLDOWN_MS - 1) },
        { id: "due", newMemberPushAt: ago(NEW_MEMBER_PUSH_COOLDOWN_MS) },
        { id: "never", newMemberPushAt: null },
      ],
      blockedPairs: new Set(),
      openRows: new Map(),
      now,
    });
    expect(plan.creates.map((c) => c.recipientId)).toEqual(["recent", "due", "never"]);
    expect(plan.pushes.map((p) => p.recipientId)).toEqual(["due", "never"]);
  });
});

describe("groupByActorAndCount", () => {
  it("groups identical rows/pushes so each is written or sent once", () => {
    const groups = groupByActorAndCount([
      { recipientId: "a", actorId: "m1", others: 0 },
      { recipientId: "b", actorId: "m1", others: 0 },
      { recipientId: "c", actorId: "m1", others: 2 },
      { recipientId: "d", actorId: "m2", others: 0 },
    ]);
    expect(groups.map((g) => g.map((x) => x.recipientId))).toEqual([["a", "b"], ["c"], ["d"]]);
  });
});
