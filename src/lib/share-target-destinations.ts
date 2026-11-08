// Sharing in from another app (share-target-gate.tsx): which destinations a share can go to, which Circle channels
// the picker offers, and how one share becomes the chat messages it is sent as. Pure and client-safe (no database, no
// server-only imports): getShareTargetCircles (actions/circles.ts) and the sheet both use it, and it is unit-tested.
// None of it is a security boundary: createPost / createStory / createMuse / sendToConversations re-check everything.

// Duplicated from storage.ts's server-only constants (same pattern as share-modal.tsx/muse-share-modal.tsx's own
// duplicates of these): a Story video tops out at 2 minutes, a Muse at 5.
export const MAX_STORY_VIDEO_SECONDS = 120;
export const MAX_MUSE_VIDEO_DURATION_SECONDS = 300;

/** Longest caption the sheet takes: under every destination's own cap except a Story's (cut to 200 there). */
export const SHARE_CAPTION_MAX_CHARS = 2200;
export const STORY_CAPTION_MAX_CHARS = 200;

export type ShareTargetContent = {
  imageCount: number;
  hasVideo: boolean;
  /** The share carries no file but a link to a recognized video platform (parseVideoEmbedUrl). */
  hasEmbed: boolean;
  /** The probed length of the shared video; null while unknown or when the probe failed. */
  videoDurationSeconds: number | null;
};

export type ShareTargetOptions = {
  story: boolean;
  muse: boolean;
  feed: boolean;
  circle: boolean;
  /** Always offered: a bare link or text can still go to a chat. */
  people: true;
};

/**
 * The destinations the sheet offers for a share. Home Feed and a Circle take the same posts (createPost), so they are
 * offered together: anything with a photo, a video or an embeddable link. A Story needs a photo, a video no longer than
 * 2 minutes or an embed; an unknown length fails open (the server checks it). Muse is video only (or an embed) and
 * needs the length known and at most 5 minutes.
 */
export function shareTargetOptions(content: ShareTargetContent): ShareTargetOptions {
  const hasMedia = content.imageCount > 0 || content.hasVideo;
  const postable = hasMedia || content.hasEmbed;
  const duration = content.videoDurationSeconds;
  const story =
    postable && (content.hasEmbed || !content.hasVideo || duration === null || duration <= MAX_STORY_VIDEO_SECONDS);
  const muse =
    content.hasEmbed || (content.hasVideo && duration !== null && duration <= MAX_MUSE_VIDEO_DURATION_SECONDS);
  return { story, muse, feed: postable, circle: postable, people: true };
}

export type ShareChannelCandidate = {
  id: string;
  name: string;
  slug: string;
  type: string;
  visibility: string;
  position: number;
  /** The caller has a ChannelMembership row (a private channel's allow-list). */
  allowListed: boolean;
};

export type ShareChannel = { id: string; name: string; slug: string; isPrivate: boolean };

/**
 * The channels of one Circle the caller may post a share into, in the Circle's own order. Exactly canAccessChannel's
 * posting rule (src/lib/channel-permissions.ts), which createPost applies again: a member of the Circle, a TEXT
 * channel, and the channel PUBLIC, or the caller is on its allow-list, or the caller is the Circle's owner/co-admin
 * (`canModerate`, isCircleAdmin), who may post in every channel including private ones.
 */
export function postableShareChannels(
  channels: readonly ShareChannelCandidate[],
  access: { isMember: boolean; canModerate: boolean },
): ShareChannel[] {
  if (!access.isMember) return [];
  return channels
    .filter((c) => c.type === "TEXT" && (c.visibility === "PUBLIC" || access.canModerate || c.allowListed))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, isPrivate: c.visibility !== "PUBLIC" }));
}

export type ShareCircleRole = "owner" | "coadmin" | "member";

/** The label the picker shows next to a Circle: its creator is the owner, a MODERATOR membership is a co-admin. */
export function shareCircleRole(circle: { createdById: string }, membership: { role: string }, userId: string): ShareCircleRole {
  if (circle.createdById === userId || membership.role === "OWNER") return "owner";
  if (membership.role === "MODERATOR") return "coadmin";
  return "member";
}

/** What the shared file(s) became once uploaded (share-target-gate.tsx's ensureUploaded). */
export type UploadedShareMedia =
  | { mediaType: "NONE"; mediaUrls: [] }
  | { mediaType: "IMAGE"; mediaUrls: string[] }
  | { mediaType: "VIDEO"; mediaUrls: []; videoUrl: string; videoThumbnailUrl?: string; videoDurationSeconds?: number };

export type ShareChatMessage = {
  content: string;
  mediaType: "NONE" | "IMAGE" | "VIDEO";
  mediaUrl?: string;
  mediaThumbnailUrl?: string;
};

/**
 * The chat messages one share is sent as. A message carries one file, so several photos are one message each, in
 * order, the text going with the first (like picking several photos in the chat composer); a video is one message;
 * no file is a text message, or nothing at all when there is no text either (a message needs one or the other).
 */
export function chatMessagesForShare(media: UploadedShareMedia, text: string): ShareChatMessage[] {
  const content = text.trim();
  if (media.mediaType === "IMAGE") {
    return media.mediaUrls.map((url, i) => ({ content: i === 0 ? content : "", mediaType: "IMAGE", mediaUrl: url }));
  }
  if (media.mediaType === "VIDEO") {
    return [{ content, mediaType: "VIDEO", mediaUrl: media.videoUrl, mediaThumbnailUrl: media.videoThumbnailUrl }];
  }
  return content ? [{ content, mediaType: "NONE" }] : [];
}

export type ChatSendOutcome = { sent: number; failed: number } | { error: string; message?: string };

/**
 * One answer for a share sent as several messages (chatMessagesForShare) to the same ticked chats. The first message's
 * error stands for the whole share (nothing reached anyone). After that, a chat counts as sent only as far as every
 * message reached it, so `sent` is the smallest count any message managed and the rest of the chats are failed: a
 * later message that errored or reached fewer chats never turns a partial share into a clean "sent".
 */
export function combineChatSendOutcomes(outcomes: readonly ChatSendOutcome[], chatCount: number): ChatSendOutcome {
  if (outcomes.length === 0) return { error: "unavailable" };
  const first = outcomes[0];
  if ("error" in first) return first;
  let sent = first.sent;
  for (const outcome of outcomes.slice(1)) {
    sent = Math.min(sent, "error" in outcome ? 0 : outcome.sent);
  }
  return { sent, failed: Math.max(0, chatCount - sent) };
}

/**
 * Where createPost's new-device code step continues when a share hits it: the full composer, which has the code
 * entry, with the share handed over (share-target-store.ts). A Home post goes to the caller's profile composer, a
 * Circle post to that Circle's channel, whose composer takes the hand-off the same way.
 */
export function composerHandOffPath(
  target: { kind: "feed"; userId: string } | { kind: "circle"; circleSlug: string; channelSlug: string },
): string {
  if (target.kind === "feed") return `/u/${target.userId}?compose=1`;
  return `/circles/${encodeURIComponent(target.circleSlug)}?channel=${encodeURIComponent(target.channelSlug)}`;
}
