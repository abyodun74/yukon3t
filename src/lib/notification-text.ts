import type { NotificationType } from "@/generated/prisma/client";

// Single source of truth for "what happened" copy — shared by the in-app
// notification list (notification-row.tsx) and the opt-in email sent by
// createNotification (src/lib/notify.ts), so the two never drift apart.
export const NOTIFICATION_VERB: Record<NotificationType, string> = {
  CONNECTION_REQUEST: "sent you a connection request",
  CONNECTION_ACCEPTED: "accepted your connection request",
  CONNECTION_POST: "shared a new post",
  POST_LIKE: "liked your post",
  POST_COMMENT: "commented on your post",
  MUSE_LIKE: "reacted to your Muse",
  MUSE_COMMENT: "commented on your Muse",
  MUSE_REPOST: "reshared your Muse",
  MUSE_SHARE: "shared your Muse",
  STORY_COMMENT: "commented on your story",
  COMMENT_REPLY: "replied to your comment",
  POST_REPOST: "reposted your post",
  POST_SHARE: "shared your post",
  EVENT_RSVP: "is going to your event",
  CIRCLE_JOINED: "joined your Circle",
  CIRCLE_CREATED: "created a new Circle",
  EVENT_REMINDER: "An event you're attending is starting soon",
  CIRCLE_JOIN_REQUEST: "requested to join your Circle",
  CIRCLE_JOIN_APPROVED: "approved your request to join their Circle",
  MESSAGE: "sent you a message",
  GROUP_ADDED: "added you to a group chat",
  COLLAB_JOINED: "joined your collaboration",
  COLLAB_JOIN_REQUEST: "requested to join your collaboration",
  COLLAB_JOIN_APPROVED: "approved your request to join their collaboration",
  COLLAB_INVITE: "invited you to collaborate",
  COLLAB_INVITE_ACCEPTED: "accepted your invitation to collaborate",
  SUBSCRIPTION_POST: "posted something new",
  SUBSCRIPTION_STORY: "added a new story",
  SUBSCRIPTION_REPOST: "reposted something",
  SUBSCRIPTION_LIVE: "started a live stream",
  SUBSCRIPTION_RSVP: "is going to an event",
  SUBSCRIPTION_CIRCLE_JOINED: "joined a Circle",
  SUBSCRIPTION_CIRCLE_CREATED: "created a new Circle",
  SUBSCRIPTION_MUSE: "uploaded a new Muse",
  SUBSCRIPTION_COLLAB: "started a new collaboration",
  VOICE_CHANNEL_INVITE: "invited you to a voice channel",
  VOICE_CHANNEL_INVITE_ACCEPTED: "accepted your voice channel invite",
  MISSED_CALL: "called you",
  SCREENSHOT_TAKEN: "took a screenshot",
  // Legacy only: the moderate-long-videos cron no longer auto-removes a
  // flagged long video (it now holds for admin review instead — see
  // VIDEO_FLAGGED_FOR_REVIEW below, and that route's own comment), so
  // nothing creates a new row of this type anymore. Kept so a notification
  // row from before that change still renders correctly. Every existing
  // row of this type already has Notification.message set with the
  // specific violation type(s), which notification-row.tsx prefers over
  // this generic fallback text.
  VIDEO_MODERATION_FAILED: "A video you posted was removed for violating our content guidelines",
  // Same violation-type(s)-in-Notification.message convention as
  // VIDEO_MODERATION_FAILED above, just worded for "on hold," not "gone" —
  // see that cron's "flagged" branch (moderate-long-videos/route.ts).
  VIDEO_FLAGGED_FOR_REVIEW: "A video you posted was flagged by our automated review and is on hold pending a closer look",
  // Sent to every admin, actor is whoever submitted it (see
  // submitAppFeedback in actions/review-prompt.ts) — Notification.message
  // always carries a truncated preview, which notification-row.tsx prefers
  // over this fallback, same convention as VIDEO_MODERATION_FAILED above.
  APP_FEEDBACK_SUBMITTED: "submitted app feedback",
  // Same plain verb as SUBSCRIPTION_LIVE — see CIRCLE_LIVE's own doc comment
  // on the NotificationType enum for what distinguishes the two. Doesn't
  // name the circle in the text, same convention every other circle-scoped
  // type here already follows (CIRCLE_JOINED, CIRCLE_JOIN_REQUEST, ...) —
  // hrefFor's link (straight to the stream) carries that context instead.
  CIRCLE_LIVE: "started a live stream",
  LIVE_STREAM_INVITE: "started a live stream with you",
  COLLAB_SESSION_REMINDER: "A collaboration session you're part of is starting soon",
  // Same Notification.message-carries-the-detail convention as
  // VIDEO_FLAGGED_FOR_REVIEW above (notifyLiveRecordingPostFailed in
  // live-recording-post-notice.ts always sets it, naming the specific
  // reason) — this is only the fallback wording.
  LIVE_RECORDING_POST_FAILED: "A live stream recording you asked to be posted couldn't be posted",
};

// A reminder isn't "someone did something to you" — it's system-generated,
// so the usual "{actor} {verb}" phrasing doesn't apply; NOTIFICATION_VERB
// (or Notification.message) already returns a complete sentence for these.
export function notificationHasActor(type: NotificationType) {
  return (
    type !== "EVENT_REMINDER" &&
    type !== "VIDEO_MODERATION_FAILED" &&
    type !== "VIDEO_FLAGGED_FOR_REVIEW" &&
    type !== "COLLAB_SESSION_REMINDER" &&
    type !== "LIVE_RECORDING_POST_FAILED"
  );
}
