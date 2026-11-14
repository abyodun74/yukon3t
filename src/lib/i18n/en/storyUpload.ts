/**
 * The Story composer's photo/video errors that need more than feed.stories.upload.errors has: each failure on a
 * phone gets its own sentence (story-upload-modal.tsx; share-target-gate.tsx uses frameFailed too). Mounted by
 * StoryUploadTextProvider in the root layout, since the composer opens from Home, a profile and the share sheet.
 */
export const storyUploadEn = {
  frameFailed:
    "This video couldn't be prepared on this device, so it can't be posted yet. Tap to try again, or save it to Photos or Files and pick it from there.",
  imageUnreadable: "This photo couldn't be opened on this device. Try a screenshot of it, or a JPEG or PNG copy.",
  unsupportedFile: "That file isn't a photo or video we can post. Use a JPEG, PNG, WebP or HEIC photo, or an MP4 or MOV video.",
  fileReadFailed: "Couldn't read that file. Pick it again.",
  failedItem: "Couldn't upload this one: {message}",
};
