import type { pagesEn } from "@/lib/i18n/en/pages";
import { format } from "@/lib/i18n/locales";

// The system notices a bell row can carry (Notification.messageData), as data rather than English prose, so they can
// be worded in whichever language the reader has when they read them, and in the recipient's language in the push sent
// with them. Pure and client-safe: notification-row.tsx decodes and words a row with it.

type NoticeText = typeof pagesEn.notifications.notices;

export type Notice =
  | { kind: "video_flagged"; categories: string[] }
  | { kind: "recording_failed" }
  | { kind: "recording_flagged"; categories: string[] };

// A category key is one token of video-review.ts's reasons ("sexual", "violence/graphic", "profanity"): never a comma.
export function encodeNotice(notice: Notice): string {
  return notice.kind === "recording_failed" ? notice.kind : `${notice.kind}:${notice.categories.join(",")}`;
}

/** Null for anything it doesn't recognise, so the row falls back to its stored English `message`. */
export function decodeNotice(data: string | null | undefined): Notice | null {
  if (!data) return null;
  const colon = data.indexOf(":");
  const kind = colon === -1 ? data : data.slice(0, colon);
  const categories = colon === -1 ? [] : data.slice(colon + 1).split(",").filter(Boolean);
  if (kind === "recording_failed" && colon === -1) return { kind };
  if (kind === "video_flagged" || kind === "recording_flagged") return { kind, categories };
  return null;
}

/** A category's name in `t`, or a readable form of a key the dictionary doesn't have (as the English has always done). */
export function categoryName(key: string, t: NoticeText): string {
  return (t.categories as Record<string, string>)[key] ?? key.replace(/[_/]/g, " ");
}

/** The notice's sentence in the language `t` and `listSeparator` are in. */
export function noticeText(notice: Notice, t: NoticeText, listSeparator: string): string {
  if (notice.kind === "recording_failed") return t.recordingFailed;
  const names = [...new Set(notice.categories.map((key) => categoryName(key, t)))];
  const reasons = names.join(listSeparator);
  if (notice.kind === "video_flagged") {
    return names.length === 0 ? t.videoFlagged : format(t.videoFlaggedReasons, { reasons });
  }
  return names.length === 0 ? t.recordingFlagged : format(t.recordingFlaggedReasons, { reasons });
}
