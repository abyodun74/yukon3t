"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { shareToCircleSchema } from "@/lib/validations";
import { canAccessChannel } from "@/lib/channel-permissions";
import { canViewPost } from "@/lib/post-visibility";
import {
  STORY_LIFETIME_MS,
  HIVE_VIDEO_MODERATION_MAX_SECONDS,
  MAX_MUSE_VIDEO_DURATION_SECONDS,
} from "@/lib/storage";
import { isStreamConfigured, createStreamCopy } from "@/lib/cloudflare-stream";
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
  // Same reasoning as repost()'s equivalent check — quoting into a Circle
  // republishes the root's full content to that Circle's membership, which
  // is never guaranteed to line up with who a Friends-only/Private root's
  // own author allowed.
  if (root.visibility !== "PUBLIC") {
    return { error: "not_shareable" };
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

/**
 * Shares a video Post's video onto the public /muse feed, as a new Muse
 * crediting the original (sharedPostId) — same "any viewer can reshare,
 * crediting the source" shape as shareToStory above, just targeting Muse
 * instead of Story. Only VIDEO posts qualify (Muse has no image/text
 * variant at all), and only up to MAX_MUSE_VIDEO_DURATION_SECONDS — a Post
 * video can run up to an hour, far past what Muse allows.
 */
export async function shareToMuse(postId: string) {
  const user = await requireVerifiedUser();

  // Reuses postCreate's bucket, not share's — this creates a new Muse row
  // (real content, same as createMuse itself), not just a lightweight share
  // log entry.
  const allowed = await checkRateLimit("postCreate", user.id);
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
  // Muse is an unconditionally public feed — same reasoning as repost()'s
  // and shareToCircle()'s equivalent check, just with no audience boundary
  // at all on the other side, so this matters even more here.
  if (root.visibility !== "PUBLIC") {
    return { error: "not_shareable" as const };
  }

  if (root.mediaType !== "VIDEO" || !root.videoUrl || !root.videoDurationSeconds) {
    return { error: "unsupported_media" as const };
  }
  if (root.videoDurationSeconds > MAX_MUSE_VIDEO_DURATION_SECONDS) {
    return { error: "too_long" as const };
  }

  // Same long-form-review fork createMuse itself uses — a shared video over
  // Hive's 60s scan limit needs the Cloudflare Stream pipeline, exactly like
  // a freshly-uploaded one. Every shared Muse gets its own independent
  // moderation pass here (videoModeratedAt/moderationStatus start fresh,
  // not inherited from the source post) — defense in depth, and cheap since
  // it's the same pipeline that already ran once.
  const videoNeedsManualReview = root.videoDurationSeconds > HIVE_VIDEO_MODERATION_MAX_SECONDS;
  const streamUid =
    videoNeedsManualReview && isStreamConfigured() ? await createStreamCopy(root.videoUrl) : null;

  const { museId, shareCount } = await prisma.$transaction(async (tx) => {
    const muse = await tx.muse.create({
      data: {
        authorId: user.id,
        videoUrl: root.videoUrl!,
        videoThumbnailUrl: root.videoThumbnailUrl,
        videoDurationSeconds: root.videoDurationSeconds!,
        // Same 200-char cap museSchema (validations.ts) enforces for a
        // normal caption — this isn't run through that schema itself since
        // videoUrl here is a known-good copy, not raw user input.
        caption: root.content ? root.content.trim().slice(0, 200) : undefined,
        sharedPostId: rootId,
        moderationStatus: videoNeedsManualReview ? "FLAGGED" : "PUBLISHED",
        videoModeratedAt: videoNeedsManualReview ? new Date() : undefined,
        videoStreamUid: streamUid ?? undefined,
      },
    });
    const count = await applyShareEffect(tx, root, user.id);
    return { museId: muse.id, shareCount: count };
  });

  revalidatePath("/muse");
  revalidatePath(`/u/${user.id}`);
  revalidatePath("/home");
  revalidatePath(`/post/${rootId}`);
  return { error: null, museId, shareCount };
}
