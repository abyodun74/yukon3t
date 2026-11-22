import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NotificationType } from "@/generated/prisma/enums";
import { SUPPORTED_LOCALES, aroundPlaceholder } from "@/lib/i18n/locales";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { NOTIFICATION_VERB } from "@/lib/notification-text";
import { activityLine } from "@/lib/push-text";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

// "<name> reposted your story" (STORY_REPOST, actions/story-reshare.ts): the bell row's wording in every language,
// the push line, and where the row leads (the copy, never the Story, which expires).

const row: NotificationData = {
  id: "n1",
  type: "STORY_REPOST",
  recipientId: "me",
  readAt: null,
  createdAt: new Date("2026-11-22T12:00:00Z"),
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

describe("STORY_REPOST", () => {
  it("is a notification type (added by its own enum migration)", () => {
    expect(NotificationType.STORY_REPOST).toBe("STORY_REPOST");
    expect(readFileSync("prisma/migrations/20261127120000_story_repost_type/migration.sql", "utf8")).toContain(
      `ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STORY_REPOST';`,
    );
  });

  it("renders as the actor's name around a sentence in every language (notification-row.tsx splits on {name})", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const text = DICTIONARIES[locale].pages.notifications.types.STORY_REPOST;
      expect(text, locale).toContain("{name}");
      const [before, after] = aroundPlaceholder(text, "name");
      expect(`${before}${after}`.trim(), locale).not.toBe("");
    }
    expect(DICTIONARIES.en.pages.notifications.types.STORY_REPOST).toBe("{name} reposted your story");
    expect(NOTIFICATION_VERB.STORY_REPOST).toBe("reposted your story");
  });

  it("has a push line in every language, the English one matching the bell verb", () => {
    for (const locale of SUPPORTED_LOCALES) expect(activityLine("STORY_REPOST", locale).trim(), locale).not.toBe("");
    expect(activityLine("STORY_REPOST", "en")).toBe(NOTIFICATION_VERB.STORY_REPOST);
    expect(activityLine("STORY_REPOST", "fr")).toBe("A republié votre story");
  });

  it("opens the copy: the Feed / Circle post, or the Muse", () => {
    expect(notificationHref({ ...row, postId: "p1" })).toBe("/post/p1");
    expect(notificationHref({ ...row, museId: "m1" })).toBe("/muse/m1");
    expect(notificationHref(row)).toBe("/home");
  });
});
