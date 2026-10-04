import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { videoPendingReviewNoticeText } from "@/lib/moderation-labels";

/**
 * Tells a post/comment/Muse author their over-60s video was flagged by the
 * long-video review pipeline and is on hold pending a human look (see the
 * "flagged" branches in moderate-long-videos/route.ts) — the async
 * counterpart to a short video's synchronous moderation hold, which
 * createPost/createComment/createMuse never notifies about either (same
 * "stored hidden, no notification until an admin acts" convention every
 * flagged-at-creation path in this app already follows). This exists only
 * because the long-video path is otherwise genuinely silent: nothing else
 * would ever tell the author their video didn't just vanish.
 *
 * `target` links the notification to the actual held content, which only
 * makes sense because this pipeline no longer deletes on "flagged" — see
 * VIDEO_FLAGGED_FOR_REVIEW's own schema doc comment. Pass whichever of
 * postId/commentId/museId applies; getMuseById/the /post/[id] page both
 * already special-case "the author can view their own flagged content" so
 * the link actually resolves instead of 404ing for the one person it's for.
 *
 * Best-effort across all three channels, same contract as
 * notifyMissedCall/notifyScreenshotTaken — a push failure should never
 * break the cron tick that triggered this.
 */
export async function notifyVideoFlaggedForReview(
  authorId: string,
  reasons: string[],
  target: { postId?: string; commentId?: string; museId?: string },
) {
  const message = videoPendingReviewNoticeText(reasons);

  await sendPushToUser(authorId, { title: "Video pending review", body: message, url: "/notifications" });
  await sendFcmActivityToUser(authorId, {
    title: "Video pending review",
    body: message,
    type: "VIDEO_FLAGGED_FOR_REVIEW",
    url: "/notifications",
  });

  // In-app bell notification — actorId is the author themself (system-
  // generated, no separate real actor exists; see notificationHasActor in
  // notification-text.ts, which VIDEO_FLAGGED_FOR_REVIEW opts out of the
  // "{actor} {verb}" phrasing the same way EVENT_REMINDER does).
  await prisma.notification.create({
    data: { recipientId: authorId, actorId: authorId, type: "VIDEO_FLAGGED_FOR_REVIEW", message, ...target },
  });
}
