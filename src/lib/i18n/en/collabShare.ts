/**
 * Sharing a Collab (collab-share-sheet.tsx): the sheet a long press / right-click on a Collab card opens, and the Share
 * button on a collab's page. Mounted by CollabShareTextProvider in the /collab and /search layouts. A PRIVATE collab is
 * never shared (it is invite-only) and neither is a closed one, so their sheet only explains that.
 */
export const collabShareEn = {
  title: "Share collab",
  open: "Share collab",
  inChats: "Share in chats",
  via: "Share via…",
  copyLink: "Copy link",
  linkCopied: "Link copied",
  copyFailed: "Couldn't copy the link.",
  back: "Back",
  privateHint: "This collab is private, so it can't be shared. People join it by invite only.",
  privateInviteHint: "To add someone, invite them from the collab's page.",
  invite: "Invite people",
  closedHint: "This collab is closed, so it can't be shared.",
  searchChats: "Search chats",
  clearSearch: "Clear search",
  noChatMatch: "No chats match.",
  noChats: "No chats to send to yet.",
  unavailable: "This collab can't be shared.",
};
