import { serverUnreachable, newVersionAvailable } from "@/lib/i18n/en/common";

/**
 * Muse: the feed and its player, a Muse's comments, its share sheet and the composer. MuseTextProvider hands it to
 * /muse and to a profile (the owner's "Post a Muse" button opens the composer there); without a provider these
 * fall back to this.
 */
export const museEn = {
  feed: {
    empty: "No Muses yet — be the first to post one.",
    goToProfile: "Go to your profile",
    sharedToHome: "Shared to your Home",
    removedFromHome: "Removed from your Home",
    // The embed's and the video's accessible names; the second of each is for an author the data has no name for.
    embedTitle: "Embedded video shared by {name}",
    embedTitleUnnamed: "Embedded video shared by someone",
    videoLabel: "Muse by {name}",
    videoLabelUnnamed: "Muse by someone",
    tapForSound: "Tap for sound",
    delete: "Delete Muse",
    deleteConfirmLabel: "Delete? Confirm",
    deleteConfirm: "Delete?",
    play: "Play",
    pause: "Pause",
    mute: "Mute",
    unmute: "Unmute",
    views: "one: # view | other: # views",
    viewOriginal: "View original post",
    commentsCount: "Comments, {count}",
    reshareCount: "Reshare to Home, {count}",
    shareCount: "Share, {count}",
  },
  comments: {
    title: "Comments",
    titleCount: "Comments ({count})",
    close: "Close comments",
    loading: "Loading…",
    empty: "No comments yet.",
    someone: "Someone",
    delete: "Delete comment",
    add: "Add a comment",
    placeholder: "Add a comment...",
    postLabel: "Post comment",
    post: "Post",
    failed: "Couldn't post that comment.",
  },
  // The rest of the share sheet's wording is the post share sheet's (feed.share).
  share: {
    title: "Share Muse",
    onHome: "On your Home",
    sharingToHome: "Sharing…",
    toHome: "Share to your Home",
    copyFailed: "Couldn't copy the link.",
    linkOnly: "Couldn't attach the video here, so only the link was shared.",
    storyErrors: {
      too_long: "This Muse is too long for a Story.",
      rate_limited: "Slow down a little and try again.",
      other: "Couldn't add it to your story.",
    },
    sendErrors: {
      blocked: "You can't message this person.",
      other: "Couldn't send it.",
    },
  },
  composer: {
    title: "Post a Muse",
    intro:
      "one: Short, funny, creative — up to # minute. Visible to everyone on YuKon3t. | other: Short, funny, creative — up to # minutes. Visible to everyone on YuKon3t.",
    chooseVideo: "Choose a video",
    removeVideo: "Remove video",
    originalSound: "Original sound",
    customAudio: "Custom audio",
    chooseAudio: "Choose audio to replace the video's sound",
    removeAudio: "Remove audio",
    caption: "Add a caption (optional)",
    posted: "Posted!",
    posting: "Posting…",
    post: "Post Muse",
    unreadable: "Couldn't read this video's length — try picking a different file.",
    tooLong:
      "one: A Muse can be at most # minute — pick a shorter clip. | other: A Muse can be at most # minutes — pick a shorter clip.",
    errors: {
      too_large: "That video is too large.",
      moderation: "This couldn't be posted — it may violate our content guidelines.",
      rate_limited: "You're posting too fast — try again in a bit.",
      invalid: "That couldn't be posted — try picking the file(s) again.",
      network: serverUnreachable,
      stale_deployment: newVersionAvailable,
      other: "Something went wrong — try again.",
    },
  },
};
