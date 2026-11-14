/**
 * Sharing a Circle (circle-share-sheet.tsx): the sheet a long press / right-click on a Circle card opens, and the Share
 * button on a Circle's page. Mounted by CircleShareTextProvider in the /circles and /search layouts. A PRIVATE Circle
 * is never shared (it is invite-only), so its sheet only explains that.
 */
export const circleShareEn = {
  title: "Share Circle",
  open: "Share Circle",
  inChats: "Share in chats",
  via: "Share via…",
  copyLink: "Copy link",
  linkCopied: "Link copied",
  copyFailed: "Couldn't copy the link.",
  back: "Back",
  privateHint: "This Circle is private, so it can't be shared. People join it by invite only.",
  privateInviteHint: "To add someone, invite them from the Circle's page.",
  invite: "Invite people",
  searchChats: "Search chats",
  clearSearch: "Clear search",
  noChatMatch: "No chats match.",
  noChats: "No chats to send to yet.",
  unavailable: "This Circle can't be shared.",
};
