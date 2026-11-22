/**
 * Reposting a Story to Feed, Muse or a Circle (owner decision 2026-11-22): pure rules, client-safe (no server imports).
 * The server half is src/app/actions/story-reshare.ts; the sheet is src/components/story-share-button.tsx.
 *
 * - Who: anyone who can see the Story (loadViewableStory: unexpired, the author's profile rule, no block either way),
 *   unless its author turned off "Allow others to repost my Stories" (User.allowStoryReposts, on by default). The author
 *   can always repost their own.
 * - What: a COPY. The new Post / Muse gets the Story's media (URL, thumbnail, length, embed provider + id) and caption,
 *   never a reference to the Story, so it stays after the Story expires (24h). deleteMediaIfUnreferenced already counts
 *   Post, Muse and Story URLs, so the file survives the Story's expiry sweep while any copy uses it.
 * - Credit: someone else's Story is credited in the copy's text ("📸 Story by <name>"), the same pattern as a Muse
 *   reshared to Home (toggleMuseRepost's reshareText). The author's own repost carries just their caption.
 * - Audience: Feed mirrors the profile setting (postsVisibility) of the author and of the reposter, the narrower of the
 *   two, never wider (a HIDDEN profile makes it Private). Muse (public to everyone) and a Circle take someone else's
 *   Story only when its author's profile is PUBLIC: a Friends-only author chose their connections, not the reposter's
 *   Circle or everyone (same rule as shareToMuse / shareToCircle for a non-public post, audit M3).
 * - Media: Feed and Circle take a photo, a video or an embed; Muse a video or an embed only (it has no photo variant).
 *   A video needs its length (Story.videoDurationSeconds) to route the video scan; one without (Stories posted before
 *   it was stored) is `unsupported_media` for every destination.
 */

export type StoryReshareDestination = "feed" | "muse" | "circle";

type Visibility = "PUBLIC" | "CONNECTIONS_ONLY" | "HIDDEN";
type PostAudience = "PUBLIC" | "CONNECTIONS_ONLY" | "PRIVATE";

/**
 * The per-reposter idempotency key for one destination: Post/Muse.clientRequestId is unique per author, and the author
 * of the copy is the reposter, so the same person reposting the same Story to the same place twice gets the first copy
 * back (a retry, a double tap), while two different people each get their own. Never matches a composer key (those are
 * UUID-like, no colon).
 */
export function storyRepostRequestId(storyId: string, destination: StoryReshareDestination, circleId?: string): string {
  return destination === "circle" ? `story:${storyId}:circle:${circleId ?? ""}` : `story:${storyId}:${destination}`;
}

const AUDIENCE_RANK: Record<Visibility, number> = { PUBLIC: 0, CONNECTIONS_ONLY: 1, HIDDEN: 2 };

/** The Feed copy's audience: the narrowest of the given profile settings (never wider than any of them). */
export function storyRepostFeedAudience(...profiles: string[]): PostAudience {
  let narrowest: Visibility = "PUBLIC";
  for (const profile of profiles) {
    // An unknown value is treated as the narrowest, so a new setting can never widen a copy.
    const visibility: Visibility = profile in AUDIENCE_RANK ? (profile as Visibility) : "HIDDEN";
    if (AUDIENCE_RANK[visibility] > AUDIENCE_RANK[narrowest]) narrowest = visibility;
  }
  return narrowest === "HIDDEN" ? "PRIVATE" : narrowest;
}

/** The visible credit naming the Story's author: their display name, else @username, else "someone". */
export function storyRepostCredit(author: { name: string | null; username: string | null }): string {
  return `📸 Story by ${author.name ?? (author.username ? `@${author.username}` : "someone")}`;
}

/**
 * The copy's text: someone else's Story gets the credit line first, then the Story's caption; the author's own
 * repost just its caption. Cut to `max` (Post 50,000 via postSchema, Muse 200 via museSchema).
 */
export function storyRepostText(input: {
  own: boolean;
  author: { name: string | null; username: string | null };
  caption: string | null;
  max: number;
}): string {
  const caption = input.caption?.trim() ?? "";
  if (input.own) return caption.slice(0, input.max);
  const credit = storyRepostCredit(input.author);
  return (caption ? `${credit}\n${caption}` : credit).slice(0, input.max);
}

export type StoryReshareMedia = {
  mediaType: "IMAGE" | "VIDEO" | "EMBED";
  mediaUrl: string | null;
  videoDurationSeconds: number | null;
  embedProvider: string | null;
  embedId: string | null;
};

/** Whether the Story's media can be copied at all (a video needs its length; an embed its provider + id). */
export function storyMediaCopyable(story: StoryReshareMedia): boolean {
  if (story.mediaType === "EMBED") return Boolean(story.embedProvider && story.embedId);
  if (!story.mediaUrl) return false;
  if (story.mediaType === "VIDEO") return Boolean(story.videoDurationSeconds && story.videoDurationSeconds > 0);
  return true;
}

/**
 * Which destinations the sheet offers for one Story and viewer, and why none when none: the same decision the actions
 * make (they re-check everything themselves; this only spares the viewer a row that would be refused).
 */
export function storyReshareOptions(input: {
  own: boolean;
  authorAllowsReposts: boolean;
  authorPostsVisibility: string;
  media: StoryReshareMedia;
}): { feed: boolean; muse: boolean; circle: boolean; reason: "opted_out" | "unsupported_media" | null } {
  if (!input.own && !input.authorAllowsReposts) return { feed: false, muse: false, circle: false, reason: "opted_out" };
  if (!storyMediaCopyable(input.media)) return { feed: false, muse: false, circle: false, reason: "unsupported_media" };
  const widensAudience = !input.own && input.authorPostsVisibility !== "PUBLIC";
  return {
    feed: true,
    muse: input.media.mediaType !== "IMAGE" && !widensAudience,
    circle: !widensAudience,
    reason: null,
  };
}

/** Error codes the reshare actions answer, for the sheet's wording (feed.stories.shareSheet.repostErrors). */
export const STORY_RESHARE_ERRORS = [
  "invalid",
  "rate_limited",
  "not_found",
  "blocked",
  "opted_out",
  "not_shareable",
  "unsupported_media",
  "too_long",
  "not_a_member",
] as const;
export type StoryReshareError = (typeof STORY_RESHARE_ERRORS)[number];
