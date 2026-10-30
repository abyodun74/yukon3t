import { serverUnreachable } from "@/lib/i18n/en/common";

/**
 * A person's profile (/u/…): the page itself and its subscriber lists (Server Components, read with getDictionary()),
 * and the profile's own client components (the edit form, the photo upload, the story ring), which ProfileTextProvider
 * hands the reader's language from the /u layout. The posts on a profile take their wording from the feed area.
 */
export const profileEn = {
  page: {
    updated: "Profile updated.",
    errors: {
      moderation: "Your name or bio didn't pass our content guidelines.",
      other: "Please check your inputs.",
    },
    onlineNow: "Online now",
    lastSeen: "Last seen {when}",
    offline: "Offline",
    subscribers: "one: # Subscriber | other: # Subscribers",
    subscribing: "one: # Subscribing | other: # Subscribing",
    blocked: "You've blocked this account.",
    reportAccount: "Report account",
    yourPosts: "Your posts",
    posts: "Posts",
    connectionsOnly: "{name} only shares posts with their connections.",
    emptyOwn: "Nothing posted yet — share a photo, a short video, or an update.",
    empty: "No posts yet.",
    yourSubscribers: "Your subscribers",
    subscribersOf: "{name}'s subscribers",
    yourSubscribing: "Who you subscribe to",
    subscribingOf: "Who {name} subscribes to",
  },
  lists: {
    noSubscribers: "No subscribers yet.",
    noSubscribing: "Not subscribed to anyone yet.",
  },
  storyRing: {
    noPhoto: "No photo",
    noPhotoLabel: "{name} has no profile photo",
    viewStory: "View {name}'s story",
    enlargePhoto: "Enlarge {name}'s profile photo",
  },
  postMuse: "Post a Muse",
  edit: {
    open: "Edit profile",
    cancel: "Cancel editing",
    picture: "Profile picture",
    name: "Display name",
    bio: "Bio",
    country: "Country",
    countryPlaceholder: "Select your country...",
    languages: "Languages",
    languagesPlaceholder: "Search languages...",
    interests: "Interests",
    interestsPlaceholder: "Search interests...",
    openTo: "Open to",
    save: "Save changes",
  },
  avatar: {
    change: "Change profile picture",
    noPhotoChange: "No photo, change profile picture",
    noPhoto: "No photo",
    changePhoto: "Change photo",
    fromGallery: "Choose from gallery",
    takePhoto: "Take a photo",
    uploading: "Uploading...",
    hint: "JPEG, PNG, or WebP, up to 12MB. No sexually explicit content.",
    cropTitle: "Crop profile picture",
    errors: {
      type: "Use a JPEG, PNG, or WebP image.",
      too_large: "Image must be 12MB or smaller.",
      not_configured: "Profile picture uploads aren't set up yet — check back soon.",
      network: serverUnreachable,
      upload: "Upload failed — try again.",
      moderation: "That photo didn't pass our content guidelines and wasn't saved.",
      other: "Couldn't save your photo — try again.",
    },
  },
};
