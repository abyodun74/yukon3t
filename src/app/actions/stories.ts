"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { storySchema, messageSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateMedia, moderateText } from "@/lib/moderation";
import { MEDIA_LIMITS, STORY_LIFETIME_MS, verifyUploadedSize, deleteOwnedObject, keyFromPublicUrl } from "@/lib/storage";
import { deleteMediaIfUnreferenced } from "@/lib/media-cleanup";
import { isEmojiOnly } from "@/lib/emoji";
import { isBlockedEitherWay } from "@/lib/blocks";
import { isSecretChat } from "@/lib/e2ee/secret-chat";
import { sendPushToUser } from "@/lib/push";
import { notifySubscribers } from "@/lib/notify-subscribers";
import { parseVideoEmbedUrl, type EmbedProvider } from "@/lib/video-embed";

/**
 * Groups active stories from the caller's accepted connections (plus their
 * own, if any) into one row per author, for the /home story tray — same
 * accepted-connection-ids shape already used by createGroupChat/replyToStory.
 * Sort: caller's own row first, then any author with an unseen story
 * (most-recently-posted first), then fully-seen authors.
 */
export async function getConnectionsStories() {
  const user = await requireVerifiedUser();

  const connections = await prisma.connection.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: user.id }, { targetId: user.id }],
    },
    select: { requesterId: true, targetId: true },
  });
  const connectionIds = connections.map((c) => (c.requesterId === user.id ? c.targetId : c.requesterId));

  const stories = await prisma.story.findMany({
    where: {
      authorId: { in: [...connectionIds, user.id] },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
      views: { where: { viewerId: user.id }, select: { id: true } },
      _count: { select: { views: true } },
    },
  });

  const byAuthor = new Map<
    string,
    {
      authorId: string;
      authorName: string;
      authorAvatarUrl: string | null;
      isMe: boolean;
      hasUnseen: boolean;
      latestAt: Date;
      stories: {
        id: string;
        mediaType: "IMAGE" | "VIDEO" | "EMBED";
        mediaUrl: string | null;
        mediaThumbnailUrl: string | null;
        embedProvider: EmbedProvider | null;
        embedId: string | null;
        caption: string | null;
        createdAt: Date;
        viewCount: number;
        sharedPostId: string | null;
      }[];
    }
  >();

  for (const story of stories) {
    const isMe = story.authorId === user.id;
    let group = byAuthor.get(story.authorId);
    if (!group) {
      group = {
        authorId: story.author.id,
        authorName: story.author.name ?? "Unknown",
        authorAvatarUrl: story.author.avatarUrl,
        isMe,
        hasUnseen: false,
        latestAt: story.createdAt,
        stories: [],
      };
      byAuthor.set(story.authorId, group);
    }
    // The author never counts their own story as "unseen" — viewStory
    // never records a self-view either, so this must be checked explicitly.
    if (!isMe && story.views.length === 0) group.hasUnseen = true;
    if (story.createdAt > group.latestAt) group.latestAt = story.createdAt;
    group.stories.push({
      id: story.id,
      mediaType: story.mediaType,
      mediaUrl: story.mediaUrl,
      mediaThumbnailUrl: story.mediaThumbnailUrl,
      embedProvider: story.embedProvider,
      embedId: story.embedId,
      caption: story.caption,
      createdAt: story.createdAt,
      viewCount: story._count.views,
      sharedPostId: story.sharedPostId,
    });
  }

  const groups = [...byAuthor.values()].sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return b.latestAt.getTime() - a.latestAt.getTime();
  });

  return { groups };
}

