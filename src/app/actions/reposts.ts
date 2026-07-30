"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { repostSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";

export async function repost(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("repost", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const parsed = repostSchema.safeParse({
    postId: formData.get("postId"),
    caption: formData.get("caption") || "",
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { postId, caption } = parsed.data;

  const target = await prisma.post.findUnique({ where: { id: postId } });
  if (!target || target.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" };
  }

  // Never chain reposts — always credit the original.
  const rootId = target.repostOfId ?? target.id;
  const root = target.repostOfId
    ? await prisma.post.findUnique({ where: { id: rootId } })
    : target;
  if (!root || root.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" };
  }

  if (root.authorId === user.id) {
    return { error: "self_repost" };
  }

  const existing = await prisma.post.findFirst({
    where: { authorId: user.id, repostOfId: rootId },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.post.delete({ where: { id: existing.id } }),
      prisma.post.update({
        where: { id: rootId },
        data: { repostCount: { decrement: 1 } },
      }),
    ]);
    revalidatePath("/home");
    revalidatePath(`/u/${user.id}`);
    revalidatePath(`/u/${root.authorId}`);
    revalidatePath(`/post/${rootId}`);
    return { error: null, reposted: false };
  }

  if (caption) {
    const modResult = await moderateText(caption);
    if (!modResult.allowed) {
      return { error: "moderation" };
    }
  }

  await prisma.$transaction([
    prisma.post.create({
      data: {
        authorId: user.id,
        content: caption,
        mediaType: "NONE",
        repostOfId: rootId,
      },
    }),
    prisma.post.update({
      where: { id: rootId },
      data: { repostCount: { increment: 1 } },
    }),
  ]);

  await prisma.notification.create({
    data: {
      recipientId: root.authorId,
      actorId: user.id,
      type: "POST_REPOST",
      postId: rootId,
    },
  });

  revalidatePath("/home");
  revalidatePath(`/u/${user.id}`);
  revalidatePath(`/u/${root.authorId}`);
  revalidatePath(`/post/${rootId}`);
  return { error: null, reposted: true };
}
