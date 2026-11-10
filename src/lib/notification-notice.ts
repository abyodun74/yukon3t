import type { pagesEn } from "@/lib/i18n/en/pages";
import { format } from "@/lib/i18n/locales";

// The system notices a bell row can carry (Notification.messageData), as data rather than English prose, so they can
// be worded in whichever language the reader has when they read them, and in the recipient's language in the push sent
// with them. Pure and client-safe: notification-row.tsx decodes and words a row with it.

type NoticeText = typeof pagesEn.notifications.notices;

export type Notice =
  | { kind: "video_flagged"; categories: string[] }
  | { kind: "recording_failed" }
  | { kind: "recording_flagged"; categories: string[] }
  // A coalesced NEW_MEMBER_JOINED row (src/lib/new-member-alerts.ts): the actor and `others` more people just joined.
  | { kind: "new_members"; others: number }
  // The celebrant's combined BIRTHDAY_WISHES row (src/lib/birthday-wish-server.ts): the actor and `others` more people
  // wished them a happy birthday.
  | { kind: "birthday_wishes"; others: number }
  // A HOLIDAY_TODAY row (src/lib/holidays-data.ts): "Today is <holiday> in <country>", both names already in the
  // recipient's language when it was sent (the dataset's holiday names aren't in the dictionaries).
  | { kind: "holiday"; holiday: string; country: string };

// A category key is one token of video-review.ts's reasons ("sexual", "violence/graphic", "profanity"): never a comma.
export function encodeNotice(notice: Notice): string {
  if (notice.kind === "recording_failed") return notice.kind;
  // Names can hold any character, so they travel as a JSON array.
  if (notice.kind === "holiday") return `holiday:${JSON.stringify([notice.holiday, notice.country])}`;
  if (notice.kind === "new_members" || notice.kind === "birthday_wishes") return `${notice.kind}:${notice.others}`;
  return `${notice.kind}:${notice.categories.join(",")}`;
}

/** Null for anything it doesn't recognise, so the row falls back to its stored English `message`. */
export function decodeNotice(data: string | null | undefined): Notice | null {
  if (!data) return null;
  const colon = data.indexOf(":");
  const kind = colon === -1 ? data : data.slice(0, colon);
  const categories = colon === -1 ? [] : data.slice(colon + 1).split(",").filter(Boolean);
  if (kind === "recording_failed" && colon === -1) return { kind };
  if (kind === "holiday") return colon === -1 ? null : decodeHoliday(data.slice(colon + 1));
  if (kind === "new_members" || kind === "birthday_wishes") {
    const others = colon === -1 ? NaN : Number(data.slice(colon + 1));
    return Number.isSafeInteger(others) && others > 0 ? { kind, others } : null;
  }
  if (kind === "video_flagged" || kind === "recording_flagged") return { kind, categories };
  return null;
}

function decodeHoliday(json: string): Notice | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [holiday, country] = parsed;
    if (typeof holiday !== "string" || typeof country !== "string" || !holiday || !country) return null;
    return { kind: "holiday", holiday, country };
  } catch {
    return null;
  }
}

/** A category's name in `t`, or a readable form of a key the dictionary doesn't have (as the English has always done). */
export function categoryName(key: string, t: NoticeText): string {
  return (t.categories as Record<string, string>)[key] ?? key.replace(/[_/]/g, " ");
}

/** The notice's sentence in the language `t` and `listSeparator` are in. */
export function noticeText(notice: Notice, t: NoticeText, listSeparator: string): string {
  if (notice.kind === "recording_failed") return t.recordingFailed;
  if (notice.kind === "new_members") {
    return notice.others === 1 ? t.newMembersOne : format(t.newMembersMany, { count: String(notice.others) });
  }
  if (notice.kind === "birthday_wishes") {
    return notice.others === 1 ? t.birthdayWishesOne : format(t.birthdayWishesMany, { count: String(notice.others) });
  }
  if (notice.kind === "holiday") return format(t.holidayToday, { holiday: notice.holiday, country: notice.country });
  const names = [...new Set(notice.categories.map((key) => categoryName(key, t)))];
  const reasons = names.join(listSeparator);
  if (notice.kind === "video_flagged") {
    return names.length === 0 ? t.videoFlagged : format(t.videoFlaggedReasons, { reasons });
  }
  return names.length === 0 ? t.recordingFlagged : format(t.recordingFlaggedReasons, { reasons });
}
