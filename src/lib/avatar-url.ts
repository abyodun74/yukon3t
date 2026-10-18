// Private profile pictures (AVATAR_PRIVATE, see CLAUDE.md "Profile pictures"): the pure, client-safe half. Nothing
// here touches R2, the database or the environment, so it is unit-tested directly (avatar-url.test.ts) and can be
// imported by client components.
//
// A private avatar is stored in User.avatarUrl as a same-origin route path, never as a storage URL:
//
//   /api/avatar/<ownerId>/<uuid>-t.<ext>   a new upload: a thumbnail (served by default) and a full-size image
//   /api/avatar/<ownerId>/<uuid>.<ext>     a single image used for both sizes (what the backfill produces)
//
// and the objects live in the private avatar bucket (R2_AVATAR_BUCKET_NAME) under
//
//   avatar/<ownerId>/<uuid>-t.<ext> + avatar/<ownerId>/<uuid>-f.<ext>   (two sizes)
//   avatar/<ownerId>/<uuid>.<ext>                                       (single image)
//
// The full-size object of a two-size avatar is never addressable by path: the route only accepts the "-t" or the
// single form, and serves the "-f" object only for `?size=full` to the owner and their accepted connections.

export const AVATAR_ROUTE_PREFIX = "/api/avatar/";

/** Extensions an avatar can have: exactly the avatar upload allowlist in storage.ts (jpeg/png/webp). */
export const AVATAR_EXTENSIONS = ["jpg", "png", "webp"] as const;
export type AvatarExtension = (typeof AVATAR_EXTENSIONS)[number];

/** Long side, in pixels, of the two images a new private avatar is uploaded as (upload-client.ts resizes to these). */
export const AVATAR_THUMB_DIMENSION = 320;
export const AVATAR_FULL_DIMENSION = 1080;
/** A 320px thumbnail is tens of KB; this only bounds a client that skips the resize. The full image keeps MEDIA_LIMITS.avatar. */
export const AVATAR_THUMB_MAX_BYTES = 2 * 1024 * 1024;

// Presigned GETs the route redirects to are signed as of the start of the current hour and valid for two hours, so
// the same avatar gets the same URL for a whole hour (browser-cacheable) and any URL handed out is still valid for at
// least an hour. The redirect itself may be cached for less than that, so a cached redirect never points at an
// expired link.
export const AVATAR_PRESIGN_TTL_SECONDS = 2 * 60 * 60;
export const AVATAR_REDIRECT_MAX_AGE_SECONDS = 3000;
const HOUR_MS = 60 * 60 * 1000;

// cuid today; anything else this app ever used for an id is still letters, digits, "_" or "-". Never "/", "." or "%".
const OWNER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROUTE_FILE_RE = new RegExp(`^(${UUID})(-t)?\\.(jpg|png|webp)$`);
const PUBLIC_KEY_RE = new RegExp(`^avatar/([A-Za-z0-9_-]{1,64})/(${UUID})\\.(jpg|png|webp)$`);

export type AvatarRouteTarget = {
  ownerId: string;
  /** What everyone signed in gets by default. */
  thumbKey: string;
  /** What `?size=full` gets for the owner and their connections. Same as thumbKey for a single-image avatar. */
  fullKey: string;
  twoSize: boolean;
};

/**
 * The route's catch-all segments ([ownerId, file]) → the private-bucket keys they stand for, or null for anything
 * that isn't exactly an avatar path. Strict on purpose: no other prefix, no extra segment, no "..", no encoded
 * separators (they fail the character classes), and never the "-f" full-size file directly.
 */
export function parseAvatarRouteSegments(segments: readonly string[] | undefined | null): AvatarRouteTarget | null {
  if (!segments || segments.length !== 2) return null;
  const [ownerId, file] = segments;
  if (typeof ownerId !== "string" || typeof file !== "string") return null;
  if (!OWNER_ID_RE.test(ownerId)) return null;
  const match = ROUTE_FILE_RE.exec(file);
  if (!match) return null;
  const [, uuid, thumbSuffix, ext] = match;
  if (thumbSuffix) {
    return {
      ownerId,
      thumbKey: `avatar/${ownerId}/${uuid}-t.${ext}`,
      fullKey: `avatar/${ownerId}/${uuid}-f.${ext}`,
      twoSize: true,
    };
  }
  const key = `avatar/${ownerId}/${uuid}.${ext}`;
  return { ownerId, thumbKey: key, fullKey: key, twoSize: false };
}

/** A stored/rendered avatar URL in route form (relative, optionally with a query) → its target, else null. */
export function parseAvatarRouteUrl(url: string | null | undefined): AvatarRouteTarget | null {
  if (!url || !url.startsWith(AVATAR_ROUTE_PREFIX)) return null;
  const path = url.split(/[?#]/, 1)[0];
  return parseAvatarRouteSegments(path.slice(AVATAR_ROUTE_PREFIX.length).split("/"));
}

export function isAvatarRouteUrl(url: string | null | undefined): boolean {
  return parseAvatarRouteUrl(url) !== null;
}

/** Route form of a new two-size avatar, plus the private-bucket keys its two images are stored under. */
export function twoSizeAvatar(ownerId: string, uuid: string, ext: AvatarExtension) {
  return {
    routeUrl: `${AVATAR_ROUTE_PREFIX}${ownerId}/${uuid}-t.${ext}`,
    thumbKey: `avatar/${ownerId}/${uuid}-t.${ext}`,
    fullKey: `avatar/${ownerId}/${uuid}-f.${ext}`,
  };
}

/**
 * A public-bucket avatar key (`avatar/<ownerId>/<uuid>.<ext>`, what createUploadUrl minted) → the route form of the
 * same image copied to the private bucket under the same key, or null if the key isn't one (the backfill skips it).
 */
export function routeUrlForPublicAvatarKey(key: string): { ownerId: string; routeUrl: string } | null {
  const match = PUBLIC_KEY_RE.exec(key);
  if (!match) return null;
  const [, ownerId, uuid, ext] = match;
  return { ownerId, routeUrl: `${AVATAR_ROUTE_PREFIX}${ownerId}/${uuid}.${ext}` };
}

/** The URL to enlarge an avatar with: route form asks for the full size (the route decides who gets it); anything else as is. */
export function avatarFullSizeUrl(url: string): string {
  return isAvatarRouteUrl(url) ? `${url.split(/[?#]/, 1)[0]}?size=full` : url;
}

/** Which object a viewer gets. Full size only when asked for AND the viewer is the owner or an accepted connection. */
export function avatarKeyForViewer(
  target: AvatarRouteTarget,
  { wantFull, isOwner, isConnection }: { wantFull: boolean; isOwner: boolean; isConnection: boolean },
): string {
  return wantFull && (isOwner || isConnection) ? target.fullKey : target.thumbKey;
}

/** Signing time for a presigned avatar GET: the start of the current hour, so the URL is stable within it. */
export function avatarPresignSigningDate(nowMs: number): Date {
  return new Date(Math.floor(nowMs / HOUR_MS) * HOUR_MS);
}
