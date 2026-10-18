import { describe, expect, it } from "vitest";
import {
  AVATAR_PRESIGN_TTL_SECONDS,
  AVATAR_REDIRECT_MAX_AGE_SECONDS,
  avatarFullSizeUrl,
  avatarKeyForViewer,
  avatarPresignSigningDate,
  isAvatarRouteUrl,
  parseAvatarRouteSegments,
  parseAvatarRouteUrl,
  routeUrlForPublicAvatarKey,
  twoSizeAvatar,
} from "./avatar-url";
import { isPrivateKeyOwnedBy, privateObjectKey } from "./storage";

const OWNER = "cmabc123def456ghi789jkl0";
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("parseAvatarRouteSegments", () => {
  it("maps a two-size path to the thumbnail and the hidden full-size key", () => {
    expect(parseAvatarRouteSegments([OWNER, `${UUID}-t.webp`])).toEqual({
      ownerId: OWNER,
      thumbKey: `avatar/${OWNER}/${UUID}-t.webp`,
      fullKey: `avatar/${OWNER}/${UUID}-f.webp`,
      twoSize: true,
    });
  });

  it("maps a single-image path (the backfill's) to one key for both sizes", () => {
    const target = parseAvatarRouteSegments([OWNER, `${UUID}.jpg`]);
    expect(target).toEqual({
      ownerId: OWNER,
      thumbKey: `avatar/${OWNER}/${UUID}.jpg`,
      fullKey: `avatar/${OWNER}/${UUID}.jpg`,
      twoSize: false,
    });
  });

  it("rejects path traversal, encoded separators and extra or missing segments", () => {
    for (const segments of [
      ["..", `${UUID}.jpg`],
      [OWNER, `../${UUID}.jpg`],
      [OWNER, `..%2F${UUID}.jpg`],
      [`${OWNER}%2F..`, `${UUID}.jpg`],
      [OWNER, "..", `${UUID}.jpg`],
      [OWNER, `${UUID}.jpg`, "x"],
      [`${UUID}.jpg`],
      [],
      [OWNER, ""],
      ["", `${UUID}.jpg`],
      [OWNER, `${UUID}.jpg/`],
      [OWNER, `${UUID}.jpg\u0000`],
      [OWNER, `${UUID}.JPG`],
    ]) {
      expect(parseAvatarRouteSegments(segments), segments.join("/")).toBeNull();
    }
    expect(parseAvatarRouteSegments(null)).toBeNull();
    expect(parseAvatarRouteSegments(undefined)).toBeNull();
  });

  it("never addresses the full-size file, an upload key, or another namespace directly", () => {
    expect(parseAvatarRouteSegments([OWNER, `${UUID}-f.webp`])).toBeNull();
    expect(parseAvatarRouteSegments([OWNER, `${UUID}-x.webp`])).toBeNull();
    expect(parseAvatarRouteSegments(["avatar-upload", OWNER, `${UUID}.jpg`])).toBeNull();
    // An owner segment that looks like another namespace still only reaches avatar/<that>/… in the avatar bucket.
    expect(parseAvatarRouteSegments(["view-once-final", `${UUID}.jpg`])?.thumbKey).toBe(
      `avatar/view-once-final/${UUID}.jpg`,
    );
    expect(parseAvatarRouteSegments([OWNER, `${UUID}.gif`])).toBeNull();
    expect(parseAvatarRouteSegments([OWNER, `${UUID}.mp4`])).toBeNull();
    expect(parseAvatarRouteSegments([OWNER, "not-a-uuid.jpg"])).toBeNull();
  });

  it("only ever produces keys under avatar/<owner>/", () => {
    const target = parseAvatarRouteSegments([OWNER, `${UUID}-t.png`])!;
    for (const key of [target.thumbKey, target.fullKey]) {
      expect(key.startsWith(`avatar/${OWNER}/`)).toBe(true);
      expect(key.split("/")).toHaveLength(3);
    }
  });
});

describe("route-form URLs", () => {
  const thumb = `/api/avatar/${OWNER}/${UUID}-t.webp`;

  it("recognises the route form, with or without a query, and nothing else", () => {
    expect(isAvatarRouteUrl(thumb)).toBe(true);
    expect(parseAvatarRouteUrl(`${thumb}?size=full`)?.ownerId).toBe(OWNER);
    expect(isAvatarRouteUrl(`https://pub-123.r2.dev/avatar/${OWNER}/${UUID}.jpg`)).toBe(false);
    expect(isAvatarRouteUrl(`https://evil.example/api/avatar/${OWNER}/${UUID}.jpg`)).toBe(false);
    expect(isAvatarRouteUrl(`/api/avatar/${OWNER}/../${UUID}.jpg`)).toBe(false);
    expect(isAvatarRouteUrl(null)).toBe(false);
    expect(isAvatarRouteUrl("")).toBe(false);
  });

  it("asks for the full size only for a route-form URL", () => {
    expect(avatarFullSizeUrl(thumb)).toBe(`${thumb}?size=full`);
    expect(avatarFullSizeUrl(`${thumb}?size=full`)).toBe(`${thumb}?size=full`);
    const publicUrl = `https://pub-123.r2.dev/avatar/${OWNER}/${UUID}.jpg`;
    expect(avatarFullSizeUrl(publicUrl)).toBe(publicUrl);
  });

  it("builds a new two-size avatar whose route path parses back to its own keys", () => {
    const built = twoSizeAvatar(OWNER, UUID, "webp");
    expect(parseAvatarRouteUrl(built.routeUrl)).toEqual({
      ownerId: OWNER,
      thumbKey: built.thumbKey,
      fullKey: built.fullKey,
      twoSize: true,
    });
  });
});

