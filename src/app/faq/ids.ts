// The FAQ's sections and entries by id, in page order. An id is the entry's anchor (/faq#id) and the key its
// translations are filed under (content/), so it never changes once shipped, whatever happens to the question's
// wording. page.tsx holds the English; content.test.ts keeps the three in step.

export const FAQ_SECTION_IDS = [
  "getting-around",
  "android-app",
  "posts-media",
  "going-live",
  "stories",
  "muse",
  "ambient",
  "connecting-messaging-calls",
  "hidden-chats",
  "circles-collab-boards",
  "advertising",
  "inviting-friends",
  "your-account-data",
  "privacy-safety-trust",
] as const;

export const FAQ_IDS = [
  // Getting around
  "who-join-yukon3t",
  "where-find-everything",
  "swipe-between-tabs-instead-tapping",
  "difference-between-home-discover-connections",
  "switch-between-light-dark-mode",
  "yukon3t-work-iphones-accessibility-settings",
  "megaphone-icon-next-bell",
  "search-app",
  "click-someones-name-almost-everywhere",
  "some-people-disappear-from-discover",
  "new-member-alerts",
  "home-split-into-sections-like",
  "update-the-app",
  // The Android app
  "app-opens-chrome-instead-full",
  "still-get-calls-phone-asleep",
  "shows-up-notification-phone",
  "turning-up-phones-volume-unmutes",
  // Posts and media
  "post",
  "which-video-formats-upload-everyone",
  "was-photo-video-rejected",
  "delete-post-report-someone-elses",
  "share-post",
  "share-photo-video-from-another",
  "react-post-something-other-than",
  "change-emoji-look-throughout-app",
  "send-gif",
  "videos-feed-play-automatically-no",
  "zoom-back-out-photo-without",
  "dictate-post",
  "difference-between-connect-subscribe",
  "see-who-im-subscribed-whos",
  "people-you-may-know-discover",
  "long-post-get-cut-off",
  "got-message-saying-new-version",
  "there-way-see-older-posts",
  // Going Live
  "start-join-live-stream",
  "who-see-live-stream-start",
  "start-live-stream-just-one",
  "difference-between-watching-joining-guest",
  "host-mute-guest-co-host",
  "record-go-live-stream-take",
  "recording-stream-posted-automatically",
  "did-live-stream-end-its",
  "people-comment-during-live-stream",
  "keep-using-app-during-call",
  // Stories
  "story",
  "post-text-only-story",
  "post-more-than-one-story",
  "move-between-different-peoples-stories",
  "people-react-reply-comment-story",
  // Muse
  "muse-2",
  "post-muse",
  "delete-muse-after-ive-posted",
  "share-reshare-follow-muse",
  "share-post-muse",
  "view-count-muse-mean",
  "muse-play-sound",
  "react-comment-muse",
  "need-keep-scrolling-see-theres",
  // Ambient
  "ambient-2",
  "who-see-ambient-moments",
  "there-lock-screen-watch-widget",
  // Connecting, messaging, and calls
  "message-someone",
  "reply-specific-message",
  "send-photos-videos-voice-notes",
  "send-photo-video-disappears-after",
  "see-photo-chat-full-screen",
  "when-open-chat-jump-straight",
  "voice-video-calls-work",
  "add-more-people-call",
  "put-call-hold",
  "happens-call-switch-apps-lock",
  "happens-connection-drops-during-call",
  "there-limit-long-call-last",
  "hear-ringing-sound-when-call",
  "says-already-have-call-someone",
  "group-chats-work",
  "typed-message-but-didnt-send",
  "secret-chats",
  "forget-recovery-passphrase-lose-phone",
  "moderators-read-secret-chats-report",
  // Hidden chats
  "hiding-chat",
  "open-hidden-chat-unhide-one",
  "other-person-know-hid-our",
  "forgot-pin-happens-hidden-chats",
  "doesnt-hiding-chat",
  // Circles and Collab Boards
  "circle",
  "who-see-shared-circle-sub",
  "pick-category-circle",
  "rename-circle-change-its-theme",
  "sub-circles",
  "invite-people-private-circle",
  "invite-someone-circles-voice-channel",
  "collab-board",
  "difference-between-public-private-collab",
  "starting-joining-collab-session-work",
  "schedule-recurring-collaboration-session",
  "add-collaborations-session-own-calendar",
  "share-screen-upload-material-during",
  "leave-collab-session",
  "invite-someone-private-collaboration-approve",
  "edit-collab-board-after-ive",
  "co-admins-circle-collab-board",
  "polls-circle-collab-board",
  "circle-events-coming-up",
  // Advertising
  "advertise-yukon3t",
  // Inviting friends
  "invite-someone-from-phones-contacts",
  // Your account and data
  "signed-new-phone-computer-wheres",
  "download-copy-data",
  "difference-between-deactivating-deleting-account",
  "forgot-password",
  "was-asked-reset-password",
  "set-interests-find-specific-job",
  "need-sign-up",
  "languages",
  "sign-up-says-something-needs",
  "verify-account-after-signing-up",
  "why-verify-human-app",
  "says-account-locked-happened",
  // Privacy, safety, and trust
  "who-see-posts-profile",
  "trust-score-trust-badge",
  "someone-know-take-screenshot",
  "save-someones-profile-picture",
  "report-someone-something",
] as const;

export type FaqSectionId = (typeof FAQ_SECTION_IDS)[number];
export type FaqId = (typeof FAQ_IDS)[number];

/**
 * One language's FAQ. Answers are plain text with a small inline markup, drawn by FaqAnswer (answer.tsx):
 * **bold**, *emphasis*, `code`, [link text](/internal-path), and a blank line for a paragraph break.
 */
export type FaqContent = {
  heading: string;
  intro: string;
  sections: Record<FaqSectionId, string>;
  items: Record<FaqId, { q: string; a: string }>;
};

export type FaqItems = FaqContent["items"];
