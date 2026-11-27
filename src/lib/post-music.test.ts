import { describe, expect, it } from "vitest";
import {
  POST_MUSIC_KEYS,
  POST_MUSIC_MOODS,
  isPostMusicKey,
  musicReplacesVideoSound,
  postMusicKey,
  postMusicRefusal,
} from "@/lib/post-music";
import { postMusicKeySchema } from "@/lib/validations";
import { feedEn } from "@/lib/i18n/en/feed";
import { feed as feedAr } from "@/lib/i18n/ar/feed";
import { feed as feedDe } from "@/lib/i18n/de/feed";
import { feed as feedEs } from "@/lib/i18n/es/feed";
import { feed as feedFr } from "@/lib/i18n/fr/feed";
import { feed as feedHi } from "@/lib/i18n/hi/feed";
import { feed as feedIt } from "@/lib/i18n/it/feed";
import { feed as feedPt } from "@/lib/i18n/pt/feed";
import { feed as feedSw } from "@/lib/i18n/sw/feed";

// Optional post music: the catalogue of built-in tracks (stable keys, only a key is ever accepted) and where music
// may go.

const DICTIONARIES = { en: feedEn, ar: feedAr, de: feedDe, es: feedEs, fr: feedFr, hi: feedHi, it: feedIt, pt: feedPt, sw: feedSw };

describe("post music catalogue", () => {
  it("has 8 to 10 tracks with unique keys and a mood each", () => {
    expect(POST_MUSIC_KEYS.length).toBeGreaterThanOrEqual(8);
    expect(POST_MUSIC_KEYS.length).toBeLessThanOrEqual(10);
    expect(new Set(POST_MUSIC_KEYS).size).toBe(POST_MUSIC_KEYS.length);
    expect(Object.keys(POST_MUSIC_MOODS).sort()).toEqual([...POST_MUSIC_KEYS].sort());
    expect(new Set(Object.values(POST_MUSIC_MOODS)).size).toBe(POST_MUSIC_KEYS.length);
  });

  it("accepts only catalogue keys, never a URL, a file name or a prototype key", () => {
    for (const key of POST_MUSIC_KEYS) {
      expect(isPostMusicKey(key)).toBe(true);
      expect(postMusicKeySchema.safeParse(key).success).toBe(true);
    }
    for (const bad of ["", "Sunrise", "https://example.com/song.mp3", "sunrise.wav", "__proto__", "toString", 3, null]) {
      expect(isPostMusicKey(bad)).toBe(false);
      expect(postMusicKeySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("reads a removed or unknown key as no music", () => {
    expect(postMusicKey("sunrise")).toBe("sunrise");
    expect(postMusicKey("a-track-removed-later")).toBeNull();
    expect(postMusicKey(null)).toBeNull();
    expect(postMusicKey(undefined)).toBeNull();
  });

  it.each(Object.entries(DICTIONARIES))("names every track and mood in %s", (_lang, dict) => {
    const music = dict.composer.music;
    const names = POST_MUSIC_KEYS.map((key) => music.names[key]);
    expect(names.every((name) => typeof name === "string" && name.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    for (const mood of Object.values(POST_MUSIC_MOODS)) expect(music.moods[mood].trim().length).toBeGreaterThan(0);
    for (const text of [music.label, music.none, music.hint, music.replacesVideoSound]) expect(text.trim()).not.toBe("");
    expect(music.preview).toContain("{name}");
    expect(music.stopPreview).toContain("{name}");
    for (const text of [dict.post.musicPlay, dict.post.musicPause, dict.post.musicLoading, dict.post.musicLabel]) {
      expect(text).toContain("{name}");
    }
    expect(dict.composer.errors.music_not_allowed.trim()).not.toBe("");
    expect(dict.share.musicVideoLinkOnly.trim()).not.toBe("");
    expect(dict.composer.background.frameLabel.trim()).not.toBe("");
  });
});

describe("postMusicRefusal", () => {
  const base = { hasEvent: false, isRepostOrShare: false };

  it.each(["NONE", "IMAGE", "VIDEO"])("allows music on a %s post", (mediaType) => {
    expect(postMusicRefusal({ ...base, mediaType })).toBeNull();
  });

  it.each(["EMBED", "LINK", "GIF"])("refuses music on a %s post", (mediaType) => {
    expect(postMusicRefusal({ ...base, mediaType })).toBe("music_not_allowed");
  });

  it("refuses music on an event, a repost or a share", () => {
    expect(postMusicRefusal({ ...base, mediaType: "NONE", hasEvent: true })).toBe("music_not_allowed");
    expect(postMusicRefusal({ ...base, mediaType: "VIDEO", isRepostOrShare: true })).toBe("music_not_allowed");
  });
});

describe("musicReplacesVideoSound", () => {
  it("is true only for a video with a known track", () => {
    expect(musicReplacesVideoSound({ mediaType: "VIDEO", musicTrack: "groove" })).toBe(true);
    expect(musicReplacesVideoSound({ mediaType: "VIDEO", musicTrack: null })).toBe(false);
    expect(musicReplacesVideoSound({ mediaType: "VIDEO", musicTrack: "gone" })).toBe(false);
    expect(musicReplacesVideoSound({ mediaType: "IMAGE", musicTrack: "groove" })).toBe(false);
    expect(musicReplacesVideoSound({ mediaType: "NONE", musicTrack: "groove" })).toBe(false);
  });
});
