import { revalidatePath } from "next/cache";
import { prisma, type TransactionClient } from "@/lib/prisma";
import { deleteMediaIfUnreferenced } from "@/lib/media-cleanup";
import { countPublishedInThread } from "@/lib/comment-count";

export type ModeratableTargetType = "USER" | "POST" | "MESSAGE" | "CIRCLE" | "COLLAB_POST" | "COMMENT" | "MUSE";

/**
 * Removes the underlying content behind a report or a flagged-content review,
 * regardless of which of the five content types it is. Returns the author's
 * user id (so the caller can write an audit trail entry against them in the
 * same transaction) plus the media URLs to clean up afterward, or null when
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
  tx: TransactionClient = prisma,
): Promise<{ authorId: string; mediaUrlsToDelete: string[] } | null> {
  switch (targetType) {
    case "POST": {
      const post = await tx.post.findUnique({ where: { id: targetId } });
      if (!post) return null;

      // A multi-photo post is one Post row per photo (albumId); removing it
      // removes every photo, as deletePost does — otherwise the rest of a
      // held album would stay behind, hidden, with nobody able to reach it.
      const siblings = post.albumId
        ? await tx.post.findMany({
            where: { albumId: post.albumId, id: { not: targetId } },
            select: { id: true, mediaUrls: true },
          })
        : [];
      if (siblings.length > 0) {
        await tx.post.deleteMany({ where: { id: { in: siblings.map((s) => s.id) } } });
      }
      await tx.post.delete({ where: { id: targetId } });

      const mediaUrlsToDelete = [
        ...post.mediaUrls,
        ...siblings.flatMap((s) => s.mediaUrls),
        ...(post.videoUrl ? [post.videoUrl] : []),
        ...(post.videoThumbnailUrl ? [post.videoThumbnailUrl] : []),
      ];

      revalidatePath("/circles", "layout");
      revalidatePath("/home");
      revalidatePath(`/u/${post.authorId}`);
      revalidatePath(`/post/${targetId}`);
      return { authorId: post.authorId, mediaUrlsToDelete };
    }
    case "COMMENT": {
      const comment = await tx.comment.findUnique({ where: { id: targetId } });
      if (!comment) return null;

      const removedPublishedCount = await countPublishedInThread(tx, targetId);

      await tx.comment.delete({ where: { id: targetId } });
      if (removedPublishedCount > 0) {
        await tx.post.update({
          where: { id: comment.postId },
          data: { commentCount: { decrement: removedPublishedCount } },
        });
      }

      // audioUrl has no equivalent cleanup here historically (see
      // deleteComment's own comment on that), but videoUrl/videoThumbnailUrl
      // are real uploads to this app's bucket just like a post's video —
      // left uncleaned, an automated removal (this function's actual
      // caller) would leak them forever with no user action to catch it.
      const mediaUrlsToDelete = [
        comment.audioUrl,
        comment.videoUrl,
        comment.videoThumbnailUrl,
      ].filter((url): url is string => Boolean(url));

      revalidatePath(`/post/${comment.postId}`);
      return { authorId: comment.authorId, mediaUrlsToDelete };
    }
    case "MESSAGE": {
      const message = await tx.message.findUnique({ where: { id: targetId } });
      if (!message) return null;

      // Soft-remove, matching how the rest of messaging already treats REMOVED
      // (see messages.ts's `moderationStatus: { not: "REMOVED" }` filter) — a
      // conversation's history shouldn't vanish, just the offending message.
      // A voice/video note's file still needs cleaning up from storage
      // though, same as deleteMessageForEveryone. The row keeps existing, so its
      // media columns are cleared: otherwise it would still count as a reference
      // and the reference-checked cleanup below would never delete the file.
      await tx.message.update({
        where: { id: targetId },
        data: { moderationStatus: "REMOVED", mediaUrl: null, mediaThumbnailUrl: null },
      });
      const mediaUrlsToDelete = [message.mediaUrl, message.mediaThumbnailUrl].filter(
        (url): url is string => Boolean(url),
      );

      revalidatePath(`/messages/${message.conversationId}`);
      return { authorId: message.senderId, mediaUrlsToDelete };
    }
    case "CIRCLE": {
      const circle = await tx.circle.findUnique({ where: { id: targetId } });
      if (!circle) return null;

      await tx.circle.delete({ where: { id: targetId } });

      revalidatePath("/circles");
      revalidatePath("/admin/circles");
      return { authorId: circle.createdById, mediaUrlsToDelete: [] };
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
      return { authorId: collabPost.authorId, mediaUrlsToDelete: [] };
    }
    case "MUSE": {
      const muse = await tx.muse.findUnique({ where: { id: targetId } });
      if (!muse) return null;

      await tx.muse.delete({ where: { id: targetId } });

      const mediaUrlsToDelete = [muse.videoUrl, muse.videoThumbnailUrl, muse.audioUrl].filter(
        (url): url is string => Boolean(url),
      );

      revalidatePath("/muse");
      revalidatePath(`/u/${muse.authorId}`);
      return { authorId: muse.authorId, mediaUrlsToDelete };
    }
    case "USER":
    default:
      return null;
  }
}

/**
 * Runs the R2 cleanup deferred by removeModeratedContent — call only after the transaction that used it has committed.
 * Only files nothing else still uses are deleted (deleteMediaIfUnreferenced): a removed reshare (a post shared to a
 * Story or Muse, a forwarded message) points at the original's file, and removing the copy used to delete the
 * original author's media too (audit M2).
 */
export async function cleanUpModeratedMedia(mediaUrlsToDelete: string[]) {
  await deleteMediaIfUnreferenced(mediaUrlsToDelete);
}
