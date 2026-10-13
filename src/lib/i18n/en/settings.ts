import { serverUnreachable } from "@/lib/i18n/en/common";

/**
 * Settings (/settings and the pages under it). The pages are Server Components and read this with getDictionary();
 * their client components (the danger zone, the ringtone picker, the notifications toggle, the emoji style, the
 * Ambient controls) get it from SettingsTextProvider in the /settings layout. The password-change code screen and the
 * phone verification form reuse the account screens' wording for what is the same there.
 */
export const settingsEn = {
  title: "Settings",
  signedInAs: "Signed in as {email}",
  // {link} is where the link below it goes.
  editProfile: "Want to change your name, bio, photo, or interests? {link}.",
  editProfileLink: "Edit your profile",
  faq: "New to YuKon3t or looking for how something works? {link}.",
  faqLink: "Check the FAQ",
  passwordResetRequired: "For your security, please choose a new password",
  saved: "Settings updated.",
  errors: {
    username_taken: "That username is taken — try another.",
    current_password_invalid: "Current password is incorrect.",
    same_password: "That's your current password. For your security, choose a different one.",
    rate_limited: "Too many attempts — try again in a few minutes.",
    other: "Please check your inputs.",
  },
  saving: "Saving...",
  privacy: {
    heading: "Privacy",
    intro: "Controls what people who aren't connected to you can see.",
    postsVisibility: "Who can see your posts",
    public: "Anyone signed in",
    connectionsOnly: "Only my connections",
    discoverable: "Show my profile in Discover",
    save: "Save privacy settings",
    // Always shown, and worded the same, whether or not the account has a PIN or a hidden chat.
    hiddenChats: "Hidden chats",
  },
  notifications: {
    heading: "Notifications",
    intro: "Get notified about incoming calls and new messages even when YuKon3t isn't open in a tab.",
    native: "Notifications are already on for the app — no need to enable them separately here.",
    unsupported: "Not available on this device or browser yet.",
    denied: "Notifications are blocked for this site in your browser settings — enable them there to turn this on.",
    turnOff: "Turn off notifications",
    enable: "Enable notifications",
  },
  language: {
    heading: "Language",
    body: "The menus, your Home feed, profiles, Settings, Search, Discover, Connections, Notifications, Messages, comments, dictation, inviting friends, the Advertise page, Circles, Collab Boards and the sign-in screens are available in these languages. The rest of the app is in English for now.",
  },
  emoji: {
    heading: "Emoji style",
    intro: "Choose how emoji look everywhere in the app — reactions, messages, and posts.",
    styles: {
      native: "Native",
      apple: "Apple (3D-style)",
      google: "Google",
      facebook: "Facebook (2.5D-style)",
      twitter: "Twitter/X",
    },
  },
  invite: {
    heading: "Invite friends",
    intro: "Send the app link straight to people in your phone's contacts who aren't on YuKon3t yet.",
  },
  blocked: {
    heading: "Blocked accounts",
    intro: "They can't message, call, or connect with you, and you won't see them in Discover.",
    deleted: "Deleted account",
  },
  calls: {
    heading: "Calls",
    intro: "Plays for both audio and video calls.",
    ringtone: "Ringtone",
    save: "Save ringtone",
    preview: "Preview",
    // The stored values (src/lib/ringtones.ts) never change.
    ringtones: {
      CLASSIC: "Classic Ring",
      CHIME: "Chime",
      DIGITAL: "Digital",
      MARIMBA: "Marimba",
      PULSE: "Pulse",
    },
  },
  signInMethod: {
    heading: "Sign-in method",
    withPassword: "You can sign in with your username and password, or the email link.",
    withoutPassword: "Add a username and password as an alternative to the email sign-in link.",
    username: "Username",
    usernameIs: "Username: {username}",
    currentPassword: "Current password",
    newPassword: "New password",
    password: "Password",
    signsOut: "Changing your password signs you out everywhere else.",
    update: "Update password",
    updating: "Updating...",
    set: "Set password",
    setting: "Setting...",
  },
  phone: {
    heading: "Phone verification",
    intro: "Optional — verifying a phone number raises your trust score.",
    verified: "Phone verified: {number}",
  },
  data: {
    heading: "Your data",
    stored:
      "Your posts, photos, videos, messages, Circles, and connections are stored on our servers, not on any one device — so signing in on a new phone or computer with this same email or username automatically brings all of it with you. Nothing to move or restore by hand.",
    exportIntro:
      "You can also export everything we have on you as JSON, any time, for free — a personal backup you keep outside YuKon3t.",
    export: "Export my data",
    exportLimited: "Too many exports recently — try again in a bit.",
    deactivateHeading: "Deactivate account",
    deactivateIntro:
      "Temporarily hides your profile and posts. Nothing is deleted — sign back in any time with your password or email link to reactivate.",
    deactivate: "Deactivate my account",
    deactivateConfirm: "Yes, deactivate",
    deleteHeading: "Delete account",
    deleteIntro:
      "Permanently deletes your profile, posts, messages, and Circles you own. This cannot be undone, and we never charge or gate this.",
    delete: "Delete my account",
    deleteConfirm: "Yes, permanently delete",
    cancel: "Cancel",
  },
  // The code screen a password change from an unrecognized device goes through. Its title, its errors and its
  // resend wording are the sign-in code screen's (verifyDevice, common).
  verifyDevice: {
    usedBody: "This verification link has expired or was already used. Try changing your password again from Settings.",
    backToSettings: "Back to Settings",
    body: "For your security, enter the 6-digit code we just emailed you to finish changing your password.",
    submit: "Confirm password change",
    cancel: "Cancel",
  },
  ambient: {
    heading: "Ambient",
    intro:
      "A handful of people you actually know, and casual moments instead of composed posts — early groundwork, no lock-screen widget yet.",
    manage: "Manage Inner Circle",
    page: {
      intro:
        "Ambient presence over performed posting — a handful of people you actually know, and casual moments instead of composed posts. There's no lock-screen widget, home-screen widget, or watch app for this yet (that needs real native development this page can't do on its own), but everything below works right now, inside the app, as the groundwork for one.",
      circleHeading: "Your Inner Circle",
      circleIntro:
        "Whoever's here is who your ambient feed (and a future widget) would show — not the same as who you subscribe to or follow.",
      momentHeading: "Share a moment",
      momentIntro:
        "One photo, an optional caption — visible only to people who have you in their Inner Circle, gone after 48 hours.",
      feedHeading: "Your ambient feed (preview)",
      feedIntro:
        "What you'd see ambiently from your Inner Circle — this is the same data /api/ambient/feed returns for a future widget, shown here since no widget exists yet.",
      widgetHeading: "For a future widget",
    },
    circle: {
      spots: "{count} of {max} spots used.",
      unnamed: "Unnamed",
      remove: "Remove",
      addFrom: "Add from your connections",
      add: "Add",
      empty: "Connect with a few people first — Inner Circle only works with real, accepted connections.",
      errors: {
        rate_limited: "Too many changes at once — wait a moment and try again.",
        not_connected: "You can only add someone you're connected with.",
        limit_reached: "Inner Circle is capped at {max} people — remove someone first.",
        other: "Something went wrong — try again.",
      },
    },
    moment: {
      choosePhoto: "Choose a photo",
      caption: "Add a caption (optional)",
      sharing: "Sharing…",
      active: "Your active moments — visible to anyone who has you in their Inner Circle, gone in 48 hours",
      delete: "Delete",
      errors: {
        type: "Use a JPEG, PNG, or WebP image.",
        not_configured: "Uploads aren't set up yet — check back soon.",
        network: serverUnreachable,
        upload: "Upload failed — try again.",
        invalid: "Couldn't read that upload — try again.",
        rate_limited: "Too many moments at once — wait a bit and try again.",
        too_large: "Image must be 25MB or smaller.",
        moderation: "That photo didn't pass our content guidelines and wasn't saved.",
        server_error: "Something went wrong saving that — try again.",
        other: "Something went wrong.",
      },
    },
    feed: {
      empty:
        "Nothing from your Inner Circle right now — moments show up here (and would show up on a future widget) for 48 hours after someone shares one.",
    },
    token: {
      heading: "Widget access token",
      intro:
        "There's no lock-screen widget or watch app built yet — this is only the credential one would need. Keep it private; anyone with it can read (not post) your Inner Circle's ambient moments.",
      activeSince: "Active since {when}",
      lastUsed: "last used {when}",
      copyNow: "Copy this now — it won't be shown again. Generating a new one revokes this one.",
      copy: "Copy",
      copied: "Copied",
      generate: "Generate token",
      generateNew: "Generate new token",
      revoke: "Revoke",
    },
  },
};
