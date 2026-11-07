// Opening a Home feed video in the Muse viewer (MuseViewerOverlay): which videos do it, the stand-in card the viewer
// starts on, and how the Muse feed that follows is merged in. Pure and client-safe.

// Duplicated from storage.ts's MAX_MUSE_VIDEO_DURATION_SECONDS rather than imported — that file pulls in
// @aws-sdk/client-s3, which is server-only. Same pattern as share-modal.tsx's copy; the test pins the two together.
export const MUSE_FROM_FEED_MAX_SECONDS = 300;

type FeedVideo = { mediaType: string; videoUrl: string | null; videoDurationSeconds: number | null };

/**
 * A tap on this feed video opens the Muse viewer: a video file of ours with a known length Muse itself could hold.
 * Embeds (YouTube/TikTok/...), photos and albums, GIFs, links, longer videos and ones whose length was never recorded
 * keep their inline tap (play/pause).
 */
export function opensInMuse(post: FeedVideo): boolean {
  return (
    post.mediaType === "VIDEO" &&
    Boolean(post.videoUrl) &&
    post.videoDurationSeconds != null &&
    post.videoDurationSeconds > 0 &&
    post.videoDurationSeconds <= MUSE_FROM_FEED_MAX_SECONDS
  );
}

/** What the viewer needs of the tapped post. Everything here is already on the viewer's screen in the feed card. */
export type MuseSeedPost = {
  id: string;
  content: string;
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  videoDurationSeconds: number | null;
  createdAt: Date;
  author: { id: string; name: string | null; avatarUrl: string | null };
};

/**
 * The card the viewer opens on, built from the post itself (no Muse row is created or looked up for it). It carries
 * `seedPostId` so the card leaves out what only a Muse has: reactions, comments, reshare, share, views, delete.
 */
export function museSeedItem(post: MuseSeedPost) {
  return {
    id: post.id,
    seedPostId: post.id,
    caption: post.content || null,
    mediaType: "VIDEO" as const,
    videoUrl: post.videoUrl,
    videoThumbnailUrl: post.videoThumbnailUrl,
    videoDurationSeconds: post.videoDurationSeconds,
    embedProvider: null,
    embedId: null,
    audioUrl: null,
    createdAt: post.createdAt,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    repostCount: 0,
    viewCount: 0,
    author: post.author,
    myReaction: null,
    isReposted: false,
    isFollowingAuthor: false,
    sharedPostId: null,
  };
}

/**
 * Appends a page of Muse feed items, leaving out any already listed and, when the viewer was opened from a feed video,
 * any other copy of that same file (the Muse it was reshared from, or a Muse it was shared to), so the clip the
 * viewer started on doesn't come round again.
 */
export function appendMuseItems<T extends { id: string; videoUrl: string | null }>(
  existing: T[],
  incoming: T[],
  seedVideoUrl: string | null = null,
): T[] {
  const ids = new Set(existing.map((item) => item.id));
  const fresh = incoming.filter((item) => {
    if (ids.has(item.id)) return false;
    if (seedVideoUrl && item.videoUrl === seedVideoUrl) return false;
    ids.add(item.id);
    return true;
  });
  return fresh.length ? [...existing, ...fresh] : existing;
}
