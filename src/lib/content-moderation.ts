import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { deleteObject, keyFromPublicUrl } from "@/lib/storage";

export type ModeratableTargetType = "USER" | "POST" | "MESSAGE" | "CIRCLE" | "COLLAB_POST" | "COMMENT";

/**
 * Removes the underlying content behind a report or a flagged-content review,
 * regardless of which of the five content types it is. Returns the author's
 * user id (so the caller can write an audit trail entry against them in the
 * same transaction) plus any R2 keys to clean up afterward, or null when
 * there's nothing to remove (a USER-targeted report, or content that's
 * already gone).
 *
 * Takes a transaction client so the caller can run the content mutation and
 * its AuditLog entry as one atomic unit — a crash between "content removed"
 * and "audit row written" would otherwise leave enforcement with no
 * explainable record, undermining the whole point of the audit trail. R2
 * cleanup is deliberately NOT done here: it can't be part of the Postgres
 * transaction anyway, and running it before the transaction commits risks
 * deleting real media for a removal that then rolls back.
 */
export async function removeModeratedContent(
  targetType: ModeratableTargetType,
  targetId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<{ authorId: string; mediaKeysToDelete: string[] } | null> {
  switch (targetType) {
    case "POST": {
      const post = await tx.post.findUnique({ where: { id: targetId } });
      if (!post) return null;

      await tx.post.delete({ where: { id: targetId } });

      const mediaUrls = [
        ...post.mediaUrls,
        ...(post.videoUrl ? [post.videoUrl] : []),
        ...(post.videoThumbnailUrl ? [post.videoThumbnailUrl] : []),
      ];
      const mediaKeysToDelete = mediaUrls
        .map((url) => keyFromPublicUrl(url))
        .filter((key): key is string => Boolean(key));

      revalidatePath("/circles", "layout");
      revalidatePath("/home");
      revalidatePath(`/u/${post.authorId}`);
      revalidatePath(`/post/${targetId}`);
      return { authorId: post.authorId, mediaKeysToDelete };
    }
    case "COMMENT": {
      const comment = await tx.comment.findUnique({
        where: { id: targetId },
        include: { replies: true },
      });
      if (!comment) return null;

      const removedPublishedCount =
        (comment.moderationStatus === "PUBLISHED" ? 1 : 0) +
        comment.replies.filter((r) => r.moderationStatus === "PUBLISHED").length;

      await tx.comment.delete({ where: { id: targetId } });
      if (removedPublishedCount > 0) {
        await tx.post.update({
          where: { id: comment.postId },
          data: { commentCount: { decrement: removedPublishedCount } },
        });
      }

      revalidatePath(`/post/${comment.postId}`);
      return { authorId: comment.authorId, mediaKeysToDelete: [] };
    }
    case "MESSAGE": {
      const message = await tx.message.findUnique({ where: { id: targetId } });
      if (!message) return null;

      // Soft-remove, matching how the rest of messaging already treats REMOVED
      // (see messages.ts's `moderationStatus: { not: "REMOVED" }` filter) — a
      // conversation's history shouldn't vanish, just the offending message.
      // A voice/video note's file still needs cleaning up from storage
      // though, same as deleteMessageForEveryone.
      await tx.message.update({
        where: { id: targetId },
        data: { moderationStatus: "REMOVED" },
      });
      const mediaKeysToDelete = [message.mediaUrl, message.mediaThumbnailUrl]
        .filter((url): url is string => Boolean(url))
        .map((url) => keyFromPublicUrl(url))
        .filter((key): key is string => Boolean(key));

      revalidatePath(`/messages/${message.conversationId}`);
      return { authorId: message.senderId, mediaKeysToDelete };
    }
    case "CIRCLE": {
      const circle = await tx.circle.findUnique({ where: { id: targetId } });
      if (!circle) return null;

      await tx.circle.delete({ where: { id: targetId } });

      revalidatePath("/circles");
      revalidatePath("/admin/circles");
      return { authorId: circle.createdById, mediaKeysToDelete: [] };
    }
    case "COLLAB_POST": {
      const collabPost = await tx.collabBoardPost.findUnique({ where: { id: targetId } });
      if (!collabPost) return null;

      // No REMOVED state on the model; CLOSED already drops it from the
      // public listing (`where: { status: "OPEN" }`), same net effect.
      await tx.collabBoardPost.update({
        where: { id: targetId },
        data: { status: "CLOSED" },
      });

      revalidatePath("/collab");
      return { authorId: collabPost.authorId, mediaKeysToDelete: [] };
    }
    case "USER":
    default:
      return null;
  }
}

/** Runs the R2 cleanup deferred by removeModeratedContent — call only after the transaction that used it has committed. */
export async function cleanUpModeratedMedia(mediaKeysToDelete: string[]) {
  await Promise.all(mediaKeysToDelete.map((key) => deleteObject(key)));
}
