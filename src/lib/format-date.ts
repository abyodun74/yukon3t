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

/** Midnight-to-midnight day distance, independent of the two Dates' time-of-day. */
function calendarDaysAgo(date: Date) {
  const d = new Date(date);
  const now = new Date();
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((startOfToday - startOfThat) / 86_400_000);
}

/**
 * Conversation-list timestamp, in the WhatsApp/Telegram convention: a clock
 * time for anything sent today, the weekday name within the last week,
 * otherwise a short date — so old threads don't crowd the list with a full
 * date/time string.
 */
export function formatInboxTime(date: Date) {
  const days = calendarDaysAgo(date);
  if (days <= 0) return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(date).toLocaleDateString([], { weekday: "short" });
  return new Date(date).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Day-separator label shown between chat bubbles that cross a calendar day. */
export function formatDaySeparator(date: Date) {
  const days = calendarDaysAgo(date);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(date).toLocaleDateString([], { weekday: "long" });
  const now = new Date();
  const sameYear = new Date(date).getFullYear() === now.getFullYear();
  return new Date(date).toLocaleDateString(
    [],
    sameYear ? { month: "long", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" },
  );
}
