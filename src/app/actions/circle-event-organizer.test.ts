import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/en";
import { notificationHref } from "@/lib/notification-href";

// The organizer-tool actions against a mocked database, session, limiter and fan-out: who may use them, the limits,
// who an update reaches, the check-in window and who can be checked in, and what the export returns.

const user = { id: "org", name: "Olu", isAdmin: false };
const checkRateLimit = vi.fn();
const moderateText = vi.fn();
const loadCircleEventAccess = vi.fn();
const blocked = new Map<string, Set<string>>();
const sendFcm = vi.fn();
const publishEvents = vi.fn();
const eventAudience = vi.fn();
const filterCircleContentViewers = vi.fn();

const db = {
  announcementCount: vi.fn(),
  announcementCreate: vi.fn(),
  announcementUpdate: vi.fn(),
  rsvpFindMany: vi.fn(),
  rsvpFindUnique: vi.fn(),
  notificationCreateMany: vi.fn(),
  userFindUnique: vi.fn(),
  attendanceUpsert: vi.fn(),
  attendanceDeleteMany: vi.fn(),
  announcementFindUnique: vi.fn(),
  announcementUpdateMany: vi.fn(),
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/moderation", () => ({ moderateText: (...a: unknown[]) => moderateText(...a) }));
vi.mock("@/lib/blocks", () => ({ getBlockedEitherWayIds: async (id: string) => blocked.get(id) ?? new Set() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUsers: (...a: unknown[]) => sendFcm(...a) }));
vi.mock("@/lib/realtime-server", () => ({ publishEvents: (...a: unknown[]) => publishEvents(...a) }));
vi.mock("@/lib/i18n/server", () => ({ getDictionary: async () => en }));
const deleteTranslationsOf = vi.fn();
vi.mock("@/lib/translation-server", () => ({
  deleteTranslationsOf: (...a: unknown[]) => deleteTranslationsOf(...a),
}));
vi.mock("@/lib/circle-permissions", () => ({
  filterCircleContentViewers: (...a: unknown[]) => filterCircleContentViewers(...a),
}));
vi.mock("@/lib/circle-events-data", () => ({
  loadCircleEventAccess: (...a: unknown[]) => loadCircleEventAccess(...a),
}));
vi.mock("@/lib/circle-event-organizer-data", () => ({
  eventAudience: (...a: unknown[]) => eventAudience(...a),
  announcementQuota: async () => ({ sent: 1, left: 4, nextAt: null }),
  loadEventUpdates: async () => [],
  loadAttendanceSummary: async () => ({ going: 3, maybe: 1, attended: 1, walkIns: 0 }),
  loadCheckInList: async () => ({
    people: [],
    summary: { going: 3, maybe: 1, attended: 1, walkIns: 0 },
    truncated: false,
  }),
  searchWalkInCandidates: async () => [],
  exportOccurrencePosts: async (post: { id: string; content: string; eventAt: Date }) => [
    { id: post.id, content: post.content, eventAt: post.eventAt, eventCancelledAt: null },
  ],
  loadEventExport: async () => [
    {
      title: "Picnic",
      startAt: new Date("2026-10-25T18:00:00Z"),
      cancelled: false,
      people: [
        { name: "=Ada", username: "ada", rsvp: "MAYBE", rsvpAt: new Date("2026-10-20T08:00:00Z"), attended: true, items: [] },
      ],
    },
  ],
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    eventAnnouncement: {
      count: (...a: unknown[]) => db.announcementCount(...a),
      create: (...a: unknown[]) => db.announcementCreate(...a),
    },
  };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      eventAnnouncement: {
        update: (...a: unknown[]) => db.announcementUpdate(...a),
        findUnique: (...a: unknown[]) => db.announcementFindUnique(...a),
        updateMany: (...a: unknown[]) => db.announcementUpdateMany(...a),
      },
      postRsvp: {
        findMany: (...a: unknown[]) => db.rsvpFindMany(...a),
        findUnique: (...a: unknown[]) => db.rsvpFindUnique(...a),
      },
      notification: { createMany: (...a: unknown[]) => db.notificationCreateMany(...a) },
      user: { findUnique: (...a: unknown[]) => db.userFindUnique(...a) },
      eventAttendance: {
        upsert: (...a: unknown[]) => db.attendanceUpsert(...a),
        deleteMany: (...a: unknown[]) => db.attendanceDeleteMany(...a),
      },
    },
  };
});

import {
  deleteEventAnnouncement,
  editEventAnnouncement,
  exportCircleEventCsv,
  loadEventCheckIn,
  postEventAnnouncement,
  setEventAttendance,
} from "@/app/actions/circle-event-organizer";

