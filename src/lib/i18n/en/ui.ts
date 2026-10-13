import { serverUnreachable } from "@/lib/i18n/en/common";

// Entries written "one: … | other: …" are plural forms, picked by plural() in locales.ts with "#" standing for the
// number. Each language lists the categories its own grammar has (Intl.PluralRules): two here, six in Arabic.

/**
 * Wording of components the whole app mounts, on translated and untranslated screens alike: comments, the recorders
 * and pickers a composer opens, dictation, reactions, the report sheet. UiTextProvider (root layout) hands them the
 * reader's language; without a provider they fall back to this.
 */
export const uiEn = {
  // Between the names of a list ("Seen by Ana, Ben").
  listSeparator: ", ",
  close: "Close",
  cancel: "Cancel",
  save: "Save",
  online: "Online",
  // An avatar's description, and the stand-in for a name the data doesn't have.
  profilePhoto: "{name}'s profile photo",
  unknownName: "Unknown",
  time: { justNow: "Just now", today: "Today", yesterday: "Yesterday" },
  // The block control beside a person (a profile, the blocked list in Settings). The "account" forms are for someone
  // whose name the data doesn't have.
  block: {
    block: "Block",
    confirm: "Block {name}?",
    confirmAccount: "Block this account?",
    yes: "Yes, block",
    unblock: "Unblock {name}",
    unblockAccount: "Unblock this account",
  },
  // The crop step of a photo upload (a profile picture, a Circle cover).
  crop: { title: "Crop photo", use: "Use photo", cropping: "Cropping...", zoom: "Zoom" },
  reactions: {
    count: "one: # reaction | other: # reactions",
    add: "Add an emoji",
    more: "More emoji",
    picker: "Emoji picker",
    suggested: "Suggested",
  },
  gif: {
    add: "Add a GIF",
    search: "Search GIFs",
    notConfigured: "GIF search isn't set up yet.",
    noTrending: "No trending GIFs right now.",
    noResults: "No GIFs found for that search.",
  },
  media: {
    addVideo: "Add a video",
    uploadFromDevice: "Upload from device",
    recordLive: "Record live",
    videoType: "Use an MP4, MOV or WebM video.",
    videoTooLarge: "Video must be 2GB or smaller.",
  },
  recorder: {
    voiceTitle: "Record a voice note",
    videoTitle: "Record a video",
    record: "Record",
    stop: "Stop",
    progress: "{seconds}s / {max}s",
    limit: "Up to {max}s",
    switchCamera: "Switch camera",
    micErrors: {
      NotAllowedError:
        "Microphone access was denied. Check your browser's site permissions (and your OS privacy settings) and try again.",
      NotFoundError: "No microphone was found on this device.",
      NotReadableError: "Your microphone is already in use by another app.",
      SecurityError: "This page isn't running in a secure context (mic access needs HTTPS, or localhost for dev).",
      other: "Couldn't access your microphone ({name}).",
    },
    cameraErrors: {
      NotAllowedError:
        "Camera/microphone access was denied. Check your browser's site permissions (and your OS privacy settings) and try again.",
      NotFoundError: "No camera or microphone was found on this device.",
      NotReadableError: "Your camera or microphone is already in use by another app.",
      SecurityError: "This page isn't running in a secure context (camera access needs HTTPS, or localhost for dev).",
      other: "Couldn't access your camera/microphone ({name}).",
    },
  },
  dictation: {
    button: "Dictate text",
    starting: "Starting...",
    recording: "Recording... {clock}",
    transcribing: "Transcribing...",
    dismiss: "Dismiss",
    errors: {
      not_configured: "Dictation isn't set up yet.",
      too_large: "That clip is too large.",
      rate_limited: "You're dictating too fast — slow down a little.",
      unavailable: "Couldn't transcribe that clip — try again.",
      network: serverUnreachable,
      upload_failed: "Couldn't upload that clip — try again.",
      stale_deployment: "A new version of the app is available — refresh the page to continue.",
    },
  },
  report: {
    trigger: "Report",
    titles: {
      USER: "Report this account",
      COMMENT: "Report comment",
      MESSAGE: "Report this message",
      POST: "Report post",
    },
    sent: "Reported. Our team reviews reports within 24 hours.",
    reason: "Reason",
    // The same labels as reportReasonCategoryLabels (validations.ts); dictionaries.test.ts keeps the two in step.
    reasons: {
      SPAM: "Spam",
      SCAM_OR_FRAUD: "Scam or fraud",
      PHISHING: "Phishing",
      HARASSMENT: "Harassment or abuse",
      FAKE_ACCOUNT: "Fake account / impersonation",
      INAPPROPRIATE_CONTENT: "Inappropriate or unwanted content",
      OTHER: "Something else",
    },
    details: "A few details (min 10 characters)",
    evidence:
      "We can't read this message ourselves. Submitting this report shares its text with our moderators so they can review it.",
    submit: "Submit report",
    error: "Couldn't submit — try again shortly.",
  },
  comments: {
    heading: "Comments",
    empty: "No comments yet — be the first to say something.",
    loading: "Loading comments...",
    loadFailed: "Couldn't load comments — try again.",
    author: "(author)",
    edited: "Edited",
    removed: "This comment was removed.",
    editLabel: "Edit comment",
    editFailed: "Couldn't save that edit.",
    reply: "Reply",
    edit: "Edit",
    delete: "Delete",
    hide: "Hide",
    hideHint: "Hide this comment as inappropriate — keeps the thread intact for everyone else",
    gifAlt: "GIF",
    voiceComment: "Voice comment",
    videoComment: "Video comment",
    composer: {
      comment: "Write a comment...",
      commentLabel: "Write a comment",
      reply: "Write a reply...",
      replyLabel: "Write a reply",
      gifAttached: "GIF attached",
      removeGif: "Remove GIF",
      voiceAttached: "Voice clip attached",
      removeVoice: "Remove voice clip",
      videoAttached: "Video attached",
      removeVideo: "Remove video",
      recordVoice: "Record a voice comment",
      submit: "Comment",
      submitReply: "Reply",
      posting: "Posting...",
      posted: "Comment posted",
      replyPosted: "Reply posted",
      videoTooLong: "one: Videos must be # minute or shorter. | other: Videos must be # minutes or shorter.",
      errors: {
        rate_limited: "You're commenting too fast — slow down a little.",
        too_large: "That file is too large.",
        moderation: "That video didn't pass our content guidelines and wasn't posted.",
        network: serverUnreachable,
        upload_failed: "Couldn't upload that file — try again.",
        invalid: "Couldn't post that comment — try again.",
        other: "Couldn't post — try again.",
      },
    },
  },
};