export async function createStory(formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = storySchema.safeParse({
    mediaType: formData.get("mediaType"),
    mediaUrl: formData.get("mediaUrl") || undefined,
    mediaThumbnailUrl: formData.get("mediaThumbnailUrl") || undefined,
    embedUrl: formData.get("embedUrl") || undefined,
    caption: formData.get("caption") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { mediaType, mediaUrl, mediaThumbnailUrl, embedUrl, caption } = parsed.data;

  // EMBED carries no upload of ours at all — a link another app shared
  // (Instagram/TikTok/etc. only handing over a link, no real file; see
  // ShareReceiverPlugin.java) resolved into the source platform's own
  // player instead. Same "moderated by the source, not us" trust boundary
  // createPost's own EMBED branch already uses for the embedded video
  // itself — but unlike Post, Story has no moderationStatus/soft-flag
  // state at all (every other branch below already just rejects outright
  // on a moderateMedia failure), so a flagged caption rejects here too,
  // consistently, rather than introducing a hidden-pending-review state
  // this model was never built to represent.
  if (mediaType === "EMBED") {
    const embed = embedUrl ? parseVideoEmbedUrl(embedUrl) : null;
    if (!embed) {
      return { error: "invalid" as const };
    }
    const modResult = await moderateText(caption);
    if (!modResult.allowed) {
      return { error: "moderation" as const, categories: modResult.flaggedCategories };
    }
    const story = await prisma.story.create({
      data: {
        authorId: user.id,
        mediaType: "EMBED",
        embedProvider: embed.provider,
        embedId: embed.id,
        caption: caption || undefined,
        expiresAt: new Date(Date.now() + STORY_LIFETIME_MS),
      },
    });
    await notifySubscribers(user.id, "SUBSCRIPTION_STORY", { storyId: story.id });
    revalidatePath(`/u/${user.id}`);
    revalidatePath("/home");
    return { error: null };
  }

  const uploadedUrls = [mediaUrl!, ...(mediaType === "VIDEO" && mediaThumbnailUrl ? [mediaThumbnailUrl] : [])];
  async function cleanupUploads() {
    await Promise.all(
      uploadedUrls.map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteOwnedObject(key, user.id) : Promise.resolve();
      }),
    );
  }

  const key = keyFromPublicUrl(mediaUrl!);
  const maxBytes = mediaType === "IMAGE" ? MEDIA_LIMITS["story-image"] : MEDIA_LIMITS["story-video"];
  const sizeOk = key && (await verifyUploadedSize({ key, maxBytes, ownerId: user.id }));
  if (!sizeOk) {
    await cleanupUploads();
    return { error: "too_large" as const };
  }

  const modResult = await moderateMedia({
    text: caption,
    imageUrls: mediaType === "IMAGE" ? [mediaUrl!] : [],
    thumbnailUrl: mediaType === "VIDEO" ? mediaThumbnailUrl : undefined,
  });
  if (!modResult.allowed) {
    await cleanupUploads();
    return { error: "moderation" as const, categories: modResult.flaggedCategories };
  }

  let story;
  try {
    story = await prisma.story.create({
      data: {
        authorId: user.id,
        mediaType,
        mediaUrl,
        mediaThumbnailUrl: mediaType === "VIDEO" ? mediaThumbnailUrl : undefined,
        caption: caption || undefined,
        expiresAt: new Date(Date.now() + STORY_LIFETIME_MS),
      },
    });
  } catch (err) {
    // The upload already succeeded by this point (media is sitting in R2) —
    // an uncaught exception here would propagate to the client as a thrown
    // promise rejection, which the client's generic catch-all then
    // misreports as "couldn't reach the server," hiding that the real
    // failure was this DB write, not the upload. Surface it as its own
    // distinct error instead, and don't orphan the just-uploaded media.
    console.error("[createStory] failed to create story row after successful upload", err);
    await cleanupUploads();
    return { error: "server_error" as const };
  }

  // Reaches every accepted connection already, not just declared
  // subscribers — accepting a connection request auto-subscribes both
  // sides (see respondToConnectionRequest in actions/connections.ts), and
  // this fires unconditionally regardless of visibility (stories have none;
  // they're always connections-only via getStoriesForTray's own query), so
  // there's no separate connections-only case to add here the way
  // createPost's CONNECTIONS_ONLY branch needs.
  await notifySubscribers(user.id, "SUBSCRIPTION_STORY", { storyId: story.id });

  // /home's story tray (the "Your story" ring + its "add more" badge, see
  // story-tray.tsx) reads hasStories off this same data — without this,
  // that tray only picks up a freshly-posted story via the client's own
  // router.refresh() in this browser tab right now, not for a reload, a new
  // tab, or the native app's WebView navigating there fresh.
  revalidatePath(`/u/${user.id}`);
  revalidatePath("/home");
  return { error: null };
}