const POST_ID = "ckpost000000000000000000a";
const PERSON = "ckuser000000000000000000a";
const HOUR = 60 * 60 * 1000;

function access(overrides: { isOrganizer?: boolean; eventAt?: Date; eventCancelledAt?: Date | null } = {}) {
  return {
    isMember: true,
    isOrganizer: overrides.isOrganizer ?? true,
    post: {
      id: POST_ID,
      authorId: "author",
      content: "Picnic\nBring a blanket",
      eventAt: overrides.eventAt ?? new Date(Date.now() + 48 * HOUR),
      eventCancelledAt: overrides.eventCancelledAt ?? null,
      eventSeriesId: null,
      circle: { id: "circle1", slug: "picnics", createdById: "owner", visibility: "PUBLIC" },
      channel: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  blocked.clear();
  checkRateLimit.mockResolvedValue(true);
  moderateText.mockResolvedValue({ allowed: true });
  loadCircleEventAccess.mockResolvedValue(access());
  db.announcementCount.mockResolvedValue(0);
  db.announcementCreate.mockResolvedValue({ id: "ann1" });
  db.rsvpFindMany.mockResolvedValue([]);
  db.rsvpFindUnique.mockResolvedValue(null);
  db.userFindUnique.mockResolvedValue({ status: "ACTIVE" });
  eventAudience.mockResolvedValue(new Set());
  filterCircleContentViewers.mockImplementation(async (_c: string, ids: string[]) => ids);
});

describe("postEventAnnouncement", () => {
  it("is for organizers only", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ isOrganizer: false }));
    expect(await postEventAnnouncement(POST_ID, { text: "Hi" })).toEqual({ error: "forbidden" });
    loadCircleEventAccess.mockResolvedValue(null);
    expect(await postEventAnnouncement(POST_ID, { text: "Hi" })).toEqual({ error: "not_found" });
    expect(db.announcementCreate).not.toHaveBeenCalled();
  });
  it("checks its own limiter first", async () => {
    checkRateLimit.mockResolvedValue(false);
    expect(await postEventAnnouncement(POST_ID, { text: "Hi" })).toEqual({ error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith("eventAnnounce", "org");
    expect(loadCircleEventAccess).not.toHaveBeenCalled();
  });
  it("refuses empty, over-long and flagged text", async () => {
    expect(await postEventAnnouncement(POST_ID, { text: "   " })).toEqual({ error: "invalid" });
    expect(await postEventAnnouncement(POST_ID, { text: "x".repeat(501) })).toEqual({ error: "invalid" });
    moderateText.mockResolvedValue({ allowed: false });
    expect(await postEventAnnouncement(POST_ID, { text: "bad" })).toEqual({ error: "moderation" });
    expect(db.announcementCreate).not.toHaveBeenCalled();
  });
  it("refuses a cancelled event and one that ended more than a day ago", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ eventCancelledAt: new Date() }));
    expect(await postEventAnnouncement(POST_ID, { text: "Hi" })).toEqual({ error: "cancelled" });
    loadCircleEventAccess.mockResolvedValue(access({ eventAt: new Date(Date.now() - 25 * HOUR) }));
    expect(await postEventAnnouncement(POST_ID, { text: "Hi" })).toEqual({ error: "too_late" });
  });
  it("takes at most 5 updates per event in 24 hours (counted in the database)", async () => {
    db.announcementCount.mockResolvedValue(5);
    expect(await postEventAnnouncement(POST_ID, { text: "Sixth" })).toEqual({ error: "limit_reached" });
    expect(db.announcementCreate).not.toHaveBeenCalled();
    expect(db.notificationCreateMany).not.toHaveBeenCalled();
  });
  it("notifies the author and everyone going who is still in the audience, minus blocks and the sender", async () => {
    db.rsvpFindMany.mockResolvedValue([{ userId: "a" }, { userId: "org" }, { userId: "left" }, { userId: "blocker" }]);
    blocked.set("org", new Set(["blocker"]));
    eventAudience.mockResolvedValue(new Set(["author", "a", "org", "blocker"]));
    const result = await postEventAnnouncement(POST_ID, { text: "  Back room,  green door " });
    expect(result).toMatchObject({ error: null, notified: 2, announcementsLeft: 4 });
    expect(db.announcementCreate).toHaveBeenCalledWith({
      data: { postId: POST_ID, authorId: "org", text: "Back room, green door" },
      select: { id: true },
    });
    const rows = db.notificationCreateMany.mock.calls[0][0].data;
    expect(rows.map((r: { recipientId: string }) => r.recipientId)).toEqual(["author", "a"]);
    expect(rows[0]).toMatchObject({ type: "EVENT_ANNOUNCEMENT", actorId: "org", postId: POST_ID, circleId: "circle1" });
    expect(sendFcm.mock.calls[0][0]).toEqual(["author", "a"]);
    const payload = sendFcm.mock.calls[0][1]("en");
    expect(payload).toMatchObject({ title: "Olu", type: "EVENT_ANNOUNCEMENT", url: `/post/${POST_ID}` });
    expect(payload.body).toBe("posted an update about an event you're going to\nBack room, green door");
    expect(db.announcementUpdate).toHaveBeenCalledWith({ where: { id: "ann1" }, data: { recipientCount: 2 } });
    // The push opens exactly what the bell row opens (markReadByTarget matches one against the other).
    const href = notificationHref({
      id: "n1",
      type: rows[0].type,
      recipientId: rows[0].recipientId,
      readAt: null,
      createdAt: new Date(),
      actor: { id: "org", name: "Olu" },
      message: null,
      postId: rows[0].postId,
      circle: { slug: "picnics" },
      conversationId: null,
      collab: null,
      liveStreamId: null,
      channel: null,
      museId: null,
      storyId: null,
    });
    expect(payload.url).toBe(href);
  });
});

