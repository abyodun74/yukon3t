import { describe, expect, it } from "vitest";
import { MAX_MUSE_VIDEO_DURATION_SECONDS } from "@/lib/storage";
import { appendMuseItems, MUSE_FROM_FEED_MAX_SECONDS, museSeedItem, opensInMuse } from "@/lib/muse-from-feed";

const video = { mediaType: "VIDEO", videoUrl: "https://media.example/v.mp4", videoDurationSeconds: 30 };

describe("opensInMuse", () => {
  it("opens a native video Muse could hold", () => {
    expect(opensInMuse(video)).toBe(true);
    expect(opensInMuse({ ...video, videoDurationSeconds: 1 })).toBe(true);
    expect(opensInMuse({ ...video, videoDurationSeconds: MUSE_FROM_FEED_MAX_SECONDS })).toBe(true);
  });

  it("keeps longer videos and ones with no recorded length inline", () => {
    expect(opensInMuse({ ...video, videoDurationSeconds: MUSE_FROM_FEED_MAX_SECONDS + 1 })).toBe(false);
    expect(opensInMuse({ ...video, videoDurationSeconds: 3600 })).toBe(false);
    expect(opensInMuse({ ...video, videoDurationSeconds: null })).toBe(false);
    expect(opensInMuse({ ...video, videoDurationSeconds: 0 })).toBe(false);
  });

  it("needs a video file of ours", () => {
    expect(opensInMuse({ ...video, videoUrl: null })).toBe(false);
    expect(opensInMuse({ ...video, videoUrl: "" })).toBe(false);
  });

  it("never opens embeds, photos, albums, GIFs, links or text", () => {
    for (const mediaType of ["EMBED", "IMAGE", "GIF", "LINK", "NONE"]) {
      expect(opensInMuse({ ...video, mediaType })).toBe(false);
    }
  });

  it("uses the same length cap as Muse itself", () => {
    expect(MUSE_FROM_FEED_MAX_SECONDS).toBe(MAX_MUSE_VIDEO_DURATION_SECONDS);
  });
});

describe("museSeedItem", () => {
  const post = {
    id: "post1",
    content: "Look at this",
    videoUrl: "https://media.example/v.mp4",
    videoThumbnailUrl: "https://media.example/v.jpg",
    videoDurationSeconds: 30,
    createdAt: new Date("2026-11-01T10:00:00Z"),
    author: { id: "u1", name: "Ada", avatarUrl: null },
  };

  it("is the post's own video, author and caption, marked as the post", () => {
    const item = museSeedItem(post);
    expect(item).toMatchObject({
      id: "post1",
      seedPostId: "post1",
      caption: "Look at this",
      mediaType: "VIDEO",
      videoUrl: post.videoUrl,
      videoThumbnailUrl: post.videoThumbnailUrl,
      videoDurationSeconds: 30,
      createdAt: post.createdAt,
      author: post.author,
    });
  });

  it("carries nothing a Muse would: no counts, reaction, reshare, audio track or original-post link", () => {
    const item = museSeedItem(post);
    expect(item).toMatchObject({
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      repostCount: 0,
      viewCount: 0,
      myReaction: null,
      isReposted: false,
      isFollowingAuthor: false,
      audioUrl: null,
      sharedPostId: null,
      embedProvider: null,
      embedId: null,
    });
  });

  it("has no caption for a post without text", () => {
    expect(museSeedItem({ ...post, content: "" }).caption).toBeNull();
  });
});

describe("appendMuseItems", () => {
  const item = (id: string, videoUrl: string | null = `https://media.example/${id}.mp4`) => ({ id, videoUrl });

  it("appends a page in order", () => {
    expect(appendMuseItems([item("a")], [item("b"), item("c")]).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("drops items already listed, and repeats within the page", () => {
    expect(appendMuseItems([item("a"), item("b")], [item("b"), item("c"), item("c")]).map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns the same list when nothing is new", () => {
    const existing = [item("a")];
    expect(appendMuseItems(existing, [item("a")])).toBe(existing);
    expect(appendMuseItems(existing, [])).toBe(existing);
  });

  it("after a feed post, leaves out other copies of the same file", () => {
    const seed = { id: "post1", videoUrl: "https://media.example/clip.mp4" };
    const page = [item("m1"), item("m2", seed.videoUrl), item("m3")];
    expect(appendMuseItems([seed], page, seed.videoUrl).map((i) => i.id)).toEqual(["post1", "m1", "m3"]);
  });

  it("after the post became its Muse, leaves that Muse out of the page", () => {
    const seedMuse = item("m2", "https://media.example/clip.mp4");
    expect(appendMuseItems([seedMuse], [item("m1"), item("m2", seedMuse.videoUrl), item("m3")], seedMuse.videoUrl).map((i) => i.id)).toEqual([
      "m2",
      "m1",
      "m3",
    ]);
  });

  it("keeps embeds (no file) and everything else on /muse, where there is no seed", () => {
    const page = [item("e1", null), item("e2", null), item("m1", "https://media.example/same.mp4"), item("m2", "https://media.example/same.mp4")];
    expect(appendMuseItems([], page).map((i) => i.id)).toEqual(["e1", "e2", "m1", "m2"]);
    expect(appendMuseItems([], page, "https://media.example/other.mp4").map((i) => i.id)).toEqual(["e1", "e2", "m1", "m2"]);
  });
});
