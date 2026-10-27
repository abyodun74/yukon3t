import { isPrivateCaller } from "@/lib/call-names";
import type { CallRoster } from "@/lib/use-call-roster";

// Which profile picture a call screen shows for the person on the other end. Pure, so the ring banner, the outgoing
// "Calling" sheet and the in-call screen all decide it the same way (call-avatar.test.ts).
//
// The URL is the stored User.avatarUrl as is: with private avatars that is the same-origin /api/avatar/... route
// form, which the signed-in app (browser or WebView) loads with its session cookie and which serves the thumbnail to
// anyone signed in who isn't blocked either way (see CLAUDE.md "Profile pictures"). Everyone on a call is already
// allowed that much: a 1:1 call needs an accepted connection and an added person is rung by someone in the call.
//
// A caller whose chat the reader has hidden is announced as "Private call" (maskHiddenCallerName); their picture
// would name them just as well, so it is withheld wherever the name is.

/** The caller's picture for a ring, given the name the server is announcing them under. */
export function ringCallerAvatarUrl(maskedName: string | null, avatarUrl: string | null): string | null {
  return isPrivateCaller(maskedName) ? null : avatarUrl;
}

/** The longest picture URL a native ring push carries (an FCM data message is capped at 4KB in all). */
export const NATIVE_RING_AVATAR_URL_MAX_LENGTH = 2048;

/**
 * Whether `url` may go into the native ring push (`callerAvatarUrl`, read by the Android app's
 * CallMessagingService, which downloads it with no cookies): an absolute https URL of bounded length only. A relative
 * same-origin /api/avatar/... route URL would need the signed-in WebView's session cookie, so it never qualifies;
 * the server signs it first (call-avatar-server.ts).
 */
export function isNativeRingAvatarUrl(url: string | null | undefined): url is string {
  if (typeof url !== "string" || url.length === 0 || url.length > NATIVE_RING_AVATAR_URL_MAX_LENGTH) return false;
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The picture for the other person in the call screen's main view. `peerUserId` is the Daily participant's user id
 * when they are in the room; without one (still connecting) it is whoever else the roster lists, if that's exactly
 * one person. `peerName` is the session's label for a 1:1 call, the stand-in for a hidden caller included.
 */
export function callPeerAvatarUrl(
  roster: CallRoster | null | undefined,
  { selfUserId, peerUserId, peerName }: { selfUserId?: string; peerUserId?: string | null; peerName?: string | null },
): string | null {
  if (!roster || roster.over) return null;
  if (!roster.group && isPrivateCaller(peerName)) return null;
  if (peerUserId) return roster.participants.find((p) => p.userId === peerUserId)?.avatarUrl ?? null;
  if (!selfUserId) return null;
  const others = roster.participants.filter((p) => p.userId !== selfUserId);
  return others.length === 1 ? others[0].avatarUrl : null;
}
