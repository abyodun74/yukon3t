// Private profile pictures: the server half shared by the upload actions, the route and every consumer that hands an
// avatar URL to something outside the signed-in app. Pure URL rules are in avatar-url.ts.
import {
  AVATAR_PRESIGN_TTL_SECONDS,
  avatarPresignSigningDate,
  parseAvatarRouteUrl,
} from "@/lib/avatar-url";
import {
  deleteAvatarObject,
  deleteObject,
  isAvatarBucketConfigured,
  keyBelongsToOwner,
  keyFromPublicUrl,
  presignAvatarGet,
} from "@/lib/storage";

/** Cache-Control R2 answers a presigned avatar GET with: private (per browser), and never past the link's own life. */
export const AVATAR_IMAGE_CACHE_CONTROL = "private, max-age=3600";

/** Presigned GET for an avatar object, signed as of the start of the hour so it stays the same URL for that hour. */
export function presignAvatarForViewer(key: string, nowMs = Date.now()) {
  return presignAvatarGet(key, {
    expiresIn: AVATAR_PRESIGN_TTL_SECONDS,
    signingDate: avatarPresignSigningDate(nowMs),
    cacheControl: AVATAR_IMAGE_CACHE_CONTROL,
  });
}

/**
 * For a consumer OUTSIDE the signed-in app (today: the widget feed, GET /api/ambient/feed, which authenticates with
 * a bearer token, not the session cookie the route needs): a route-form avatar becomes an absolute presigned URL to
 * its thumbnail, valid for at least an hour. Any other URL (a still-public avatar) is returned unchanged. Null if the
 * private avatar can't be signed, so the consumer shows initials instead of a broken link.
 */
export async function avatarUrlForExternalClient(url: string | null): Promise<string | null> {
  const target = parseAvatarRouteUrl(url);
  if (!target) return url;
  if (!isAvatarBucketConfigured()) return null;
  try {
    return await presignAvatarForViewer(target.thumbKey);
  } catch (err) {
    console.error("[avatar] failed to sign an avatar for an external client", err);
    return null;
  }
}

/** For a file the user keeps (their data export): a route-form avatar becomes an absolute link on the site. */
export function absoluteAvatarUrl(url: string | null): string | null {
  if (!url || !parseAvatarRouteUrl(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://yukon3t.com").replace(/\/$/, "");
  return `${base}${url}`;
}

/**
 * Deletes the stored object(s) behind a user's previous avatar, whichever form it was in: a public R2 URL (today's
 * uploads) or a route-form private avatar (both sizes). Only keys that belong to `ownerId` are touched, so a stray or
 * foreign URL in the column can never delete someone else's object. Best effort, never throws.
 */
export async function deleteStoredAvatar(url: string | null, ownerId: string) {
  if (!url) return;
  const target = parseAvatarRouteUrl(url);
  if (target) {
    if (target.ownerId !== ownerId) return;
    const keys = target.twoSize ? [target.thumbKey, target.fullKey] : [target.thumbKey];
    await Promise.all(keys.map((key) => deleteAvatarObject(key)));
    return;
  }
  const publicKey = keyFromPublicUrl(url);
  if (publicKey && keyBelongsToOwner(publicKey, ownerId)) {
    await deleteObject(publicKey);
  }
}
