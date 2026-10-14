import { describe, expect, it } from "vitest";
import { decodeNotice, encodeNotice, noticeText, type Notice } from "@/lib/notification-notice";
import { pagesEn } from "@/lib/i18n/en/pages";
import { violationKeysFromReasons } from "@/lib/moderation-labels";

const t = pagesEn.notifications.notices;

describe("encodeNotice / decodeNotice", () => {
  it("round-trips every kind", () => {
    const notices: Notice[] = [
      { kind: "video_flagged", categories: ["sexual", "violence/graphic"] },
      { kind: "video_flagged", categories: [] },
      { kind: "recording_failed" },
      { kind: "recording_flagged", categories: ["moderation_api_error"] },
      { kind: "recording_flagged", categories: [] },
    ];
    for (const notice of notices) expect(decodeNotice(encodeNotice(notice))).toEqual(notice);
  });

  it("returns null for nothing or anything it doesn't know, so the stored message is shown", () => {
    expect(decodeNotice(null)).toBeNull();
    expect(decodeNotice(undefined)).toBeNull();
    expect(decodeNotice("")).toBeNull();
    expect(decodeNotice("something_new:x")).toBeNull();
    expect(decodeNotice("recording_failed:x")).toBeNull();
  });
});

describe("noticeText", () => {
  it("dedupes categories that read the same and keeps their order", () => {
    const categories = violationKeysFromReasons(["frame@1s: self-harm/intent,violence", "audio: self-harm"]);
    expect(categories).toEqual(["self-harm", "violence"]);
    expect(noticeText({ kind: "video_flagged", categories }, t, ", ")).toBe(
      "A video you posted was flagged by our automated review (self-harm content, violent content) and is on hold pending a closer look.",
    );
  });

  it("words a category the dictionary doesn't have as English always has", () => {
    expect(noticeText({ kind: "video_flagged", categories: ["some_new/category"] }, t, ", ")).toContain(
      "(some new category)",
    );
  });
});