/** Author or admin: removes a story before its natural 24h expiry. */
export async function deleteStory(id: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({ where: { id } });
  if (!story) {
    return { error: "not_found" as const };
  }
  if (story.authorId !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  await prisma.story.delete({ where: { id } });
  // A Story can share its file with the post/Muse it came from — only delete it once nothing else uses it.
  await deleteMediaIfUnreferenced([story.mediaUrl, story.mediaThumbnailUrl]);

  revalidatePath(`/u/${story.authorId}`);
  revalidatePath("/home");
  return { error: null };
}

/**
 * Records that the caller watched a story — a no-op (not an error) for the
 * author's own story, same reasoning a like/RSVP wouldn't count from its
 * own author: "who's viewed my story" should never include yourself.
 */
export async function viewStory(storyId: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: { authorId: true, expiresAt: true },
  });
  if (!story || story.expiresAt < new Date()) {
    return { error: "not_found" as const };
  }
  if (story.authorId === user.id) {
    return { error: null };
  }

  await prisma.storyView.upsert({
    where: { storyId_viewerId: { storyId, viewerId: user.id } },
    create: { storyId, viewerId: user.id },
    update: {},
  });

  return { error: null };
}

// Same "cap it, don't build full pagination yet" tradeoff as
// getPostLikers/getPostComments' own limits — a viral story only ever
// shows its most recent VIEWERS_LIMIT viewers to its author, rather than
// an unbounded fetch growing with view count.
const STORY_VIEWERS_LIMIT = 200;

/** Author-only: who has seen this story so far, and what they reacted with (if anything). */
export async function getStoryViewers(storyId: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({ where: { id: storyId }, select: { authorId: true } });
  if (!story || story.authorId !== user.id) {
    return { viewers: [], totalCount: 0 };
  }

  const [views, totalCount] = await Promise.all([
    prisma.storyView.findMany({
      where: { storyId },
      orderBy: { viewedAt: "desc" },
      take: STORY_VIEWERS_LIMIT,
      include: { viewer: { select: { id: true, name: true } } },
    }),
    prisma.storyView.count({ where: { storyId } }),
  ]);
  // Scoped to just the (already-capped) returned viewers, not every reaction
  // on the story — same reasoning as capping views above.
  const reactions = await prisma.storyReaction.findMany({
    where: { storyId, userId: { in: views.map((v) => v.viewerId) } },
    select: { userId: true, emoji: true },
  });
  const reactionByViewerId = new Map(reactions.map((r) => [r.userId, r.emoji]));

  return {
    viewers: views.map((v) => ({
      id: v.viewer.id,
      name: v.viewer.name ?? "Unknown",
      viewedAt: v.viewedAt,
      reaction: reactionByViewerId.get(v.viewer.id) ?? null,
    })),
    totalCount,
  };
}

/** Emoji counts for a story plus the caller's own reaction — visible to anyone who can see the story, unlike getStoryViewers' per-person breakdown. */
async function reactionSummary(storyId: string, viewerId: string) {
  const reactions = await prisma.storyReaction.findMany({
    where: { storyId },
    select: { emoji: true, userId: true },
  });

  const counts = new Map<string, number>();
  let mine: string | null = null;
  for (const r of reactions) {
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    if (r.userId === viewerId) mine = r.emoji;
  }

  return { summary: [...counts.entries()].map(([emoji, count]) => ({ emoji, count })), mine };
}

export async function getStoryReactionSummary(storyId: string) {
  const user = await requireVerifiedUser();
  const result = await reactionSummary(storyId, user.id);
  return { error: null, ...result };
}

/**
 * Toggles the caller's reaction on a story: picking the emoji they already
 * reacted with removes it, picking a different one replaces it — same
 * one-active-reaction-per-user shape as toggleMessageReaction.
 */
export async function toggleStoryReaction(storyId: string, emoji: string) {
  const user = await requireVerifiedUser();

  if (!isEmojiOnly(emoji, 1)) {
    return { error: "invalid" as const };
  }

  const story = await prisma.story.findUnique({ where: { id: storyId }, select: { expiresAt: true } });
  if (!story || story.expiresAt < new Date()) {
    return { error: "not_found" as const };
  }

  const existing = await prisma.storyReaction.findUnique({
    where: { storyId_userId: { storyId, userId: user.id } },
  });

  if (existing?.emoji === emoji) {
    await prisma.storyReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.storyReaction.upsert({
      where: { storyId_userId: { storyId, userId: user.id } },
      create: { storyId, userId: user.id, emoji },
      update: { emoji },
    });
  }

  const result = await reactionSummary(storyId, user.id);
  return { error: null, ...result };
}

