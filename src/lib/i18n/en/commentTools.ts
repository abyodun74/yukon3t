/**
 * Comment tools shared by every comment surface: the "Delete this comment?" confirmation (components/confirm-dialog.tsx,
 * used by post comments, Story comments and Muse comments and replies) and the emoji / GIF panel of the Muse comments
 * composer (components/comment-picker-panel.tsx). Mounted by CommentToolsTextProvider in the root layout.
 */
export const commentToolsEn = {
  confirmDelete: {
    commentTitle: "Delete this comment?",
    replyTitle: "Delete this reply?",
    body: "It will be removed for everyone. This can't be undone.",
    bodyWithReplies:
      "one: Its reply will be deleted too. This can't be undone. | other: Its # replies will be deleted too. This can't be undone.",
    delete: "Delete",
    deleting: "Deleting…",
    cancel: "Cancel",
    failed: "Couldn't delete it. Try again.",
  },
  picker: {
    label: "Emoji and GIFs",
    showKeyboard: "Show keyboard",
    emojiTab: "Emoji",
    recent: "Recently used",
    searchEmoji: "Search emoji",
    categories: {
      smileys_people: "Smileys & people",
      animals_nature: "Animals & nature",
      food_drink: "Food & drink",
      travel_places: "Travel & places",
      activities: "Activities",
      objects: "Objects",
      symbols: "Symbols",
      flags: "Flags",
    },
  },
};
