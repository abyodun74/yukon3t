import { describe, expect, it } from "vitest";
import { canOrganizeCircleEvent } from "@/lib/circle-events";
import {
  EVENT_ANNOUNCEMENTS_PER_DAY,
  EVENT_ANNOUNCEMENT_MAX_LENGTH,
  EVENT_ANNOUNCEMENT_MAX_RECIPIENTS,
  EVENT_ANNOUNCEMENT_WINDOW_MS,
  EVENT_CHECK_IN_CLOSES_AFTER_MS,
  EVENT_CHECK_IN_OPENS_BEFORE_MS,
  announcementError,
  announcementRecipients,
  announcementWindowStart,
  announcementsLeft,
  attendanceSummary,
  canDeleteEventUpdate,
  canEditEventUpdate,
  canMarkAttended,
  checkInError,
  checkInWindow,
  normalizeAnnouncementText,
  normalizeWalkInQuery,
  organizerToolAccess,
} from "@/lib/circle-event-organizer";

const start = new Date("2026-10-25T18:00:00Z");
const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(start.getTime() + offsetMs);

describe("who gets the organizer tools", () => {
  const owner = "owner";
  const author = "author";
  const organizer = (viewerId: string, role: string | null) =>
    canOrganizeCircleEvent({ viewerId, authorId: author, circleOwnerId: owner, role });

  it("the Circle's owner, its co-admins, and the author while still a member", () => {
    expect(organizer(owner, null)).toBe(true);
    expect(organizer(owner, "OWNER")).toBe(true);
    expect(organizer("coadmin", "MODERATOR")).toBe(true);
    expect(organizer(author, "MEMBER")).toBe(true);
  });
  it("not a plain member, not an author who left, not a site admin who isn't in the Circle", () => {
    expect(organizer("member", "MEMBER")).toBe(false);
    expect(organizer(author, null)).toBe(false);
    expect(organizer("site-admin", null)).toBe(false);
  });
  it("offers nothing at all to someone who isn't an organizer", () => {
    for (const now of [at(-48 * HOUR), at(0), at(48 * HOUR)]) {
      expect(organizerToolAccess({ isOrganizer: false, eventAt: start, eventCancelledAt: null, now })).toEqual({
        announce: false,
        viewAttendance: false,
        editAttendance: false,
        exportCsv: false,
      });
    }
  });
  it("lets an organizer announce and export before the event, but not see attendance yet", () => {
    expect(organizerToolAccess({ isOrganizer: true, eventAt: start, eventCancelledAt: null, now: at(-2 * HOUR) })).toEqual({
      announce: true,
      viewAttendance: false,
      editAttendance: false,
      exportCsv: true,
    });
  });
  it("opens attendance (view and edit) from an hour before the start", () => {
    expect(organizerToolAccess({ isOrganizer: true, eventAt: start, eventCancelledAt: null, now: at(-HOUR) })).toMatchObject({
      viewAttendance: true,
      editAttendance: true,
    });
  });
  it("keeps attendance readable but frozen once the window closed, and stops updates", () => {
    expect(
      organizerToolAccess({ isOrganizer: true, eventAt: start, eventCancelledAt: null, now: at(25 * HOUR) }),
    ).toEqual({ announce: false, viewAttendance: true, editAttendance: false, exportCsv: true });
  });
  it("a cancelled event takes no updates and no check-in, but can still be exported", () => {
    expect(organizerToolAccess({ isOrganizer: true, eventAt: start, eventCancelledAt: at(-HOUR * 5), now: at(0) })).toEqual(
      { announce: false, viewAttendance: false, editAttendance: false, exportCsv: true },
    );
  });
});

