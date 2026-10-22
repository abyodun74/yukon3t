import { describe, it, expect } from "vitest";
import { NotificationType } from "@/generated/prisma/enums";
import { notificationHref, storyHref, type NotificationData } from "@/lib/notification-href";

const base: NotificationData = {
  id: "n1",
  type: "POLL_CREATED",
  recipientId: "me",
  readAt: null,
  createdAt: new Date("2026-10-19T12:00:00Z"),
  actor: { id: "u1", name: "Ada" },
  message: null,
  postId: null,
  circle: null,
  conversationId: null,
  collab: null,
  liveStreamId: null,
  channel: null,
  museId: null,
  storyId: null,
};

describe("notificationHref for polls", () => {
  it("lands a new Circle poll (channel or not) on the page's polls section", () => {
    expect(notificationHref({ ...base, circle: { slug: "runners" } })).toBe("/circles/runners#polls");
    expect(notificationHref({ ...base, circle: { slug: "runners" }, channel: { slug: "general" } })).toBe(
      "/circles/runners#polls",
    );
  });
  it("lands a collab poll on the collab's polls section", () => {
    expect(notificationHref({ ...base, collab: { id: "c1" } })).toBe("/collab/c1#polls");
  });
  it("lands a scheduled Circle poll on the polls section, not the event post it carries", () => {
    expect(
      notificationHref({ ...base, type: "POLL_SCHEDULED", circle: { slug: "runners" }, postId: "p1" }),
    ).toBe("/circles/runners#polls");
    expect(notificationHref({ ...base, type: "POLL_SCHEDULED", collab: { id: "c1" } })).toBe("/collab/c1#polls");
  });
  it("lands an RSVP nudge on the event post, and on the Circle's upcoming events without one", () => {
    expect(
      notificationHref({ ...base, type: "EVENT_RSVP_NUDGE", circle: { slug: "runners" }, postId: "p1" }),
    ).toBe("/post/p1");
    expect(notificationHref({ ...base, type: "EVENT_RSVP_NUDGE", circle: { slug: "runners" } })).toBe(
      "/circles/runners#events",
    );
  });
  it("lands a cancelled or moved event on the post, and on the Circle's events without one", () => {
    for (const type of ["EVENT_CANCELLED", "EVENT_RESCHEDULED"] as const) {
      expect(notificationHref({ ...base, type, circle: { slug: "runners" }, postId: "p1" })).toBe("/post/p1");
      expect(notificationHref({ ...base, type, circle: { slug: "runners" } })).toBe("/circles/runners#events");
    }
  });
  it("leaves other notifications alone", () => {
    expect(notificationHref({ ...base, type: "EVENT_RSVP", circle: { slug: "runners" }, postId: "p1" })).toBe(
      "/post/p1",
    );
  });
});

describe("notificationHref for a new Circle (site admins' oversight notice)", () => {
  it("opens a public Circle's page, and the admin Circles list for a private one (its page doesn't exist for them)", () => {
    const created = { ...base, type: "CIRCLE_CREATED" as const };
    expect(notificationHref({ ...created, circle: { slug: "runners", visibility: "PUBLIC" } })).toBe("/circles/runners");
    expect(notificationHref({ ...created, circle: { slug: "runners" } })).toBe("/circles/runners");
    expect(notificationHref({ ...created, circle: { slug: "secret", visibility: "PRIVATE" } })).toBe("/admin/circles");
  });
  it("leaves every other private-Circle notice on the Circle (only members and invitees ever see one)", () => {
    expect(
      notificationHref({ ...base, type: "CIRCLE_INVITE", circle: { slug: "secret", visibility: "PRIVATE" } }),
    ).toBe("/circles/secret");
  });
});

