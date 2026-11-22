import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  storyMediaCopyable,
  storyRepostCredit,
  storyRepostFeedAudience,
  storyRepostRequestId,
  storyRepostText,
  storyReshareOptions,
  STORY_RESHARE_ERRORS,
} from "@/lib/story-reshare";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";

const photo = { mediaType: "IMAGE" as const, mediaUrl: "https://m/x.jpg", videoDurationSeconds: null, embedProvider: null, embedId: null };
const clip = (seconds: number | null) => ({ ...photo, mediaType: "VIDEO" as const, mediaUrl: "https://m/v.mp4", videoDurationSeconds: seconds });
const embed = { ...photo, mediaType: "EMBED" as const, mediaUrl: null, embedProvider: "YOUTUBE", embedId: "abc" };

describe("storyRepostRequestId", () => {
  it("is one key per Story and destination (per Circle for a Circle), never a composer-style key", () => {
    expect(storyRepostRequestId("s1", "feed")).toBe("story:s1:feed");
    expect(storyRepostRequestId("s1", "muse")).toBe("story:s1:muse");
    expect(storyRepostRequestId("s1", "circle", "c1")).toBe("story:s1:circle:c1");
    expect(storyRepostRequestId("s1", "circle", "c2")).not.toBe(storyRepostRequestId("s1", "circle", "c1"));
    // The composer's keys are /^[A-Za-z0-9-]{8,64}$/ (createPost): these can never collide with one.
    expect(storyRepostRequestId("s1", "feed")).not.toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });
});

describe("storyRepostFeedAudience", () => {
  it("takes the narrowest profile setting, HIDDEN as Private, an unknown value as the narrowest", () => {
    expect(storyRepostFeedAudience("PUBLIC")).toBe("PUBLIC");
    expect(storyRepostFeedAudience("PUBLIC", "PUBLIC")).toBe("PUBLIC");
    expect(storyRepostFeedAudience("CONNECTIONS_ONLY", "PUBLIC")).toBe("CONNECTIONS_ONLY");
    expect(storyRepostFeedAudience("PUBLIC", "CONNECTIONS_ONLY")).toBe("CONNECTIONS_ONLY");
    expect(storyRepostFeedAudience("HIDDEN", "PUBLIC")).toBe("PRIVATE");
    expect(storyRepostFeedAudience("CONNECTIONS_ONLY", "HIDDEN")).toBe("PRIVATE");
    expect(storyRepostFeedAudience("PUBLIC", "SOMETHING_NEW")).toBe("PRIVATE");
  });
});

describe("storyRepostText", () => {
  const ada = { name: "Ada", username: "ada" };
  it("credits someone else's Story first, then its caption", () => {
    expect(storyRepostText({ own: false, author: ada, caption: " Sunset ", max: 500 })).toBe("📸 Story by Ada\nSunset");
    expect(storyRepostText({ own: false, author: ada, caption: null, max: 500 })).toBe("📸 Story by Ada");
    expect(storyRepostCredit({ name: null, username: "ada" })).toBe("📸 Story by @ada");
    expect(storyRepostCredit({ name: null, username: null })).toBe("📸 Story by someone");
  });
  it("carries only the caption for the author's own Story, and is cut to the destination's cap", () => {
    expect(storyRepostText({ own: true, author: ada, caption: "Mine", max: 500 })).toBe("Mine");
    expect(storyRepostText({ own: true, author: ada, caption: null, max: 500 })).toBe("");
    expect(storyRepostText({ own: false, author: ada, caption: "x".repeat(400), max: 200 })).toHaveLength(200);
  });
});

describe("storyMediaCopyable / storyReshareOptions", () => {
  it("needs a video's length, an embed's provider + id, a photo's URL", () => {
    expect(storyMediaCopyable(photo)).toBe(true);
    expect(storyMediaCopyable(clip(30))).toBe(true);
    expect(storyMediaCopyable(clip(null))).toBe(false);
    expect(storyMediaCopyable(clip(0))).toBe(false);
    expect(storyMediaCopyable(embed)).toBe(true);
    expect(storyMediaCopyable({ ...embed, embedId: null })).toBe(false);
  });

  const base = { own: false, authorAllowsReposts: true, authorPostsVisibility: "PUBLIC" };
  it("offers Muse only for a video or an embed", () => {
    expect(storyReshareOptions({ ...base, media: photo })).toEqual({ feed: true, muse: false, circle: true, reason: null });
    expect(storyReshareOptions({ ...base, media: clip(30) })).toEqual({ feed: true, muse: true, circle: true, reason: null });
    expect(storyReshareOptions({ ...base, media: embed })).toEqual({ feed: true, muse: true, circle: true, reason: null });
  });
  it("offers nothing for an opted-out author (except to the author) or an uncopyable video", () => {
    expect(storyReshareOptions({ ...base, authorAllowsReposts: false, media: photo }).reason).toBe("opted_out");
    expect(storyReshareOptions({ ...base, own: true, authorAllowsReposts: false, media: photo }).feed).toBe(true);
    expect(storyReshareOptions({ ...base, media: clip(null) })).toEqual({
      feed: false,
      muse: false,
      circle: false,
      reason: "unsupported_media",
    });
  });
  it("keeps someone else's Friends-only Story to the Feed (Muse and Circles would widen its audience)", () => {
    expect(storyReshareOptions({ ...base, authorPostsVisibility: "CONNECTIONS_ONLY", media: clip(30) })).toEqual({
      feed: true,
      muse: false,
      circle: false,
      reason: null,
    });
    expect(storyReshareOptions({ ...base, own: true, authorPostsVisibility: "CONNECTIONS_ONLY", media: clip(30) }).muse).toBe(
      true,
    );
  });
});