/**
 * Replies to a story as a DM to its author, reusing the app's existing
 * connection-gated messaging model rather than introducing a new
 * message-request flow for strangers: a 1:1 Conversation is only ever
 * missing here if there's no accepted connection either (see
 * respondToConnection, which always creates one the moment a connection is
 * accepted), so "not connected" and "no conversation" collapse to the same
 * outcome.
 */
export async function replyToStory(storyId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story || story.expiresAt < new Date()) {
    return { error: "not_found" as const };
  }
  if (story.authorId === user.id) {
    return { error: "forbidden" as const };
  }

  if (await isBlockedEitherWay(user.id, story.authorId)) {
    return { error: "blocked" as const };
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      AND: [
        { members: { some: { userId: user.id } } },
        { members: { some: { userId: story.authorId } } },
      ],
    },
    select: { id: true, isGroup: true, members: { select: { e2eeEnabledAt: true } } },
  });
  if (!conversation) {
    return { error: "not_connected" as const };
  }
  // This writes the reply as readable text straight into the DM. In a secret
  // chat (end-to-end encrypted) that would put plaintext into a thread both
  // people believe is encrypted, and the server can't encrypt it for them —
  // so it's declined there; they can send the reply from the chat itself.
  if (isSecretChat(conversation)) {
    return { error: "secret_chat" as const };
  }

  const allowed = await checkRateLimit("messageSend", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = messageSchema.safeParse({
    conversationId: conversation.id,
    content: formData.get("content"),
  });
  if (!parsed.success || !parsed.data.content) {
    return { error: "invalid" as const };
  }

  const modResult = await moderateText(parsed.data.content);
  const moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: user.id,
      content: parsed.data.content,
      moderationStatus,
      storyId: story.id,
    },
  });

  await sendPushToUser(story.authorId, {
    title: user.name ?? "Story reply",
    body: `Replied to your story: ${parsed.data.content.slice(0, 120)}`,
    url: `/messages/${conversation.id}`,
  });

  revalidatePath(`/messages/${conversation.id}`);
  return { error: null, conversationId: conversation.id };
}

/**
 * Every conversation (DM or group) the caller belongs to, as share targets
 * for shareStoryToConversation below — same shape MultiSelect's options
 * expect. A DM's label is the other member's name; a group's is its name.
 * Excludes a DM with someone now blocked either way, same trust boundary
 * replyToStory enforces for its own single fixed recipient.
 */
export async function getShareableConversations() {
  const user = await requireVerifiedUser();

  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId: user.id } } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      isGroup: true,
      name: true,
      members: { select: { userId: true, user: { select: { id: true, name: true } } } },
    },
  });

  const targets: { value: string; label: string }[] = [];
  for (const conv of conversations) {
    if (conv.isGroup) {
      targets.push({ value: conv.id, label: conv.name ?? "Group" });
      continue;
    }
    const other = conv.members.find((m) => m.userId !== user.id)?.user;
    if (!other) continue;
    if (await isBlockedEitherWay(user.id, other.id)) continue;
    targets.push({ value: conv.id, label: other.name ?? "Unknown" });
  }
  return { conversations: targets };
}

/**
 * Fetches one story for the "open the actual story" tap target on a shared-
 * story message in chat-thread.tsx — that preview only ever stored a static
 * thumbnail + caption on the Message row itself (a snapshot at share time),
 * with no way to see the story full-screen the way the story tray shows it
 * (reactions, viewer's own quick-react bar, etc.). Same visibility rule as
 * every other story read here: still unexpired, and not blocked either way
 * with the author — a forwarded message can otherwise outlive the sender's
 * own connection to whoever it reached.
 */
