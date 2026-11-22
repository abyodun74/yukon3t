import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  storyMediaCopyable,
  storyRepostCredit,
  storyRepostFeedAudience,
  storyRepostRequestId,
  storyRepostText,
  storyMuseBlock,
  storyHasSoundTrack,
  storyReshareOptions,
  storyVideoSeconds,
  STORY_RESHARE_ERRORS,
  STORY_TO_MUSE_MAX_SECONDS,
} from "@/lib/story-reshare";
import { MAX_MUSE_VIDEO_DURATION_SECONDS, MAX_STORY_VIDEO_SECONDS, storyVideoOverCap } from "@/lib/storage";
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
  it("needs a photo's or video's file (any length, known or not) and an embed's provider + id", () => {
    expect(storyMediaCopyable(photo)).toBe(true);
    expect(storyMediaCopyable(clip(30))).toBe(true);
    expect(storyMediaCopyable(clip(120))).toBe(true);
    expect(storyMediaCopyable(clip(null))).toBe(true);
    expect(storyMediaCopyable({ ...clip(30), mediaUrl: null })).toBe(false);
    expect(storyMediaCopyable(embed)).toBe(true);
    expect(storyMediaCopyable({ ...embed, embedId: null })).toBe(false);
  });

  it("reads a usable length only (null, 0, negative and NaN are unknown)", () => {
    expect(storyVideoSeconds(clip(42))).toBe(42);
    for (const bad of [null, 0, -3, Number.NaN]) expect(storyVideoSeconds(clip(bad))).toBeNull();
  });

  it("says why a Story can't become a Muse", () => {
    expect(storyMuseBlock(photo)).toBe("photo");
    expect(storyMuseBlock(embed)).toBeNull();
    expect(storyMuseBlock(clip(120))).toBeNull();
    expect(storyMuseBlock(clip(null))).toBe("length_unknown");
    expect(storyMuseBlock(clip(STORY_TO_MUSE_MAX_SECONDS))).toBeNull();
    expect(storyMuseBlock(clip(STORY_TO_MUSE_MAX_SECONDS + 1))).toBe("too_long");
    expect(STORY_TO_MUSE_MAX_SECONDS).toBe(MAX_MUSE_VIDEO_DURATION_SECONDS);
  });

  const base = { own: false, authorAllowsReposts: true, authorPostsVisibility: "PUBLIC" };
  const offered = (muse: boolean, museBlocked: "length_unknown" | "too_long" | null = null) => ({
    feed: true,
    muse,
    circle: true,
    reason: null,
    museBlocked,
    soundTrackNote: false,
  });
  it("offers Muse only for a video of known length or an embed", () => {
    expect(storyReshareOptions({ ...base, media: photo })).toEqual(offered(false));
    expect(storyReshareOptions({ ...base, media: clip(30) })).toEqual(offered(true));
    expect(storyReshareOptions({ ...base, media: clip(120) })).toEqual(offered(true));
    expect(storyReshareOptions({ ...base, media: embed })).toEqual(offered(true));
  });
  it("still offers Feed and Circles for a video whose length is unknown, and says why Muse isn't there", () => {
    expect(storyReshareOptions({ ...base, media: clip(null) })).toEqual(offered(false, "length_unknown"));
    expect(storyReshareOptions({ ...base, media: clip(400) })).toEqual(offered(false, "too_long"));
  });
  it("offers nothing for an opted-out author (except to the author) or media with no file", () => {
    expect(storyReshareOptions({ ...base, authorAllowsReposts: false, media: photo }).reason).toBe("opted_out");
    expect(storyReshareOptions({ ...base, own: true, authorAllowsReposts: false, media: photo }).feed).toBe(true);
    expect(storyReshareOptions({ ...base, media: { ...clip(30), mediaUrl: null } })).toEqual({
      feed: false,
      muse: false,
      circle: false,
      reason: "unsupported_media",
      museBlocked: null,
      soundTrackNote: false,
    });
  });
  it("keeps someone else's Friends-only Story to the Feed (Muse and Circles would widen its audience)", () => {
    expect(storyReshareOptions({ ...base, authorPostsVisibility: "CONNECTIONS_ONLY", media: clip(30) })).toEqual({
      feed: true,
      muse: false,
      circle: false,
      reason: null,
      museBlocked: null,
      soundTrackNote: false,
    });
    // No Muse note either: Muse is off for the audience, not the video.
    expect(storyReshareOptions({ ...base, authorPostsVisibility: "CONNECTIONS_ONLY", media: clip(null) }).museBlocked).toBeNull();
    expect(storyReshareOptions({ ...base, own: true, authorPostsVisibility: "CONNECTIONS_ONLY", media: clip(30) }).muse).toBe(
      true,
    );
  });
});

describe("a Muse's sound track on a Story (Story.audioUrl)", () => {
  const base = { own: false, authorAllowsReposts: true, authorPostsVisibility: "PUBLIC" };
  const withTrack = { ...clip(30), audioUrl: "https://m/track.mp3" };
  it("is a video Story's only", () => {
    expect(storyHasSoundTrack(withTrack)).toBe(true);
    expect(storyHasSoundTrack(clip(30))).toBe(false);
    expect(storyHasSoundTrack({ ...withTrack, audioUrl: null })).toBe(false);
    expect(storyHasSoundTrack({ ...photo, audioUrl: "https://m/track.mp3" })).toBe(false);
  });
  it("makes the sheet say a Feed / Circle copy plays the video's own sound, and never when nothing is offered", () => {
    expect(storyReshareOptions({ ...base, media: withTrack })).toMatchObject({ feed: true, muse: true, soundTrackNote: true });
    expect(storyReshareOptions({ ...base, media: clip(30) }).soundTrackNote).toBe(false);
    expect(storyReshareOptions({ ...base, authorAllowsReposts: false, media: withTrack }).soundTrackNote).toBe(false);
  });
});

