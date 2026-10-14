import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { violationKeysFromReasons } from "@/lib/moderation-labels";
import { encodeNotice, type Notice } from "@/lib/notification-notice";
import { noticeLine, pushText } from "@/lib/push-text";
import type { Locale } from "@/lib/i18n/locales";

/**
 * What stopped a "Record & Post" recording, as a notice (notification-notice.ts). `reasons` is the automated video
 * review's own free-form reason list (see video-review.ts) when moderation is what stopped it, so the host is told the
 * specific violation(s), same convention as videoPendingReviewNoticeText. Every other irrecoverable outcome passes a
 * plain one-item reason instead and gets the generic wording.
 */
function recordingNotice(reasons: string[], moderated: boolean): Notice {
  return moderated
    ? { kind: "recording_flagged", categories: violationKeysFromReasons(reasons) }
    : { kind: "recording_failed" };
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
  const notice = recordingNotice(reasons, options.moderated);
  // English prose for the bell row's `message` (read by code that predates messageData); the pushes are worded in the
  // host's stored language, and the bell in whatever language the host reads it in.
  const message = noticeLine(notice, "en");
  const url = `/live/${liveStreamId}`;
  const push = (locale: Locale) => ({ title: pushText(locale).recordingFailedTitle, body: noticeLine(notice, locale), url });

  await sendPushToUser(hostId, push);
  await sendFcmActivityToUser(hostId, (locale) => ({ ...push(locale), type: "LIVE_RECORDING_POST_FAILED" }));

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
      messageData: encodeNotice(notice),
    },
  });
}
