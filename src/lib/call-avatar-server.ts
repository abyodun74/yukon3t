// The caller's picture for the native Android ring notification (FCM `callerAvatarUrl`, see fcm.ts and
// android/.../CallMessagingService.java). Server-only: it signs private avatars.
//
// Same rule as every other ring surface (call-avatar.ts): a caller announced as "Private call" (the callee hid their
// chat) has no picture, because the picture would name them. Otherwise the stored avatar becomes a short-lived,
// absolute, presigned link to the thumbnail only (avatarUrlForRing), since the native code fetching it has no session
// cookie. Anything that isn't a usable absolute https URL is dropped, so the ring simply shows no picture.
import { isNativeRingAvatarUrl, ringCallerAvatarUrl } from "@/lib/call-avatar";
import { avatarUrlForRing } from "@/lib/avatar-storage";

/** `maskedName` is what maskHiddenCallerName returned for this callee. Never throws; null means no picture. */
export async function nativeRingCallerAvatarUrl(maskedName: string | null, avatarUrl: string | null): Promise<string | null> {
  const visible = ringCallerAvatarUrl(maskedName, avatarUrl);
  if (!visible) return null;
  try {
    const external = await avatarUrlForRing(visible);
    return isNativeRingAvatarUrl(external) ? external : null;
  } catch {
    return null;
  }
}