describe("check-in", () => {
  it("is for organizers only", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ isOrganizer: false, eventAt: new Date() }));
    expect(await loadEventCheckIn(POST_ID)).toEqual({ error: "forbidden" });
    expect(await setEventAttendance(POST_ID, { userId: PERSON, attended: true })).toEqual({ error: "forbidden" });
    expect(checkRateLimit).toHaveBeenCalledWith("eventCheckIn", "org");
  });
  it("opens the list an hour before the start", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ eventAt: new Date(Date.now() + 2 * HOUR) }));
    expect(await loadEventCheckIn(POST_ID)).toEqual({ error: "too_early" });
    expect(await setEventAttendance(POST_ID, { userId: PERSON, attended: true })).toEqual({ error: "too_early" });
    loadCircleEventAccess.mockResolvedValue(access({ eventAt: new Date(Date.now() + 30 * 60 * 1000) }));
    expect(await loadEventCheckIn(POST_ID)).toMatchObject({ error: null, editable: true });
  });
  it("keeps the list readable but frozen after a day", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ eventAt: new Date(Date.now() - 30 * HOUR) }));
    expect(await loadEventCheckIn(POST_ID)).toMatchObject({ error: null, editable: false });
    expect(await setEventAttendance(POST_ID, { userId: PERSON, attended: true })).toEqual({ error: "too_late" });
  });
  it("checks in someone who replied (Going or Maybe), and a walk-in who is a member who can see the event", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ eventAt: new Date() }));
    db.rsvpFindUnique.mockResolvedValue({ id: "r1", status: "MAYBE" });
    expect(await setEventAttendance(POST_ID, { userId: PERSON, attended: true })).toMatchObject({ error: null });
    expect(db.attendanceUpsert.mock.calls[0][0].create).toEqual({
      postId: POST_ID,
      userId: PERSON,
      walkIn: false,
      checkedInById: "org",
    });
    db.rsvpFindUnique.mockResolvedValue(null);
    eventAudience.mockResolvedValue(new Set([PERSON]));
    await setEventAttendance(POST_ID, { userId: PERSON, attended: true });
    expect(db.attendanceUpsert.mock.calls[1][0].create.walkIn).toBe(true);
  });
  it("refuses a stranger, anyone blocked either way, an inactive account and a private Circle's ex-member", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ eventAt: new Date() }));
    expect(await setEventAttendance(POST_ID, { userId: PERSON, attended: true })).toEqual({ error: "not_eligible" });
    db.rsvpFindUnique.mockResolvedValue({ id: "r1" });
    blocked.set("org", new Set([PERSON]));
    expect(await setEventAttendance(POST_ID, { userId: PERSON, attended: true })).toEqual({ error: "not_eligible" });
    blocked.clear();
    filterCircleContentViewers.mockResolvedValue([]);
    expect(await setEventAttendance(POST_ID, { userId: PERSON, attended: true })).toEqual({ error: "not_eligible" });
    db.userFindUnique.mockResolvedValue({ status: "SUSPENDED" });
    expect(await setEventAttendance(POST_ID, { userId: PERSON, attended: true })).toEqual({ error: "not_eligible" });
    expect(db.attendanceUpsert).not.toHaveBeenCalled();
  });
  it("unticking deletes the row", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ eventAt: new Date() }));
    await setEventAttendance(POST_ID, { userId: PERSON, attended: false });
    expect(db.attendanceDeleteMany).toHaveBeenCalledWith({ where: { postId: POST_ID, userId: PERSON } });
  });
});

