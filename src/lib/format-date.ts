/**
 * Absolute date+time for a timestamp, in the viewer's local timezone.
 * Shared by every post/comment/message/story timestamp in the app so the
 * exact moment is always available — either as the visible label (post
 * cards) or as a hover tooltip on a relative "time ago" label (comments,
 * notifications, stories, chat).
 */
export function formatDateTime(date: Date) {
  return new Date(date).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
