// Rules for "for your eyes only" (view-once) photo/video messages. Pure, so both the server actions and the chat
// client use the same constants and decisions. The storage side is in storage.ts (private bucket) and
// view-once-media.ts; the actions are in app/actions/view-once.ts.

import { messagesEn } from "@/lib/i18n/en";

/** An unopened view-once message's file is deleted this long after it was sent. */
export const VIEW_ONCE_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * After the recipient's first open, a fresh download link can be issued for this long (and only while the file still
 * exists) — covers a download that failed.
 */
export const VIEW_ONCE_RETRY_WINDOW_MS = 2 * 60 * 1000;
export const VIEW_ONCE_DOWNLOAD_URL_TTL_SECONDS = 60;
/** Slack for clock differences and a request already on its way when its link runs out. */
export const VIEW_ONCE_SWEEP_MARGIN_MS = 60 * 1000;
/**
 * How long after the first open the sweep (or anything else) may delete a file the recipient's app never confirmed:
 * the retry window, plus the life of a link issued at its very last moment, plus the margin. 4 minutes. Anything
 * shorter can delete a file that a still-valid link points at.
 */
export const VIEW_ONCE_SWEEP_AFTER_OPEN_MS =
  VIEW_ONCE_RETRY_WINDOW_MS + VIEW_ONCE_DOWNLOAD_URL_TTL_SECONDS * 1000 + VIEW_ONCE_SWEEP_MARGIN_MS;
/** How long the moderation service has to fetch the image it is checking. */
export const VIEW_ONCE_MODERATION_URL_TTL_SECONDS = 300;

// Same cap as MEDIA_LIMITS["message-image"] in storage.ts (which a client component can't import).
export const VIEW_ONCE_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// The recipient holds the whole file in memory as a Blob, so this is far below the ordinary 2GB video cap.
export const VIEW_ONCE_MAX_VIDEO_BYTES = 64 * 1024 * 1024;
/** The still frame a video is moderated by. Same cap as the "video-thumb" upload kind. */
export const VIEW_ONCE_MAX_FRAME_BYTES = 3 * 1024 * 1024;
export const VIEW_ONCE_FRAME_CONTENT_TYPE = "image/jpeg";

export type ViewOnceMediaType = "IMAGE" | "VIDEO";

const CONTENT_TYPES: Record<string, { mediaType: ViewOnceMediaType; ext: string }> = {
  "image/jpeg": { mediaType: "IMAGE", ext: "jpg" },
  "image/png": { mediaType: "IMAGE", ext: "png" },
  "image/webp": { mediaType: "IMAGE", ext: "webp" },
  "image/gif": { mediaType: "IMAGE", ext: "gif" },
  "video/mp4": { mediaType: "VIDEO", ext: "mp4" },
  "video/webm": { mediaType: "VIDEO", ext: "webm" },
  "video/quicktime": { mediaType: "VIDEO", ext: "mov" },
};

/** What a content type is as view-once media, or null if it isn't allowed. */
export function viewOnceContentType(contentType: string) {
  return Object.hasOwn(CONTENT_TYPES, contentType) ? CONTENT_TYPES[contentType] : null;
}

/**
 * Whether this device can play a video of this type — asked BEFORE the one view is claimed, so an iPhone's .mov
 * isn't used up on a browser that can't show it. `canPlayType` is the video element's own method; "" is its "no".
 * A photo is never refused here.
 */
export function viewOnceCanPlay(contentType: string, canPlayType: (type: string) => string): boolean {
  if (viewOnceContentType(contentType)?.mediaType !== "VIDEO") return true;
  return canPlayType(contentType) !== "";
}

export function viewOnceMaxBytes(mediaType: ViewOnceMediaType) {
  return mediaType === "IMAGE" ? VIEW_ONCE_MAX_IMAGE_BYTES : VIEW_ONCE_MAX_VIDEO_BYTES;
}

function time(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return new Date(value).getTime();
}

type ViewOnceTimes = {
  viewOnceOpenedAt: Date | string | null;
  viewOnceExpiresAt: Date | string | null;
};

/**
 * What the recipient's "open" request should do:
 * - `claim`: never opened and not expired — the caller must still win the atomic claim in the database.
 * - `reissue`: already opened, but inside the retry window and the file is still there.
 * - `already_viewed` / `expired`: nothing to show.
 */
export type ViewOnceOpenDecision = "claim" | "reissue" | "already_viewed" | "expired";

export function viewOnceOpenDecision(
  message: ViewOnceTimes & { hasMedia: boolean },
  now: number,
): ViewOnceOpenDecision {
  const openedAt = time(message.viewOnceOpenedAt);
  if (openedAt !== null) {
    return message.hasMedia && now - openedAt <= VIEW_ONCE_RETRY_WINDOW_MS ? "reissue" : "already_viewed";
  }
  const expiresAt = time(message.viewOnceExpiresAt);
  if (!message.hasMedia || (expiresAt !== null && expiresAt <= now)) return "expired";
  return "claim";
}

/** Whether this message's file should be deleted now, without waiting for the recipient's app to confirm it. */
export function viewOnceMediaIsDue(message: ViewOnceTimes, now: number): boolean {
  const openedAt = time(message.viewOnceOpenedAt);
  if (openedAt !== null) return now - openedAt > VIEW_ONCE_SWEEP_AFTER_OPEN_MS;
  const expiresAt = time(message.viewOnceExpiresAt);
  return expiresAt !== null && expiresAt <= now;
}

/** What a view-once bubble shows. `available` is the only state with something to tap, and only the recipient gets it. */
export type ViewOnceState = "sending" | "sent" | "available" | "opened" | "expired";

export function viewOnceState(
  message: ViewOnceTimes & { mine: boolean; sending?: boolean },
  now: number,
): ViewOnceState {
  if (message.sending) return "sending";
  if (time(message.viewOnceOpenedAt) !== null) return "opened";
  const expiresAt = time(message.viewOnceExpiresAt);
  if (expiresAt !== null && expiresAt <= now) return "expired";
  return message.mine ? "sent" : "available";
}

/** `labels` is the chat's wording in the reader's language (src/lib/i18n); English when left out. */
export function viewOnceLabel(
  state: ViewOnceState,
  mediaType: ViewOnceMediaType,
  labels: typeof messagesEn.thread.viewOnce.chip = messagesEn.thread.viewOnce.chip,
): string {
  switch (state) {
    case "sending":
    case "sent":
    case "available":
      return labels[state][mediaType];
    case "opened":
    case "expired":
      return labels[state];
  }
}
