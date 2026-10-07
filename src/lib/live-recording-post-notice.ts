import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { violationLabelsFromReasons } from "@/lib/moderation-labels";

/**
 * User-facing sentence for a "Record & Post" recording that never became a
 * Post. `reasons` is the automated video review's own free-form reason list
 * (see video-review.ts) when moderation is what stopped it, so the host is
 * told the specific violation(s) — same convention as
 * videoPendingReviewNoticeText. Every other irrecoverable outcome passes a
 * plain one-item reason instead and gets the generic wording.
 */
function noticeText(reasons: string[], moderated: boolean): string {
  const base = "Your live stream recording couldn't be posted to the Home Feed";
  if (!moderated) {
    return `${base}. The recording itself is still available to download from the stream's Recordings list.`;
  }
  const labels = violationLabelsFromReasons(reasons);
  if (labels.length === 0) {
    return `${base} — our automated review flagged it. The recording itself is still available to download from the stream's Recordings list.`;
  }
  return `${base} — our automated review flagged it (${labels.join(", ")}). The recording itself is still available to download from the stream's Recordings list.`;
}

/**
 * Tells a host their "Record & Post" recording never made it to the feed
 * (see LiveStreamRecordingPost and advanceRecordingPost in
 * live-stream-recording-post.ts). Same shape and reasoning as
 * notifyVideoFlaggedForReview: this pipeline is otherwise completely silent
 * from the host's side — they tapped a button and would simply never see a
 * post appear — and unlike an ordinary upload there's no composer still open
 * to surface an error in.
 *
 * `moderated` distinguishes "the review flagged your video" (reasons are the
 * review's own categories, worth naming) from every other irrecoverable
 * failure (Daily never finished the recording, the destination Circle
 * channel is gone, a Cloudflare/R2 copy that never succeeded), which stays
 * deliberately generic — those are our problem, not something the host did.
 *
 * Best-effort across all three channels, same contract as
 * notifyVideoFlaggedForReview/notifyMissedCall — a push failure must never
 * break the cron tick that triggered it.
 */
export async function notifyLiveRecordingPostFailed(
  hostId: string,
  liveStreamId: string,
  reasons: string[],
  options: { moderated: boolean },
) {
  const message = noticeText(reasons, options.moderated);
  const url = `/live/${liveStreamId}`;

  await sendPushToUser(hostId, { title: "Recording not posted", body: message, url });
  await sendFcmActivityToUser(hostId, {
    title: "Recording not posted",
    body: message,
    type: "LIVE_RECORDING_POST_FAILED",
    url,
  });

  // In-app bell notification — actorId is the host themself (system-
  // generated, no separate real actor; see notificationHasActor in
  // notification-text.ts, which LIVE_RECORDING_POST_FAILED opts out of the
  // "{actor} {verb}" phrasing the same way VIDEO_FLAGGED_FOR_REVIEW does).
  await prisma.notification.create({
    data: {
      recipientId: hostId,
      actorId: hostId,
      type: "LIVE_RECORDING_POST_FAILED",
      liveStreamId,
      message,
    },
  });
}
