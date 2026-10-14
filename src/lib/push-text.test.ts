import { describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { HIDDEN_CALLER_NAME, hiddenPushPayload } from "@/lib/hidden-chats-rules";
import { NOTIFICATION_VERB } from "@/lib/notification-text";
import { pushPreview } from "@/lib/e2ee/secret-chat";
import { videoPendingReviewNoticeText } from "@/lib/moderation-labels";
import {
  activityLine,
  groupByLocale,
  hiddenPush,
  incomingCallPush,
  messagePush,
  nameOrSomeone,
  noticeLine,
  perLocale,
  ringCallerName,
  storedLocale,
} from "@/lib/push-text";
import { pushEn } from "@/lib/i18n/en/push";

const resolve = <T,>(payload: T | ((locale: "en") => T)) =>
  typeof payload === "function" ? (payload as (locale: "en") => T)("en") : payload;

describe("storedLocale", () => {
  it("reads a supported language and treats anything else as English", () => {
    expect(storedLocale("ar")).toBe("ar");
    expect(storedLocale("pt")).toBe("pt");
    expect(storedLocale(null)).toBe("en");
    expect(storedLocale(undefined)).toBe("en");
    expect(storedLocale("de")).toBe("en");
    expect(storedLocale("AR")).toBe("en");
  });
});

describe("perLocale", () => {
  it("words a payload once per language however often it is asked for", () => {
    const build = vi.fn((locale: string) => ({ title: locale }));
    const payloadFor = perLocale(build);
    payloadFor("es");
    payloadFor("es");
    payloadFor("ar");
    payloadFor("es");
    expect(build).toHaveBeenCalledTimes(2);
    expect(payloadFor("ar")).toEqual({ title: "ar" });
  });

  it("hands a plain payload back as it is", () => {
    const payload = { title: "Ada" };
    expect(perLocale(payload)("fr")).toBe(payload);
  });
});

describe("groupByLocale", () => {
  it("groups by stored language, unknown ones with English, in first-seen order", () => {
    const tokens = [
      { id: "a", locale: "ar" },
      { id: "b", locale: null },
      { id: "c", locale: "ar" },
      { id: "d", locale: "xx" },
      { id: "e", locale: "es" },
    ];
    const groups = groupByLocale(tokens, (t) => t.locale);
    expect([...groups.keys()]).toEqual(["ar", "en", "es"]);
    expect(groups.get("ar")!.map((t) => t.id)).toEqual(["a", "c"]);
    expect(groups.get("en")!.map((t) => t.id)).toEqual(["b", "d"]);
  });
});

describe("English output is unchanged", () => {
  it("hidden-chat payload", () => {
    expect(hiddenPush("en")).toEqual(hiddenPushPayload());
    expect(hiddenPushPayload()).toEqual({ title: "YuKon3t", body: "You have a new notification", url: "/home" });
  });

  it("incoming call", () => {
    expect(resolve(incomingCallPush("VIDEO", "Ana"))).toEqual({
      title: "Incoming video call",
      body: "Ana is calling you",
      url: "/",
    });
    expect(resolve(incomingCallPush("AUDIO", HIDDEN_CALLER_NAME)).body).toBe("Private call is calling you");
    expect(resolve(incomingCallPush("AUDIO", null)).body).toBe("Someone is calling you");
    expect(resolve(incomingCallPush("AUDIO", null)).title).toBe("Incoming voice call");
  });

  it("message", () => {
    const base = { senderName: "Ana", secret: false, mediaType: "NONE" as const, url: "/messages/c1" };
    expect(messagePush({ ...base, content: "hi" })("en")).toEqual({ title: "Ana", body: "hi", url: "/messages/c1" });
    expect(messagePush({ ...base, senderName: null, content: "hi" })("en").title).toBe("New message");
    expect(messagePush({ ...base, content: "x".repeat(300) })("en").body).toHaveLength(120);
    for (const mediaType of ["IMAGE", "VIDEO", "GIF", "AUDIO", "NONE"] as const) {
      for (const secret of [true, false]) {
        const params = { secret, content: secret ? "e2ee:v1:abc" : "hello", mediaType };
        expect(messagePush({ ...base, ...params })("en").body).toBe(pushPreview(params));
      }
    }
  });

  it("activity lines are NOTIFICATION_VERB", () => {
    for (const [type, line] of Object.entries(pushEn.activity)) {
      expect(line).toBe(NOTIFICATION_VERB[type as keyof typeof NOTIFICATION_VERB]);
    }
    expect(activityLine("POST_LIKE", "en")).toBe("liked your post");
  });

  it("system notices", () => {
    expect(noticeLine({ kind: "video_flagged", categories: ["sexual", "violence"] }, "en")).toBe(
      videoPendingReviewNoticeText(["frame@30s: sexual,violence"]),
    );
    expect(noticeLine({ kind: "recording_failed" }, "en")).toBe(
      "Your live stream recording couldn't be posted to the Home Feed. The recording itself is still available to download from the stream's Recordings list.",
    );
    expect(noticeLine({ kind: "recording_flagged", categories: [] }, "en")).toBe(
      "Your live stream recording couldn't be posted to the Home Feed — our automated review flagged it. The recording itself is still available to download from the stream's Recordings list.",
    );
    expect(noticeLine({ kind: "recording_flagged", categories: ["hate", "profanity"] }, "en")).toBe(
      "Your live stream recording couldn't be posted to the Home Feed — our automated review flagged it (hateful content, profanity). The recording itself is still available to download from the stream's Recordings list.",
    );
  });
});

describe.each(SUPPORTED_LOCALES)("%s", (locale) => {
  const t = DICTIONARIES[locale].push;

  it("hidden-chat payload is one neutral line in the recipient's language", () => {
    expect(hiddenPush(locale)).toEqual({ title: "YuKon3t", body: t.hiddenBody, url: "/home" });
  });

  it("a ring names a hidden caller only by the stand-in, and a nameless one as Someone", () => {
    expect(ringCallerName(HIDDEN_CALLER_NAME, locale)).toBe(t.privateCall);
    expect(ringCallerName(null, locale)).toBe(t.someone);
    expect(ringCallerName("Ana", locale)).toBe("Ana");
    expect(nameOrSomeone(null, locale)).toBe(t.someone);
  });

  it("the incoming-call push for a hidden caller carries no name and nothing else that differs", () => {
    const hidden = (incomingCallPush("VIDEO", HIDDEN_CALLER_NAME) as (l: typeof locale) => { title: string; body: string; url: string })(locale);
    const named = (incomingCallPush("VIDEO", "Ana") as (l: typeof locale) => { title: string; body: string; url: string })(locale);
    expect(hidden.body).toBe(t.call.callingPrivate);
    expect(hidden.body).not.toContain("Ana");
    expect(hidden.title).toBe(named.title);
    expect(hidden.url).toBe(named.url);
  });

  it("a secret chat's text never reaches the push, and reads like any unreadable message", () => {
    const base = { senderName: "Ana", mediaType: "NONE" as const, url: "/messages/c1" };
    const secret = messagePush({ ...base, secret: true, content: "e2ee:v1:abc" })(locale);
    const ciphertextElsewhere = messagePush({ ...base, secret: false, content: "e2ee:v1:abc" })(locale);
    expect(secret.body).toBe(t.message.unreadable);
    expect(ciphertextElsewhere.body).toBe(t.message.unreadable);
    expect(secret.body).not.toContain("e2ee");
  });

  it("media messages read the same in a secret chat and an ordinary one", () => {
    const base = { senderName: "Ana", content: "", url: "/messages/c1" };
    for (const mediaType of ["IMAGE", "VIDEO", "GIF", "AUDIO"] as const) {
      expect(messagePush({ ...base, mediaType, secret: true })(locale).body).toBe(
        messagePush({ ...base, mediaType, secret: false })(locale).body,
      );
    }
  });

  it("a system notice names every category it was given", () => {
    const line = noticeLine({ kind: "video_flagged", categories: ["violence", "profanity"] }, locale);
    const categories = DICTIONARIES[locale].pages.notifications.notices.categories;
    expect(line).toContain(categories.violence);
    expect(line).toContain(categories.profanity);
  });
});