// Every notification type, with the ids its creator actually stores (see each prisma.notification.create), and the
// exact place it must open. Typed as a Record over the type union and checked against the Prisma enum below, so a new
// NotificationType can't be added without deciding where it leads.
type Case = { data: Partial<NotificationData>; href: string };
const post = { postId: "p1" };
const muse = { museId: "m1" };
const circle = { circle: { slug: "runners", visibility: "PUBLIC" } };
const collab = { collab: { id: "k1" } };
const chat = { conversationId: "c1" };
const live = { liveStreamId: "l1" };
const EVERY_TYPE: Record<NotificationData["type"], Case[]> = {
  CONNECTION_REQUEST: [{ data: {}, href: "/connections" }],
  CONNECTION_ACCEPTED: [{ data: {}, href: "/connections" }],
  CONNECTION_POST: [{ data: post, href: "/post/p1" }],
  POST_LIKE: [{ data: post, href: "/post/p1" }],
  POST_COMMENT: [{ data: post, href: "/post/p1" }],
  // Someone (the actor) commented on the reader's own story: the reader's profile, viewer open at that story.
  STORY_COMMENT: [
    { data: { storyId: "s1" }, href: "/u/me?story=s1" },
    { data: {}, href: "/u/me" },
  ],
  MUSE_LIKE: [{ data: muse, href: "/muse/m1" }],
  MUSE_COMMENT: [{ data: muse, href: "/muse/m1" }],
  COMMENT_REPLY: [{ data: post, href: "/post/p1" }],
  POST_REPOST: [{ data: post, href: "/post/p1" }],
  POST_SHARE: [{ data: post, href: "/post/p1" }],
  MUSE_REPOST: [{ data: muse, href: "/muse/m1" }],
  MUSE_SHARE: [{ data: muse, href: "/muse/m1" }],
  EVENT_RSVP: [{ data: post, href: "/post/p1" }],
  CIRCLE_JOINED: [{ data: circle, href: "/circles/runners" }],
  CIRCLE_CREATED: [
    { data: circle, href: "/circles/runners" },
    { data: { circle: { slug: "secret", visibility: "PRIVATE" } }, href: "/admin/circles" },
  ],
  EVENT_REMINDER: [{ data: post, href: "/post/p1" }],
  CIRCLE_JOIN_REQUEST: [{ data: circle, href: "/circles/runners" }],
  CIRCLE_JOIN_APPROVED: [{ data: circle, href: "/circles/runners" }],
  MESSAGE: [{ data: chat, href: "/messages/c1" }],
  GROUP_ADDED: [{ data: chat, href: "/messages/c1" }],
  COLLAB_JOINED: [{ data: collab, href: "/collab/k1" }],
  COLLAB_JOIN_REQUEST: [{ data: collab, href: "/collab/k1" }],
  COLLAB_JOIN_APPROVED: [{ data: collab, href: "/collab/k1" }],
  COLLAB_INVITE: [{ data: collab, href: "/collab/k1" }],
  COLLAB_INVITE_ACCEPTED: [{ data: collab, href: "/collab/k1" }],
  SUBSCRIPTION_POST: [{ data: post, href: "/post/p1" }],
  // The actor posted the story: their profile.
  SUBSCRIPTION_STORY: [{ data: { storyId: "s1" }, href: "/u/u1?story=s1" }],
  SUBSCRIPTION_REPOST: [{ data: post, href: "/post/p1" }],
  SUBSCRIPTION_LIVE: [{ data: live, href: "/live/l1" }],
  SUBSCRIPTION_RSVP: [{ data: post, href: "/post/p1" }],
  SUBSCRIPTION_CIRCLE_JOINED: [{ data: circle, href: "/circles/runners" }],
  SUBSCRIPTION_CIRCLE_CREATED: [{ data: circle, href: "/circles/runners" }],
  SUBSCRIPTION_MUSE: [{ data: muse, href: "/muse/m1" }],
  SUBSCRIPTION_COLLAB: [{ data: collab, href: "/collab/k1" }],
  VOICE_CHANNEL_INVITE: [{ data: { ...circle, channel: { slug: "lounge" } }, href: "/circles/runners?channel=lounge" }],
  VOICE_CHANNEL_INVITE_ACCEPTED: [
    { data: { ...circle, channel: { slug: "lounge" } }, href: "/circles/runners?channel=lounge" },
  ],
  // The caller's profile (call back / message from there); the missed-call push opens the same place.
  MISSED_CALL: [{ data: {}, href: "/u/u1" }],
  SCREENSHOT_TAKEN: [
    { data: post, href: "/post/p1" },
    { data: { storyId: "s1" }, href: "/u/me?story=s1" },
    { data: chat, href: "/messages/c1" },
    { data: {}, href: "/u/u1" },
  ],
  VIDEO_MODERATION_FAILED: [{ data: {}, href: "/home" }],
  VIDEO_FLAGGED_FOR_REVIEW: [
    { data: post, href: "/post/p1" },
    { data: muse, href: "/muse/m1" },
  ],
  APP_FEEDBACK_SUBMITTED: [{ data: {}, href: "/admin/feedback" }],
  CIRCLE_LIVE: [{ data: { ...circle, ...live }, href: "/live/l1" }],
  LIVE_STREAM_INVITE: [{ data: live, href: "/live/l1" }],
  COLLAB_SESSION_REMINDER: [{ data: collab, href: "/collab/k1" }],
  LIVE_RECORDING_POST_FAILED: [{ data: live, href: "/live/l1" }],
  CIRCLE_INVITE: [{ data: circle, href: "/circles/runners" }],
  CIRCLE_INVITE_ACCEPTED: [{ data: circle, href: "/circles/runners" }],
  COLLAB_SESSION_STARTED: [{ data: collab, href: "/collab/k1" }],
  POLL_CREATED: [
    { data: circle, href: "/circles/runners#polls" },
    { data: collab, href: "/collab/k1#polls" },
  ],
  POLL_SCHEDULED: [{ data: { ...circle, ...post }, href: "/circles/runners#polls" }],
  EVENT_RSVP_NUDGE: [{ data: { ...circle, ...post }, href: "/post/p1" }],
  EVENT_CANCELLED: [{ data: { ...circle, ...post }, href: "/post/p1" }],
  EVENT_RESCHEDULED: [{ data: { ...circle, ...post }, href: "/post/p1" }],
};

describe("notificationHref for every notification type", () => {
  it("covers exactly the NotificationType enum", () => {
    expect(Object.keys(EVERY_TYPE).sort()).toEqual(Object.keys(NotificationType).sort());
  });
  for (const [type, cases] of Object.entries(EVERY_TYPE) as [NotificationData["type"], Case[]][]) {
    it(`opens the exact target of ${type}`, () => {
      for (const { data, href } of cases) {
        expect(notificationHref({ ...base, type, ...data })).toBe(href);
      }
    });
  }
});

describe("storyHref", () => {
  it("opens the owner's profile at the story, or just the profile without one", () => {
    expect(storyHref("me", "s1")).toBe("/u/me?story=s1");
    expect(storyHref("me", null)).toBe("/u/me");
  });
});