describe("wording in every language", () => {
  it("has a sheet row, the 'copy stays' line and a sentence for every refusal", () => {
    for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
      const sheet = dictionary.feed.stories.shareSheet;
      for (const key of ["sendToChats", "toFeed", "toMuse", "toCircle", "copyStays", "posted", "alreadyPosted", "repostOff"] as const) {
        expect(sheet[key].trim(), `${locale} ${key}`).not.toBe("");
      }
      for (const code of [...STORY_RESHARE_ERRORS, "other"] as const) {
        expect(sheet.repostErrors[code].trim(), `${locale} ${code}`).not.toBe("");
      }
      expect(dictionary.muse.share.storySoundNote.trim(), locale).not.toBe("");
      expect(dictionary.settings.privacy.allowStoryReposts.trim(), locale).not.toBe("");
      expect(dictionary.settings.privacy.allowStoryRepostsHint.trim(), locale).not.toBe("");
    }
  });
});

describe("the sheets", () => {
  const sheet = readFileSync("src/components/story-share-button.tsx", "utf8");
  it("offers chats plus the three Post rows, each saying the copy stays", () => {
    for (const name of ["shareStoryToConversations", "shareStoryToFeed", "shareStoryToMuse", "shareStoryToCircle", "getMyCircles"]) {
      expect(sheet, name).toContain(name);
    }
    expect(sheet).toContain("getStoryReshareOptions(storyId)");
    expect(sheet.match(/text\.copyStays/g)?.length).toBeGreaterThanOrEqual(2);
    // Same layer, Back and pause behaviour as before.
    expect(sheet).toContain("useBackDismiss(open, close)");
    expect(sheet).toContain("useDialogFocus<HTMLDivElement>(open, close)");
    expect(sheet).toContain("onOpenChange?.(true)");
  });

  it("lets an embedded-video post go to a Story, and notes a Muse's sound track when it goes to one", () => {
    expect(readFileSync("src/components/share-modal.tsx", "utf8")).toContain(
      'mediaType === "IMAGE" || mediaType === "VIDEO" || mediaType === "EMBED"',
    );
    expect(readFileSync("src/components/muse-share-modal.tsx", "utf8")).toContain("t.storySoundNote");
    expect(readFileSync("src/components/muse-feed.tsx", "utf8")).toContain("hasSoundTrack={Boolean(displayedShareMuse.audioUrl)}");
  });

  it("keeps a public Circle post's Share sheet reachable (only members-only posts hide it)", () => {
    const card = readFileSync("src/components/post-card.tsx", "utf8");
    expect(card).toContain('{post.visibility === "PUBLIC" && !post.membersOnly && (');
    expect(card).toContain("<ShareModal");
    expect(readFileSync("src/app/circles/[slug]/page.tsx", "utf8")).toContain("postCardInclude");
  });

  it("records a video Story's length everywhere a Story is made", () => {
    expect(readFileSync("src/components/story-upload-modal.tsx", "utf8")).toContain('fd.set("videoDurationSeconds"');
    expect(readFileSync("src/components/share-target-gate.tsx", "utf8")).toContain('fd.set("videoDurationSeconds"');
    expect(readFileSync("src/app/actions/stories.ts", "utf8")).toContain(
      'videoDurationSeconds: mediaType === "VIDEO" ? videoDurationSeconds : undefined',
    );
    expect(readFileSync("src/app/actions/shares.ts", "utf8")).toContain("videoDurationSeconds: root.videoDurationSeconds ?? undefined");
    expect(readFileSync("src/app/actions/muse.ts", "utf8")).toContain("videoDurationSeconds: muse.videoDurationSeconds,");
  });
});
