"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { shareToCircleSchema } from "@/lib/validations";
import { canAccessChannel } from "@/lib/channel-permissions";
import { canViewPost } from "@/lib/post-visibility";
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
