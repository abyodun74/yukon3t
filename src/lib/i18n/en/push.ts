// What the server writes for someone who isn't looking at the app: web push and native (FCM, VoIP) notification text.
// Worded in the recipient's stored language (User.locale) by src/lib/push-text.ts; never sent to a browser. A body
// under an `activity` title is read after the sender's name, which is the notification's title.

export const pushEn = {
  someone: "Someone",
  // What a caller whose chat the recipient has hidden is called (HIDDEN_CALLER_NAME is this English one).
  privateCall: "Private call",
  // The only text a recipient hiding a chat gets for anything in it (hiddenPushPayload). Its title is always "YuKon3t".
  hiddenBody: "You have a new notification",
  message: {
    title: "New message",
    photo: "Sent a photo",
    video: "Sent a video",
    gif: "Sent a GIF",
    voice: "Sent a voice note",
    // Text that can't be shown (a secret chat, or anything that looks encrypted). Never says why.
    unreadable: "New message",
  },
  storyReply: { title: "Story reply", body: "Replied to your story: {text}" },
  call: {
    incomingVideo: "Incoming video call",
    incomingVoice: "Incoming voice call",
    calling: "{name} is calling you",
    callingPrivate: "Private call is calling you",
    missedTitle: "Missed call",
    missed: "{name} called you",
  },
  // Kept identical to NOTIFICATION_VERB (src/lib/notification-text.ts) in English by a test.
  activity: {
    CONNECTION_REQUEST: "sent you a connection request",
    CONNECTION_ACCEPTED: "accepted your connection request",
    POST_LIKE: "liked your post",
    POST_COMMENT: "commented on your post",
    COMMENT_REPLY: "replied to your comment",
    MUSE_LIKE: "reacted to your Muse",
    MUSE_COMMENT: "commented on your Muse",
    MUSE_REPOST: "reshared your Muse",
    MUSE_SHARE: "shared your Muse",
    SCREENSHOT_TAKEN: "took a screenshot",
    LIVE_STREAM_INVITE: "started a live stream with you",
    CIRCLE_INVITE: "invited you to join a private Circle",
    COLLAB_SESSION_STARTED: "started a live collaboration session",
  },
  reminders: {
    eventTitle: "Your event",
    collabTitle: "Your collaboration",
    eventStartingSoon: "Starting soon",
    eventStartingSoonAt: "Starting soon at {location}",
    collabStartingSoon: "Starting soon",
  },
  videoReviewTitle: "Video pending review",
  recordingFailedTitle: "Recording not posted",
};
