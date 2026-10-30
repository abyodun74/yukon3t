import { prisma } from "@/lib/prisma";
import { removeModeratedContent, cleanUpModeratedMedia } from "@/lib/content-moderation";
import {
  expiredMediaHoldWindow,
  mediaHoldExpiredAuditReason,
  postIdFromMediaAuditReason,
  MEDIA_HOLD_EXPIRED_PERFORMED_BY,
  MEDIA_HOLD_PERFORMED_BY,
} from "@/lib/media-moderation-hold";

const SWEEP_LIMIT = 100;

/**
 * Deletes photo/video posts the automated screen held at posting (createPost, src/lib/media-moderation-hold.ts) that
 * no admin has published or removed within MEDIA_HOLD_REVIEW_WINDOW_MS, media included, so a held upload isn't kept
 * indefinitely. Run hourly by the resolve-stale-reports cron. Only a post that is still FLAGGED is touched: one an
 * admin published, or that is already gone, is skipped. Each deletion writes an audit row saying it expired unreviewed
 * (not a confirmed violation); nothing here counts against the person's trust score (only upheld reports do).
 */
export async function sweepExpiredMediaHolds(now = new Date()): Promise<{ expired: number }> {
  const holds = await prisma.auditLog.findMany({
    where: {
      action: "CONTENT_FLAGGED_FOR_REVIEW",
      performedBy: MEDIA_HOLD_PERFORMED_BY,
      createdAt: expiredMediaHoldWindow(now),
    },
    orderBy: { createdAt: "asc" },
    select: { reason: true },
    take: 1000,
  });
  const postIds = [...new Set(holds.map((h) => postIdFromMediaAuditReason(h.reason)).filter((id): id is string => !!id))];
  if (postIds.length === 0) return { expired: 0 };

  const stillHeld = await prisma.post.findMany({
    where: { id: { in: postIds }, moderationStatus: "FLAGGED" },
    select: { id: true },
    take: SWEEP_LIMIT,
  });

  let expired = 0;
  for (const { id } of stillHeld) {
    try {
      const removed = await prisma.$transaction(async (tx) => {
        // Re-checked inside the transaction: an admin may have published it a moment ago.
        const current = await tx.post.findUnique({ where: { id }, select: { moderationStatus: true } });
        if (current?.moderationStatus !== "FLAGGED") return null;
        const result = await removeModeratedContent("POST", id, tx);
        if (result) {
          await tx.auditLog.create({
            data: {
              targetId: result.authorId,
              action: "CONTENT_REMOVED",
              performedBy: MEDIA_HOLD_EXPIRED_PERFORMED_BY,
              reason: mediaHoldExpiredAuditReason(id),
            },
          });
        }
        return result;
      });
      if (removed) {
        await cleanUpModeratedMedia(removed.mediaUrlsToDelete);
        expired += 1;
      }
    } catch (err) {
      console.error(`[media-hold-sweep] couldn't expire held post ${id}`, err);
    }
  }
  return { expired };
}
