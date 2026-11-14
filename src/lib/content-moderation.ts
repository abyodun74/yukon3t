import { revalidatePath } from "next/cache";
import { prisma, type TransactionClient } from "@/lib/prisma";
import { deleteMediaIfUnreferenced } from "@/lib/media-cleanup";
import { countPublishedInThread } from "@/lib/comment-count";
import { revokeGiftSend } from "@/lib/gift-revoke";
import { cancelChallengeInTx } from "@/lib/challenge-revoke";
import { lockLikeGroup, recomputeLikeGroup } from "@/lib/like-groups";

type ModeratableTargetType =
  | "USER"
  | "POST"
  | "MESSAGE"
  | "CIRCLE"
  | "COLLAB_POST"
  | "COMMENT"
  | "MUSE"
  | "GIFT"
  | "CHALLENGE";

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
      // Group lock before any row is deleted: a like toggle takes it before touching rows (no lock-order deadlock).
      if (post.likeGroupId) await lockLikeGroup(tx, post.likeGroupId);

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
      // Shared one like count with a Muse (like-groups.ts): recount what the other members still hold.
      if (post.likeGroupId) await recomputeLikeGroup(tx, post.likeGroupId);

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

      if (muse.likeGroupId) await lockLikeGroup(tx, muse.likeGroupId);
      await tx.muse.delete({ where: { id: targetId } });
      if (muse.likeGroupId) await recomputeLikeGroup(tx, muse.likeGroupId);

      const mediaUrlsToDelete = [muse.videoUrl, muse.videoThumbnailUrl, muse.audioUrl].filter(
        (url): url is string => Boolean(url),
      );

      revalidatePath("/muse");
      revalidatePath(`/u/${muse.authorId}`);
      return { authorId: muse.authorId, mediaUrlsToDelete };
    }
    case "GIFT": {
      // A reported gift is revoked (the send, every item it gave, and a frame/badge it put on the profile), not
      // deleted: the purchase stays as the record of a payment. No files: gifts are drawn by the app.
      const revoked = await revokeGiftSend(tx, targetId);
      if (!revoked) return null;
      revalidatePath(`/u/${revoked.recipientId}`);
      // An account already deleted can't carry an audit row; the gift is still revoked.
      return revoked.senderId ? { authorId: revoked.senderId, mediaUrlsToDelete: [] } : null;
    }
    case "CHALLENGE": {
      // A reported challenge (Gift Universe Phase B) is reversed, not deleted: CANCELLED by an admin, every Champion
      // award it gave revoked, its winners' bell rows removed, which also ends its CHALLENGE_WIN gift occasion. The
      // caller writes the CONTENT_REMOVED audit row against its host in the same transaction.
      const cancelled = await cancelChallengeInTx(tx, targetId, { userId: null, byAdmin: true });
      if (!cancelled) return null;
      for (const winnerId of cancelled.winnerIds) revalidatePath(`/u/${winnerId}`);
      if (cancelled.circleId) revalidatePath("/circles/[slug]", "page");
      return cancelled.hostId ? { authorId: cancelled.hostId, mediaUrlsToDelete: [] } : null;
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
