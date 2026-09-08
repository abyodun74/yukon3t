import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { videoViolationNoticeText } from "@/lib/moderation-labels";

/**
 * Tells a post's author their over-60s video was auto-removed by the
 * long-video review pipeline (video-review.ts's "flagged" outcome, wired up
 * in the moderate-long-videos cron) — the async counterpart to a short
 * video's synchronous moderation rejection, which createPost already
 * surfaces to the uploader directly in the same request/response.
 *
 * Call only after the Post row itself has already been deleted (see
 * removeModeratedContent's POST case) — Notification.postId is
 * deliberately left unset since the post it'd reference no longer exists
 * (and its @@relation is onDelete: Cascade, so setting it pre-deletion
 * would just have the notification vanish with the post anyway).
 *
 * Best-effort across all three channels, same contract as
 * notifyMissedCall/notifyScreenshotTaken — a push failure should never
 * break the cron tick that triggered this.
 */
export async function notifyVideoModerationFailed(authorId: string, reasons: string[]) {
  const message = videoViolationNoticeText(reasons);

  await sendPushToUser(authorId, { title: "Video removed", body: message, url: "/notifications" });
  await sendFcmActivityToUser(authorId, {
    title: "Video removed",
    body: message,
    type: "VIDEO_MODERATION_FAILED",
    url: "/notifications",
  });

  // In-app bell notification — actorId is the author themself (system-
  // generated, no separate real actor exists; see notificationHasActor in
  // notification-text.ts, which VIDEO_MODERATION_FAILED opts out of the
  // "{actor} {verb}" phrasing the same way EVENT_REMINDER does).
  await prisma.notification.create({
    data: { recipientId: authorId, actorId: authorId, type: "VIDEO_MODERATION_FAILED", message },
  });
}