describe("normalizeAnnouncementText", () => {
  it("trims, keeps single line breaks and collapses runs", () => {
    expect(normalizeAnnouncementText("  Back   room\r\n\r\n\r\n\r\nGreen door  ")).toBe("Back room\n\nGreen door");
    expect(normalizeAnnouncementText("a \n b")).toBe("a\nb");
  });
  it("treats blank as nothing and refuses anything too long", () => {
    expect(normalizeAnnouncementText(" \n\t ")).toBeNull();
    expect(normalizeAnnouncementText(undefined)).toBeNull();
    expect(normalizeAnnouncementText("x".repeat(EVENT_ANNOUNCEMENT_MAX_LENGTH))).toHaveLength(EVENT_ANNOUNCEMENT_MAX_LENGTH);
    expect(normalizeAnnouncementText("x".repeat(EVENT_ANNOUNCEMENT_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("announcementError and the per-event daily cap", () => {
  it("allows updates before and up to a day after the start", () => {
    expect(announcementError({ eventAt: start, eventCancelledAt: null }, at(-72 * HOUR))).toBeNull();
    expect(announcementError({ eventAt: start, eventCancelledAt: null }, at(24 * HOUR))).toBeNull();
  });
  it("refuses a cancelled event, and more than a day after the start", () => {
    expect(announcementError({ eventAt: start, eventCancelledAt: at(-HOUR) }, at(-2 * HOUR))).toBe("cancelled");
    expect(announcementError({ eventAt: start, eventCancelledAt: null }, at(24 * HOUR + 1))).toBe("too_late");
  });
  it("counts in a rolling 24-hour window, at most EVENT_ANNOUNCEMENTS_PER_DAY", () => {
    expect(EVENT_ANNOUNCEMENTS_PER_DAY).toBe(5);
    expect(announcementsLeft(0)).toBe(5);
    expect(announcementsLeft(4)).toBe(1);
    expect(announcementsLeft(5)).toBe(0);
    expect(announcementsLeft(9)).toBe(0);
    expect(announcementWindowStart(start).getTime()).toBe(start.getTime() - EVENT_ANNOUNCEMENT_WINDOW_MS);
  });
});

describe("announcementRecipients", () => {
  const base = {
    actorId: "org",
    authorId: "author",
    rsvpUserIds: ["a", "b", "c"],
    audience: new Set(["author", "org", "a", "b", "c"]),
    blockedIds: new Set<string>(),
  };

  it("goes to the author first, then everyone going, never the sender", () => {
    expect(announcementRecipients(base)).toEqual(["author", "a", "b", "c"]);
    expect(announcementRecipients({ ...base, actorId: "author" })).toEqual(["a", "b", "c"]);
    expect(announcementRecipients({ ...base, rsvpUserIds: ["org", "a"] })).toEqual(["author", "a"]);
  });
  it("skips anyone blocked either way with the sender or the author", () => {
    expect(announcementRecipients({ ...base, blockedIds: new Set(["b", "author"]) })).toEqual(["a", "c"]);
  });
  it("skips people outside the audience: who left the Circle, a private Circle's ex-members, inactive accounts", () => {
    expect(announcementRecipients({ ...base, audience: new Set(["a"]) })).toEqual(["a"]);
    expect(announcementRecipients({ ...base, audience: new Set() })).toEqual([]);
  });
  it("names each person once and stops at EVENT_ANNOUNCEMENT_MAX_RECIPIENTS", () => {
    expect(announcementRecipients({ ...base, rsvpUserIds: ["a", "a", "author", "b"] })).toEqual(["author", "a", "b"]);
    const many = Array.from({ length: EVENT_ANNOUNCEMENT_MAX_RECIPIENTS + 50 }, (_, i) => `u${i}`);
    const out = announcementRecipients({ ...base, rsvpUserIds: many, audience: new Set(["author", ...many]) });
    expect(out).toHaveLength(EVENT_ANNOUNCEMENT_MAX_RECIPIENTS);
    expect(out[0]).toBe("author");
  });
});

describe("the check-in window", () => {
  it("opens an hour before the start and closes a day after it", () => {
    expect(EVENT_CHECK_IN_OPENS_BEFORE_MS).toBe(HOUR);
    expect(EVENT_CHECK_IN_CLOSES_AFTER_MS).toBe(24 * HOUR);
    const w = checkInWindow(start, at(0));
    expect(w.opensAt.toISOString()).toBe("2026-10-25T17:00:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-10-26T18:00:00.000Z");
  });
  it("is before, open (edges included) or closed", () => {
    expect(checkInWindow(start, at(-HOUR - 1)).state).toBe("before");
    expect(checkInWindow(start, at(-HOUR)).state).toBe("open");
    expect(checkInWindow(start, at(3 * HOUR)).state).toBe("open");
    expect(checkInWindow(start, at(24 * HOUR)).state).toBe("open");
    expect(checkInWindow(start, at(24 * HOUR + 1)).state).toBe("closed");
  });
  it("refuses changes outside it, and on a cancelled event", () => {
    const event = { eventAt: start, eventCancelledAt: null };
    expect(checkInError(event, at(-2 * HOUR))).toBe("too_early");
    expect(checkInError(event, at(0))).toBeNull();
    expect(checkInError(event, at(30 * HOUR))).toBe("too_late");
    expect(checkInError({ eventAt: start, eventCancelledAt: at(-5 * HOUR) }, at(0))).toBe("cancelled");
  });
});

describe("canMarkAttended", () => {
  const audience = new Set(["member"]);
  it("allows someone going, or a walk-in who is a current member able to see the event", () => {
    expect(canMarkAttended({ userId: "guest", hasReplied: true, audience, blockedIds: new Set() })).toBe(true);
    expect(canMarkAttended({ userId: "member", hasReplied: false, audience, blockedIds: new Set() })).toBe(true);
  });
  it("refuses a stranger and anyone blocked either way with the organizer", () => {
    expect(canMarkAttended({ userId: "stranger", hasReplied: false, audience, blockedIds: new Set() })).toBe(false);
    expect(canMarkAttended({ userId: "member", hasReplied: true, audience, blockedIds: new Set(["member"]) })).toBe(false);
  });
});

describe("attendanceSummary", () => {
  it("counts going, attended and walk-ins", () => {
    expect(
      attendanceSummary({
        going: 12,
        maybe: 4,
        attendance: [
          { userId: "a", walkIn: false },
          { userId: "b", walkIn: true },
          { userId: "c", walkIn: false },
        ],
      }),
    ).toEqual({ going: 12, maybe: 4, attended: 3, walkIns: 1 });
  });
});

describe("normalizeWalkInQuery", () => {
  it("drops a leading @ and needs two characters", () => {
    expect(normalizeWalkInQuery("  @ada ")).toBe("ada");
    expect(normalizeWalkInQuery("@a")).toBeNull();
    expect(normalizeWalkInQuery("   ")).toBeNull();
    expect(normalizeWalkInQuery("x".repeat(200))).toHaveLength(60);
  });
});

describe("editing and deleting organizer updates", () => {
  const base = { viewerId: "org", authorId: "org", isOrganizer: true, deleted: false };
  it("lets only the author edit, while still an organizer", () => {
    expect(canEditEventUpdate(base)).toBe(true);
    expect(canEditEventUpdate({ ...base, authorId: "other" })).toBe(false);
    expect(canEditEventUpdate({ ...base, isOrganizer: false })).toBe(false);
    expect(canEditEventUpdate({ ...base, deleted: true })).toBe(false);
  });
  it("lets any organizer delete any update, and the author delete their own", () => {
    expect(canDeleteEventUpdate({ ...base, authorId: "other" })).toBe(true);
    expect(canDeleteEventUpdate({ ...base, isOrganizer: false })).toBe(true);
    expect(canDeleteEventUpdate({ ...base, authorId: "other", isOrganizer: false })).toBe(false);
    expect(canDeleteEventUpdate({ ...base, deleted: true })).toBe(false);
  });
});