describe("routeUrlForPublicAvatarKey (backfill)", () => {
  it("maps a public avatar key to the single-image route form of the same key", () => {
    const mapped = routeUrlForPublicAvatarKey(`avatar/${OWNER}/${UUID}.jpg`);
    expect(mapped).toEqual({ ownerId: OWNER, routeUrl: `/api/avatar/${OWNER}/${UUID}.jpg` });
    expect(parseAvatarRouteUrl(mapped!.routeUrl)?.thumbKey).toBe(`avatar/${OWNER}/${UUID}.jpg`);
  });

  it("skips anything that isn't exactly an avatar upload key", () => {
    for (const key of [
      `post-image/${OWNER}/${UUID}.jpg`,
      `avatar/${OWNER}/${UUID}.gif`,
      `avatar/${OWNER}/../${UUID}.jpg`,
      `avatar/${OWNER}/${UUID}-t.jpg`,
      `avatar/${OWNER}/sub/${UUID}.jpg`,
      "",
    ]) {
      expect(routeUrlForPublicAvatarKey(key), key).toBeNull();
    }
  });
});

describe("avatarKeyForViewer", () => {
  const two = parseAvatarRouteSegments([OWNER, `${UUID}-t.webp`])!;
  const single = parseAvatarRouteSegments([OWNER, `${UUID}.webp`])!;

  it("serves the thumbnail by default, to everyone", () => {
    for (const who of [
      { isOwner: true, isConnection: false },
      { isOwner: false, isConnection: true },
      { isOwner: false, isConnection: false },
    ]) {
      expect(avatarKeyForViewer(two, { wantFull: false, ...who })).toBe(two.thumbKey);
    }
  });

  it("serves the full size only to the owner and accepted connections; others get the thumbnail", () => {
    expect(avatarKeyForViewer(two, { wantFull: true, isOwner: true, isConnection: false })).toBe(two.fullKey);
    expect(avatarKeyForViewer(two, { wantFull: true, isOwner: false, isConnection: true })).toBe(two.fullKey);
    expect(avatarKeyForViewer(two, { wantFull: true, isOwner: false, isConnection: false })).toBe(two.thumbKey);
  });

  it("serves a single-image avatar's one file either way", () => {
    expect(avatarKeyForViewer(single, { wantFull: true, isOwner: false, isConnection: false })).toBe(single.thumbKey);
  });
});

describe("presign timing", () => {
  it("signs as of the start of the hour, so the link is stable within it", () => {
    const at = Date.UTC(2026, 9, 19, 14, 59, 59, 999);
    expect(avatarPresignSigningDate(at).toISOString()).toBe("2026-10-19T14:00:00.000Z");
    expect(avatarPresignSigningDate(Date.UTC(2026, 9, 19, 14, 0, 0)).getTime()).toBe(Date.UTC(2026, 9, 19, 14));
  });

  it("never lets a cached redirect outlive the link it points at", () => {
    // Worst case: the redirect is minted at the very end of the hour (link expires one TTL after the hour began).
    const remainingAtWorst = AVATAR_PRESIGN_TTL_SECONDS - 3600;
    expect(AVATAR_REDIRECT_MAX_AGE_SECONDS).toBeLessThan(remainingAtWorst);
  });
});

describe("avatar upload keys", () => {
  it("are owned only by their uploader, and never pass as a served key", () => {
    const key = privateObjectKey("avatar-upload", OWNER, "webp");
    expect(isPrivateKeyOwnedBy(key, "avatar-upload", OWNER)).toBe(true);
    expect(isPrivateKeyOwnedBy(key, "avatar-upload", "someone-else")).toBe(false);
    expect(isPrivateKeyOwnedBy(key, "view-once", OWNER)).toBe(false);
    expect(isPrivateKeyOwnedBy(`avatar/${OWNER}/${UUID}-t.webp`, "avatar-upload", OWNER)).toBe(false);
    expect(isPrivateKeyOwnedBy(`avatar-upload/${OWNER}/../${UUID}.webp`, "avatar-upload", OWNER)).toBe(false);
  });
});