describe("exportCircleEventCsv", () => {
  it("is for organizers only, with its own limiter", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ isOrganizer: false }));
    expect(await exportCircleEventCsv(POST_ID, { scope: "event" })).toEqual({ error: "forbidden" });
    checkRateLimit.mockResolvedValue(false);
    expect(await exportCircleEventCsv(POST_ID, { scope: "event" })).toEqual({ error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith("eventExport", "org");
  });
  it("returns neutralized CSV text and a safe file name", async () => {
    const result = await exportCircleEventCsv(POST_ID, { scope: "event" });
    expect(result).toMatchObject({ error: null, rows: 1 });
    if (result.error) throw new Error(result.error);
    expect(result.csv.startsWith("Event,Starts (UTC),Name,Username,")).toBe(true);
    expect(result.csv).toContain(",'=Ada,ada,Maybe,");
    expect(result.csv.startsWith("﻿")).toBe(false);
    expect(result.fileName).toMatch(/^picnic-\d{4}-\d{2}-\d{2}\.csv$/);
  });
  it("rejects an unknown scope", async () => {
    expect(await exportCircleEventCsv(POST_ID, { scope: "everything" })).toEqual({ error: "invalid" });
  });
});

describe("editing and deleting updates", () => {
  const UPDATE_ID = "ckupdate0000000000000000a";
  beforeEach(() => {
    db.announcementFindUnique.mockResolvedValue({ id: UPDATE_ID, postId: POST_ID, authorId: "org", deletedAt: null });
    db.announcementUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("lets the author edit (re-moderated, marked edited, translations dropped) without notifying anyone", async () => {
    const result = await editEventAnnouncement(UPDATE_ID, { text: "  New room " });
    expect(result).toMatchObject({ error: null });
    const call = db.announcementUpdateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: UPDATE_ID, authorId: "org", deletedAt: null });
    expect(call.data.text).toBe("New room");
    expect(call.data.editedAt).toBeInstanceOf(Date);
    expect(moderateText).toHaveBeenCalledWith("New room");
    expect(deleteTranslationsOf).toHaveBeenCalledWith("eventUpdate", UPDATE_ID);
    expect(db.notificationCreateMany).not.toHaveBeenCalled();
    expect(sendFcm).not.toHaveBeenCalled();
  });
  it("refuses another organizer's update, flagged text, and a deleted one", async () => {
    db.announcementFindUnique.mockResolvedValue({ id: UPDATE_ID, postId: POST_ID, authorId: "coadmin", deletedAt: null });
    expect(await editEventAnnouncement(UPDATE_ID, { text: "x" })).toEqual({ error: "forbidden" });
    db.announcementFindUnique.mockResolvedValue({ id: UPDATE_ID, postId: POST_ID, authorId: "org", deletedAt: null });
    moderateText.mockResolvedValue({ allowed: false });
    expect(await editEventAnnouncement(UPDATE_ID, { text: "bad" })).toEqual({ error: "moderation" });
    db.announcementFindUnique.mockResolvedValue({ id: UPDATE_ID, postId: POST_ID, authorId: "org", deletedAt: new Date() });
    expect(await editEventAnnouncement(UPDATE_ID, { text: "x" })).toEqual({ error: "already_deleted" });
    expect(db.announcementUpdateMany).not.toHaveBeenCalled();
  });
  it("lets any organizer delete any update: text erased, row kept for the cap, translations dropped", async () => {
    db.announcementFindUnique.mockResolvedValue({ id: UPDATE_ID, postId: POST_ID, authorId: "coadmin", deletedAt: null });
    expect(await deleteEventAnnouncement(UPDATE_ID)).toMatchObject({ error: null });
    const call = db.announcementUpdateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: UPDATE_ID, deletedAt: null });
    expect(call.data.text).toBe("");
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(deleteTranslationsOf).toHaveBeenCalledWith("eventUpdate", UPDATE_ID);
  });
  it("refuses a plain member deleting someone else's update", async () => {
    loadCircleEventAccess.mockResolvedValue(access({ isOrganizer: false }));
    db.announcementFindUnique.mockResolvedValue({ id: UPDATE_ID, postId: POST_ID, authorId: "coadmin", deletedAt: null });
    expect(await deleteEventAnnouncement(UPDATE_ID)).toEqual({ error: "forbidden" });
    expect(db.announcementUpdateMany).not.toHaveBeenCalled();
  });
});
