/*
 * Optional music on a post: the catalogue of built-in original tracks and the rules for where one may go. Pure and
 * client-safe (no audio code here: the scores and the synthesizer are src/lib/music/, loaded only when a track plays).
 *
 * Only a key from this catalogue is ever stored (`Post.musicTrack`) or accepted from a client (validations.ts
 * `postMusicKeySchema`). A key the catalogue no longer has (a track removed later) means "no music": nothing plays and
 * nothing is shown.
 *
 * Every track is composed and synthesized by code in this repo (src/lib/music/tracks.ts + synth.ts): no uploads, no
 * third-party or downloaded audio, loops, samples or soundfonts, so there is nothing to license.
 */

/** The tracks, in picker order. Keys are stable: they are what's stored on a post. Names are in the feed dictionary. */
export const POST_MUSIC_KEYS = [
  "sunrise",
  "lateNight",
  "breeze",
  "daydream",
  "groove",
  "celebrate",
  "tender",
  "focus",
  "adventure",
  "island",
] as const;

export type PostMusicKey = (typeof POST_MUSIC_KEYS)[number];

/** The mood each track is written for (shown under its name in the picker). Names/moods: `feed.composer.music`. */
export const POST_MUSIC_MOODS: Record<PostMusicKey, "hopeful" | "chill" | "light" | "dreamy" | "funky" | "party" | "romantic" | "calm" | "epic" | "sunny"> = {
  sunrise: "hopeful",
  lateNight: "chill",
  breeze: "light",
  daydream: "dreamy",
  groove: "funky",
  celebrate: "party",
  tender: "romantic",
  focus: "calm",
  adventure: "epic",
  island: "sunny",
};

export function isPostMusicKey(value: unknown): value is PostMusicKey {
  return typeof value === "string" && (POST_MUSIC_KEYS as readonly string[]).includes(value);
}

/** The stored key if it is still in the catalogue, else null ("no music"). */
export function postMusicKey(value: string | null | undefined): PostMusicKey | null {
  return isPostMusicKey(value) ? value : null;
}

export type PostMusicRefusal = "music_not_allowed";

/**
 * Whether a post may carry music: a post the person makes with their own video, photo(s) (an album has ONE track for
 * the whole set, stored on its lead post) or text only (styled or plain). Never an embed, link, GIF, event, repost or
 * share. Used by createPost and editPost; the composer offers it on the same posts only.
 */
export function postMusicRefusal(input: {
  mediaType: string;
  hasEvent: boolean;
  isRepostOrShare: boolean;
}): PostMusicRefusal | null {
  if (input.hasEvent || input.isRepostOrShare) return "music_not_allowed";
  if (input.mediaType === "NONE" || input.mediaType === "IMAGE" || input.mediaType === "VIDEO") return null;
  return "music_not_allowed";
}

/**
 * Whether the post's music replaces a video's own sound: a VIDEO post with a known track. Every surface that would
 * play, save or send that video's file (lightbox Save, native share, Share to Story / Muse, the Muse viewer) checks
 * this so the original audio never comes back where the author replaced it.
 */
export function musicReplacesVideoSound(post: { mediaType: string; musicTrack?: string | null }): boolean {
  return post.mediaType === "VIDEO" && postMusicKey(post.musicTrack) !== null;
}