export async function getStory(storyId: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
      _count: { select: { views: true } },
    },
  });
  if (!story || story.expiresAt < new Date()) {
    return { error: "not_found" as const, story: null };
  }
  if (await isBlockedEitherWay(user.id, story.authorId)) {
    return { error: "not_found" as const, story: null };
  }

  return {
    error: null,
    story: {
      id: story.id,
      mediaType: story.mediaType,
      mediaUrl: story.mediaUrl,
      mediaThumbnailUrl: story.mediaThumbnailUrl,
      embedProvider: story.embedProvider,
      embedId: story.embedId,
      caption: story.caption,
      createdAt: story.createdAt,
      viewCount: story._count.views,
      sharedPostId: story.sharedPostId,
    },
    authorId: story.author.id,
    authorName: story.author.name ?? "Unknown",
    authorAvatarUrl: story.author.avatarUrl,
    isOwner: story.authorId === user.id,
  };
}

/**
 * Shares a story into a conversation the caller already belongs to (unlike
 * replyToStory, which always targets a DM with the story's author
 * specifically) — the story-viewer's own "Share" action, letting someone
 * forward a story to any of their DMs or groups. Reuses Message.storyId,
 * the exact same field replyToStory sets, so the recipient sees the same
 * inline story preview in chat-thread.tsx either way.
 */
export async function shareStoryToConversation(storyId: string, conversationId: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story || story.expiresAt < new Date()) {
    return { error: "not_found" as const };
  }
  if (await isBlockedEitherWay(user.id, story.authorId)) {
    return { error: "blocked" as const };
  }

  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!membership) {
    return { error: "not_found" as const };
  }

  const allowed = await checkRateLimit("messageSend", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  await prisma.message.create({
    data: {
      conversationId,
      senderId: user.id,
      content: "Shared a story",
      storyId: story.id,
      isForwardedStory: true,
    },
  });

  revalidatePath(`/messages/${conversationId}`);
  return { error: null };
}

const STORY_COMMENTS_LIMIT = 50;

/**
 * A story's public comment thread — distinct from replyToStory above, which
 * is a private DM and never lands here. Same minimal access check every
 * other story action here uses (not expired; blocked either way excluded)
 * rather than a strict "must be an accepted connection" gate — a story's
 * real privacy boundary is that its id is only ever surfaced to connected
 * viewers in the first place (getConnectionsStories), not an
 * authorization check on the id itself, consistent with viewStory/
 * toggleStoryReaction's own equally minimal checks.
 */
export async function getStoryComments(storyId: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({ where: { id: storyId }, select: { authorId: true, expiresAt: true } });
  if (!story || story.expiresAt < new Date()) {
    return { error: "not_found" as const, comments: [] };
  }
  if (await isBlockedEitherWay(user.id, story.authorId)) {
    return { error: "not_found" as const, comments: [] };
  }

  const comments = await prisma.storyComment.findMany({
    where: { storyId, moderationStatus: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    take: STORY_COMMENTS_LIMIT,
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return { error: null, comments };
}

export async function createStoryComment(storyId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("comment", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story || story.expiresAt < new Date()) {
    return { error: "not_found" as const };
  }
  if (await isBlockedEitherWay(user.id, story.authorId)) {
    return { error: "not_found" as const };
  }

  const content = String(formData.get("content") ?? "").trim();
  if (!content || content.length > 1000) {
    return { error: "invalid" as const };
  }

  const modResult = await moderateText(content);
  const comment = await prisma.storyComment.create({
    data: {
      storyId,
      authorId: user.id,
      content,
      moderationStatus: modResult.allowed ? "PUBLISHED" : "FLAGGED",
    },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  if (modResult.allowed && story.authorId !== user.id) {
    await prisma.notification.create({
      data: {
        recipientId: story.authorId,
        actorId: user.id,
        type: "STORY_COMMENT",
        storyId: story.id,
      },
    });
  }

  return { error: null, comment };
}

/** Author of the comment, the story's own author, or an admin can remove a story comment — same three-way authorization shape as deleteMessageForEveryone/deleteComment. */
export async function deleteStoryComment(commentId: string) {
  const user = await requireVerifiedUser();

  const comment = await prisma.storyComment.findUnique({
    where: { id: commentId },
    include: { story: { select: { authorId: true } } },
  });
  if (!comment) {
    return { error: "not_found" as const };
  }
  if (comment.authorId !== user.id && comment.story.authorId !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  await prisma.storyComment.delete({ where: { id: commentId } });
  return { error: null };
}
