/**
 * The post composer's failure and retry wording (post-composer.tsx): a post that couldn't be sent goes back into the
 * composer with one specific sentence and a Retry button. Mounted by PostUploadTextProvider in FeedLayout, next to the
 * feed wording the composer already uses.
 */
export const postUploadEn = {
  retry: "Retry",
  retrying: "Retrying...",
  restored: "Your post wasn't sent. It's back in the composer.",
  repick: "That photo or video can't be read on this device any more. Choose it again, then tap Post.",
  timeout: "Posting took too long and was stopped. Your post is still here. Tap Retry.",
  network: "Couldn't reach the server, so your post wasn't sent. It's still here. Check your connection and tap Retry.",
  uploadFailed: "The photo or video didn't finish uploading. Your post is still here. Tap Retry.",
  serverError: "Something went wrong on our side. Your post is still here. Tap Retry. If it was already posted, it won't post twice.",
  somethingWrong: "Something went wrong while posting. Your post is still here. Tap Retry.",
  rateLimitedRetry: "Too many tries in a short time. Wait a minute, then tap Retry.",
  unauthorized: "You're signed out. Sign in again, then post.",
};
