import { describe, expect, it } from "vitest";
import {
  EVENT_BRING_ITEMS_MAX,
  EVENT_BRING_ITEM_MAX_LENGTH,
  EVENT_NUDGE_COOLDOWN_MS,
  EVENT_NUDGE_MAX_RECIPIENTS,
  appendCircleEventPage,
  canAddBringItem,
  canOrganizeCircleEvent,
  canUnclaimBringItem,
  eventTitle,
  nextNudgeAt,
  normalizeBringItemText,
  nudgeClaimCutoff,
  nudgeError,
  nudgeRecipients,
} from "@/lib/circle-events";

describe("canOrganizeCircleEvent", () => {
  const base = { viewerId: "v", authorId: "a", circleOwnerId: "o" };
  it("lets the author organize while a member, and the owner and co-admins always", () => {
    expect(canOrganizeCircleEvent({ ...base, viewerId: "a", role: "MEMBER" })).toBe(true);
    expect(canOrganizeCircleEvent({ ...base, viewerId: "a", role: null })).toBe(false);
    expect(canOrganizeCircleEvent({ ...base, viewerId: "o", role: null })).toBe(true);
    expect(canOrganizeCircleEvent({ ...base, role: "MODERATOR" })).toBe(true);
    expect(canOrganizeCircleEvent({ ...base, role: "MEMBER" })).toBe(false);
    expect(canOrganizeCircleEvent({ ...base, role: null })).toBe(false);
  });
});

describe("bring list rules", () => {
  it("normalizes item text and refuses empty or too long", () => {
    expect(normalizeBringItemText("  Paper   plates \n")).toBe("Paper plates");
    expect(normalizeBringItemText("   ")).toBeNull();
    expect(normalizeBringItemText("x".repeat(EVENT_BRING_ITEM_MAX_LENGTH))).toHaveLength(EVENT_BRING_ITEM_MAX_LENGTH);
    expect(normalizeBringItemText("x".repeat(EVENT_BRING_ITEM_MAX_LENGTH + 1))).toBeNull();
  });

  it("caps the list", () => {
    expect(canAddBringItem(EVENT_BRING_ITEMS_MAX - 1)).toBe(true);
    expect(canAddBringItem(EVENT_BRING_ITEMS_MAX)).toBe(false);
  });

  it("lets the claimer or an organizer clear a claim, nobody else", () => {
    expect(canUnclaimBringItem({ viewerId: "v", claimedById: "v", isOrganizer: false })).toBe(true);
    expect(canUnclaimBringItem({ viewerId: "v", claimedById: "x", isOrganizer: true })).toBe(true);
    expect(canUnclaimBringItem({ viewerId: "v", claimedById: "x", isOrganizer: false })).toBe(false);
    expect(canUnclaimBringItem({ viewerId: "v", claimedById: null, isOrganizer: true })).toBe(false);
  });
});

describe("nudges", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const future = new Date("2026-10-25T12:00:00Z");

  it("only for an event that hasn't started, once per cooldown", () => {
    expect(nudgeError({ eventAt: now, eventNudgedAt: null }, now)).toBe("past_event");
    expect(nudgeError({ eventAt: future, eventNudgedAt: null }, now)).toBeNull();
    const recent = new Date(now.getTime() - EVENT_NUDGE_COOLDOWN_MS + 1);
    expect(nudgeError({ eventAt: future, eventNudgedAt: recent }, now)).toBe("too_soon");
    const old = new Date(now.getTime() - EVENT_NUDGE_COOLDOWN_MS);
    expect(nudgeError({ eventAt: future, eventNudgedAt: old }, now)).toBeNull();
    expect(nudgeClaimCutoff(now).getTime()).toBe(old.getTime());
  });

  it("says when the next nudge is allowed", () => {
    expect(nextNudgeAt(null, now)).toBeNull();
    const at = new Date(now.getTime() - 60_000);
    expect(nextNudgeAt(at, now)?.getTime()).toBe(at.getTime() + EVENT_NUDGE_COOLDOWN_MS);
    expect(nextNudgeAt(new Date(now.getTime() - EVENT_NUDGE_COOLDOWN_MS), now)).toBeNull();
  });

  it("skips the sender, the author, anyone who RSVP'd or is blocked, and duplicates", () => {
    const recipients = nudgeRecipients(["s", "a", "r", "b", "m1", "m1", "m2"], {
      actorId: "s",
      authorId: "a",
      rsvpUserIds: new Set(["r"]),
      blockedIds: new Set(["b"]),
    });
    expect(recipients).toEqual(["m1", "m2"]);
  });

  it("caps the recipients", () => {
    const many = Array.from({ length: EVENT_NUDGE_MAX_RECIPIENTS + 10 }, (_, i) => `u${i}`);
    const recipients = nudgeRecipients(many, { actorId: "s", authorId: "a", rsvpUserIds: new Set(), blockedIds: new Set() });
    expect(recipients).toHaveLength(EVENT_NUDGE_MAX_RECIPIENTS);
    expect(recipients[0]).toBe("u0");
  });
});

describe("listing helpers", () => {
  it("titles an event by its first non-empty line, shortened", () => {
    expect(eventTitle("\n  Picnic in the park \nBring a blanket")).toBe("Picnic in the park");
    expect(eventTitle("")).toBe("");
    expect(eventTitle("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("appends a page without repeating events already shown", () => {
    expect(appendCircleEventPage([{ id: "1" }, { id: "2" }], [{ id: "2" }, { id: "3" }])).toEqual([
      { id: "1" },
      { id: "2" },
      { id: "3" },
    ]);
  });
});
