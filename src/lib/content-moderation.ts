import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deleteObject, keyFromPublicUrl } from "@/lib/storage";

export type ModeratableTargetType = "USER" | "POST" | "MESSAGE" | "CIRCLE" | "COLLAB_POST" | "COMMENT";

/**
 * Removes the underlying content behind a report or a flagged-content review,
 * regardless of which of the five content types it is. Returns the author's
 * user id so the caller can write an audit trail entry against them, or null
 * when there's nothing to remove (a USER-targeted report, or content that's
 * already gone).
 */
export async function removeModeratedContent(
  targetType: ModeratableTargetType,
  targetId: string,
): Promise<{ authorId: string } | null> {
  switch (targetType) {
    case "POST": {
      const post = await prisma.post.findUnique({ where: { id: targetId } });
      if (!post) return null;

      await prisma.post.delete({ where: { id: targetId } });

      const mediaUrls = [
        ...post.mediaUrls,
        ...(post.videoUrl ? [post.videoUrl] : []),
        ...(post.videoThumbnailUrl ? [post.videoThumbnailUrl] : []),
      ];
      for (const url of mediaUrls) {
        const key = keyFromPublicUrl(url);
        if (key) await deleteObject(key);
      }

      revalidatePath("/circles", "layout");
      revalidatePath("/home");
      revalidatePath(`/u/${post.authorId}`);
      revalidatePath(`/post/${targetId}`);
      return { authorId: post.authorId };
    }
    case "COMMENT": {
      const comment = await prisma.comment.findUnique({
        where: { id: targetId },
        include: { replies: true },
      });
      if (!comment) return null;

      const removedPublishedCount =
        (comment.moderationStatus === "PUBLISHED" ? 1 : 0) +
        comment.replies.filter((r) => r.moderationStatus === "PUBLISHED").length;

      await prisma.$transaction([
        prisma.comment.delete({ where: { id: targetId } }),
        ...(removedPublishedCount > 0
          ? [
              prisma.post.update({
                where: { id: comment.postId },
                data: { commentCount: { decrement: removedPublishedCount } },
              }),
            ]
          : []),
      ]);

      revalidatePath(`/post/${comment.postId}`);
      return { authorId: comment.authorId };
    }
    case "MESSAGE": {
      const message = await prisma.message.findUnique({ where: { id: targetId } });
      if (!message) return null;

      // Soft-remove, matching how the rest of messaging already treats REMOVED
      // (see messages.ts's `moderationStatus: { not: "REMOVED" }` filter) — a
      // conversation's history shouldn't vanish, just the offending message.
      // A voice/video note's file still needs cleaning up from storage
      // though, same as deleteMessageForEveryone.
      await prisma.message.update({
        where: { id: targetId },
        data: { moderationStatus: "REMOVED" },
      });
      await Promise.all(
        [message.mediaUrl, message.mediaThumbnailUrl].filter((url): url is string => Boolean(url)).map((url) => {
          const key = keyFromPublicUrl(url);
          return key ? deleteObject(key) : Promise.resolve();
        }),
      );

      revalidatePath(`/messages/${message.conversationId}`);
      return { authorId: message.senderId };
    }
    case "CIRCLE": {
      const circle = await prisma.circle.findUnique({ where: { id: targetId } });
      if (!circle) return null;

      await prisma.circle.delete({ where: { id: targetId } });

      revalidatePath("/circles");
      revalidatePath("/admin/circles");
      return { authorId: circle.createdById };
    }
    case "COLLAB_POST": {
      const collabPost = await prisma.collabBoardPost.findUnique({ where: { id: targetId } });
      if (!collabPost) return null;

      // No REMOVED state on the model; CLOSED already drops it from the
      // public listing (`where: { status: "OPEN" }`), same net effect.
      await prisma.collabBoardPost.update({
        where: { id: targetId },
        data: { status: "CLOSED" },
      });

      revalidatePath("/collab");
      return { authorId: collabPost.authorId };
    }
    case "USER":
    default:
      return null;
  }
}
