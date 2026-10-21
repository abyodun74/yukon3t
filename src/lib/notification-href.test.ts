import { describe, it, expect } from "vitest";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

const base: NotificationData = {
  id: "n1",
  type: "POLL_CREATED",
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
  it("leaves other notifications alone", () => {
    expect(notificationHref({ ...base, type: "EVENT_RSVP", circle: { slug: "runners" }, postId: "p1" })).toBe(
      "/post/p1",
    );
  });
});
