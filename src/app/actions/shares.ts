"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { shareToCircleSchema } from "@/lib/validations";
import { canAccessChannel } from "@/lib/channel-permissions";
import { canViewPost } from "@/lib/post-visibility";
import { STORY_LIFETIME_MS } from "@/lib/storage";
import { notifySubscribers } from "@/lib/notify-subscribers";
import type { Prisma } from "@/generated/prisma/client";

/** Shared by every share destination: bumps shareCount, records the Share row, and notifies the original author. */
async function applyShareEffect(
  tx: Prisma.TransactionClient,
  post: { id: string; authorId: string },
  userId: string,
) {
  const [, updated] = await Promise.all([
    tx.share.create({ data: { userId, postId: post.id } }),
    tx.post.update({ where: { id: post.id }, data: { shareCount: { increment: 1 } } }),
  ]);

  if (post.authorId !== userId) {
    await tx.notification.create({
      data: { recipientId: post.authorId, actorId: userId, type: "POST_SHARE", postId: post.id },
    });
  }

  return updated.shareCount;
}

export async function recordShare(postId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("share", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" };
  }
  if (!(await canViewPost(postId, user.id))) {
    return { error: "not_found" };
  }

  const shareCount = await prisma.$transaction((tx) => applyShareEffect(tx, post, user.id));

  revalidatePath(`/post/${postId}`);
  revalidatePath(`/u/${post.authorId}`);
  revalidatePath("/home");
  return { error: null, shareCount };
}

/**
 * Posts a quoted share of another post into a Circle's feed — distinct from
 * repost()'s "repost to your own feed" (see Post.sharedPostId in schema.prisma
 * for why this can't reuse repostOfId's unique-per-author constraint).
 */
export async function shareToCircle(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("shareToCircle", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const parsed = shareToCircleSchema.safeParse({
    postId: formData.get("postId"),
    circleId: formData.get("circleId"),
    caption: formData.get("caption") || "",
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { postId, circleId, caption } = parsed.data;

  const target = await prisma.post.findUnique({ where: { id: postId } });
  if (!target || target.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" };
  }

  // Never point sharedPostId at a repost row — always credit/quote the original.
  const rootId = target.repostOfId ?? target.id;
  const root = target.repostOfId
    ? await prisma.post.findUnique({ where: { id: rootId } })
    : target;
  if (!root || root.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" };
  }
  // Without this, a post from a private Circle could be quoted into a
  // different Circle the sharer belongs to, republishing its content across
  // a boundary the original Circle's members never agreed to.
  if (!(await canViewPost(rootId, user.id))) {
    return { error: "not_found" };
  }

  const channel = await prisma.channel.findFirst({
    where: { circleId, type: "TEXT" },
    orderBy: { position: "asc" },
    include: { circle: { select: { id: true, slug: true, createdById: true } } },
  });
  if (!channel) {
    return { error: "not_found" };
  }
  if (!(await canAccessChannel(channel, channel.circle, user))) {
    return { error: "not_a_member" };
  }

  if (caption) {
    const modResult = await moderateText(caption);
    if (!modResult.allowed) {
      return { error: "moderation" };
    }
  }

  const shareCount = await prisma.$transaction(async (tx) => {
    await tx.post.create({
      data: {
        authorId: user.id,
        circleId,
        channelId: channel.id,
        content: caption,
        mediaType: "NONE",
        sharedPostId: rootId,
      },
    });
    return applyShareEffect(tx, root, user.id);
  });

  revalidatePath(`/circles/${channel.circle.slug}`);
  revalidatePath("/home");
  revalidatePath(`/post/${rootId}`);
  return { error: null, shareCount };
}

/**
 * "Share to your story" — reshares an existing post's media as a new Story
 * of your own, the Instagram-style counterpart to shareToCircle above.
 * Unlike createStory (actions/stories.ts), this never uploads anything new:
 * the post's media already passed moderation and its own size check when it
 * was first posted, so this only copies the already-trusted mediaUrl/
 * mediaType/thumbnail across. It deliberately can't reuse createStory
 * itself — that always runs verifyUploadedSize, which requires the R2 key's
 * owner segment to match the *current* user (storage.ts's
 * keyBelongsToOwner), and this media still belongs to whoever posted it.
 */
export async function shareToStory(postId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("storyCreate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const target = await prisma.post.findUnique({ where: { id: postId } });
  if (!target || target.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }

  // Never point sharedPostId at a repost row — always credit/quote the original.
  const rootId = target.repostOfId ?? target.id;
  const root = target.repostOfId ? await prisma.post.findUnique({ where: { id: rootId } }) : target;
  if (!root || root.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }
  if (!(await canViewPost(rootId, user.id))) {
    return { error: "not_found" as const };
  }

  let mediaType: "IMAGE" | "VIDEO";
  let mediaUrl: string;
  let mediaThumbnailUrl: string | undefined;
  if (root.mediaType === "IMAGE" && root.mediaUrls[0]) {
    mediaType = "IMAGE";
    mediaUrl = root.mediaUrls[0];
  } else if (root.mediaType === "VIDEO" && root.videoUrl) {
    mediaType = "VIDEO";
    mediaUrl = root.videoUrl;
    mediaThumbnailUrl = root.videoThumbnailUrl ?? undefined;
  } else {
    // Stories are always a photo/video canvas (StoryMediaType has no NONE/
    // LINK/EMBED/GIF) — a text-only, link, embedded-video, or GIF post has
    // no media that fits it.
    return { error: "unsupported_media" as const };
  }

  const { storyId, shareCount } = await prisma.$transaction(async (tx) => {
    const story = await tx.story.create({
      data: {
        authorId: user.id,
        mediaType,
        mediaUrl,
        mediaThumbnailUrl,
        // Same 200-char cap storySchema (validations.ts) enforces for a
        // normal story caption — this isn't run through that schema itself
        // since mediaUrl here is a known-good copy, not raw user input.
        caption: root.content ? root.content.trim().slice(0, 200) : undefined,
        sharedPostId: rootId,
        expiresAt: new Date(Date.now() + STORY_LIFETIME_MS),
      },
    });
    const count = await applyShareEffect(tx, root, user.id);
    return { storyId: story.id, shareCount: count };
  });

  await notifySubscribers(user.id, "SUBSCRIPTION_STORY", { storyId });

  revalidatePath(`/u/${user.id}`);
  revalidatePath("/home");
  revalidatePath(`/post/${rootId}`);
  return { error: null, shareCount };
}