describe("storyVideoOverCap (createStory's server-side cap)", () => {
  it("refuses only a known length past the cap plus one second of rounding grace", () => {
    expect(MAX_STORY_VIDEO_SECONDS).toBe(120);
    expect(storyVideoOverCap(120)).toBe(false);
    expect(storyVideoOverCap(121)).toBe(false);
    expect(storyVideoOverCap(122)).toBe(true);
    expect(storyVideoOverCap(600)).toBe(true);
    for (const unknown of [null, undefined, Number.NaN]) expect(storyVideoOverCap(unknown)).toBe(false);
  });
});

describe("wording in every language", () => {
  it("has a sheet row, the 'copy stays' line and a sentence for every refusal", () => {
    for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
      const sheet = dictionary.feed.stories.shareSheet;
      for (const key of [
        "sendToChats",
        "toFeed",
        "toMuse",
        "toCircle",
        "copyStays",
        "posted",
        "alreadyPosted",
        "repostOff",
        "museLengthUnknown",
        "museTooLong",
        "soundTrackPostNote",
      ] as const) {
        expect(sheet[key].trim(), `${locale} ${key}`).not.toBe("");
      }
      for (const code of [...STORY_RESHARE_ERRORS, "other"] as const) {
        expect(sheet.repostErrors[code].trim(), `${locale} ${code}`).not.toBe("");
      }
      // A Story keeps a Muse's sound track now: the old "the added sound track isn't included" note is gone.
      expect("storySoundNote" in dictionary.muse.share, locale).toBe(false);
      // The share-target's wording for a video createStory measured over the cap.
      expect(dictionary.shell.shareTarget.postErrors.videoTooLong.trim(), locale).not.toBe("");
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
    // A video without a Muse row says why.
    expect(sheet).toContain("text.museLengthUnknown");
    expect(sheet).toContain("text.museTooLong");
  });

  it("marks a video or embed Story in a chat with a play sign", () => {
    const thread = readFileSync("src/components/chat-thread.tsx", "utf8");
    expect(thread).toContain('message.story.mediaType !== "IMAGE" && (');
  });

  it("lets an embedded-video post go to a Story, and keeps a Muse's sound track on one (no 'left out' note)", () => {
    expect(readFileSync("src/components/share-modal.tsx", "utf8")).toContain(
      'mediaType === "IMAGE" || mediaType === "VIDEO" || mediaType === "EMBED"',
    );
    expect(readFileSync("src/components/muse-share-modal.tsx", "utf8")).not.toMatch(/storySoundNote|hasSoundTrack/);
    expect(readFileSync("src/components/muse-feed.tsx", "utf8")).not.toContain("hasSoundTrack");
    const muse = readFileSync("src/app/actions/muse.ts", "utf8");
    expect(muse).toContain("audioUrl: muse.audioUrl,");
    expect(muse).not.toContain("soundTrackLeftOut");
    // The Story sheet says what a Feed / Circle copy of such a Story gets.
    expect(sheet).toContain("text.soundTrackPostNote");
  });

  it("covers a Story's sound track in every media reference and cleanup path", () => {
    expect(readFileSync("src/lib/upload-records.ts", "utf8")).toContain(
      "for (const r of stories) [r.mediaUrl, r.mediaThumbnailUrl, r.audioUrl].forEach(note);",
    );
    expect(readFileSync("src/app/api/cron/expire-stories/route.ts", "utf8")).toContain(
      "[s.mediaUrl, s.mediaThumbnailUrl, s.audioUrl]",
    );
    expect(readFileSync("src/app/actions/stories.ts", "utf8")).toContain(
      "deleteMediaIfUnreferenced([story.mediaUrl, story.mediaThumbnailUrl, story.audioUrl])",
    );
    expect(readFileSync("src/lib/account-media.ts", "utf8")).toContain("[s.mediaUrl, s.mediaThumbnailUrl, s.audioUrl]");
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
    const stories = readFileSync("src/app/actions/stories.ts", "utf8");
    expect(stories).toContain('videoDurationSeconds: mediaType === "VIDEO" ? storedDurationSeconds : undefined');
    // The server measures the stored file; the phone's length is the fallback when it can't be measured.
    expect(stories).toContain("(await probeStoredVideoSeconds(mediaUrl)) ?? videoDurationSeconds");
    // Every composer's probe falls back to the MP4/MOV container when the <video> element can't say.
    expect(readFileSync("src/lib/upload-client.ts", "utf8")).toContain("readMp4DurationSeconds(blobByteReader(file), file.size)");
    expect(readFileSync("src/app/actions/shares.ts", "utf8")).toContain("videoDurationSeconds: root.videoDurationSeconds ?? undefined");
    expect(readFileSync("src/app/actions/muse.ts", "utf8")).toContain("videoDurationSeconds: muse.videoDurationSeconds,");
  });
});
