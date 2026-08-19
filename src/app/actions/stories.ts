"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { storySchema, messageSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateMedia, moderateText } from "@/lib/moderation";
import { MEDIA_LIMITS, STORY_LIFETIME_MS, verifyUploadedSize, deleteObject, deleteOwnedObject, keyFromPublicUrl } from "@/lib/storage";
import { isEmojiOnly } from "@/lib/emoji";
import { isBlockedEitherWay } from "@/lib/blocks";
import { sendPushToUser } from "@/lib/push";

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
        mediaType: "IMAGE" | "VIDEO";
        mediaUrl: string;
        mediaThumbnailUrl: string | null;
        caption: string | null;
        createdAt: Date;
        viewCount: number;
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
      caption: story.caption,
      createdAt: story.createdAt,
      viewCount: story._count.views,
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

  const allowed = await checkRateLimit("storyCreate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = storySchema.safeParse({
    mediaType: formData.get("mediaType"),
    mediaUrl: formData.get("mediaUrl"),
    mediaThumbnailUrl: formData.get("mediaThumbnailUrl") || undefined,
    caption: formData.get("caption") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { mediaType, mediaUrl, mediaThumbnailUrl, caption } = parsed.data;

  const uploadedUrls = [mediaUrl, ...(mediaType === "VIDEO" && mediaThumbnailUrl ? [mediaThumbnailUrl] : [])];
  async function cleanupUploads() {
    await Promise.all(
      uploadedUrls.map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteOwnedObject(key, user.id) : Promise.resolve();
      }),
    );
  }

  const key = keyFromPublicUrl(mediaUrl);
  const maxBytes = mediaType === "IMAGE" ? MEDIA_LIMITS["story-image"] : MEDIA_LIMITS["story-video"];
  const sizeOk = key && (await verifyUploadedSize({ key, maxBytes, ownerId: user.id }));
  if (!sizeOk) {
    await cleanupUploads();
    return { error: "too_large" as const };
  }

  const modResult = await moderateMedia({
    text: caption,
    imageUrls: mediaType === "IMAGE" ? [mediaUrl] : [],
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

  const subscribers = await prisma.subscription.findMany({
    where: { subscribedToId: user.id },
    select: { id: true, subscriberId: true },
  });
  if (subscribers.length > 0) {
    await prisma.notification.createMany({
      data: subscribers.map((s) => ({
        recipientId: s.subscriberId,
        actorId: user.id,
        type: "SUBSCRIPTION_STORY" as const,
        storyId: story.id,
        subscriptionId: s.id,
      })),
    });
  }

  revalidatePath(`/u/${user.id}`);
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
  await Promise.all(
    [story.mediaUrl, story.mediaThumbnailUrl]
      .filter((url): url is string => Boolean(url))
      .map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteObject(key) : Promise.resolve();
      }),
  );

  revalidatePath(`/u/${story.authorId}`);
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

/** Author-only: who has seen this story so far, and what they reacted with (if anything). */
export async function getStoryViewers(storyId: string) {
  const user = await requireVerifiedUser();

  const story = await prisma.story.findUnique({ where: { id: storyId }, select: { authorId: true } });
  if (!story || story.authorId !== user.id) {
    return { viewers: [] };
  }

  const [views, reactions] = await Promise.all([
    prisma.storyView.findMany({
      where: { storyId },
      orderBy: { viewedAt: "desc" },
      include: { viewer: { select: { id: true, name: true } } },
    }),
    prisma.storyReaction.findMany({ where: { storyId }, select: { userId: true, emoji: true } }),
  ]);
  const reactionByViewerId = new Map(reactions.map((r) => [r.userId, r.emoji]));

  return {
    viewers: views.map((v) => ({
      id: v.viewer.id,
      name: v.viewer.name ?? "Unknown",
      viewedAt: v.viewedAt,
      reaction: reactionByViewerId.get(v.viewer.id) ?? null,
    })),
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
    select: { id: true },
  });
  if (!conversation) {
    return { error: "not_connected" as const };
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
