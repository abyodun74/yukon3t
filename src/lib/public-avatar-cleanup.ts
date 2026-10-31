// Stage 3 of private profile pictures (scripts/delete-public-avatars.ts): the pure decision of whether one object under
// the PUBLIC bucket's `avatar/` prefix may be deleted. No R2, database or environment access here, so every rule is
// unit-tested (public-avatar-cleanup.test.ts). Anything that fails a check is skipped and reported, never deleted.
import { routeUrlForPublicAvatarKey } from "@/lib/avatar-url";

/** One row of the mapping file the 2026-10-19 backfill wrote (old public URL -> route form; that script is removed). */
export type AvatarMigrationEntry = { userId: string; oldUrl: string; newUrl: string; migratedAt: string };

/** What the private avatar bucket says about the same key: its object, none, or the HEAD failed. */
export type PrivateCopy = { size: number; contentType: string } | null | "error";

export type PublicAvatarVerdict =
  | { key: string; deletable: true; routeUrl: string; inMapping: boolean }
  | { key: string; deletable: false; reason: string };

/**
 * Parses the mapping file into public key -> entry. The key is the URL's path, so it doesn't depend on R2_PUBLIC_URL
 * being exactly what it was when the file was written. Throws on anything that isn't a well-formed mapping file: a
 * malformed file is a reason to stop, not to guess.
 */
export function parseAvatarMigrationMap(json: unknown): Map<string, AvatarMigrationEntry> {
  if (!Array.isArray(json)) throw new Error("not a mapping file (expected a JSON array)");
  const byKey = new Map<string, AvatarMigrationEntry>();
  for (const e of json as AvatarMigrationEntry[]) {
    if (typeof e?.userId !== "string" || typeof e.oldUrl !== "string" || typeof e.newUrl !== "string") {
      throw new Error("mapping file has a malformed entry");
    }
    let path: string;
    try {
      const url = new URL(e.oldUrl);
      if (url.protocol !== "https:") throw new Error();
      path = url.pathname.replace(/^\/+/, "");
    } catch {
      throw new Error("mapping file has an entry whose oldUrl is not an https URL");
    }
    // The first record for a key is the original migration (later re-runs only append, never rewrite).
    if (!byKey.has(path)) byKey.set(path, e);
  }
  return byKey;
}

/**
 * Whether one public `avatar/…` object may be deleted. All of these must hold:
 * - the key is exactly an avatar key this app minted (`avatar/<ownerId>/<uuid>.<jpg|png|webp>`);
 * - nothing in the database references it, other than through its own route form (`/api/avatar/…`, which is served
 *   from the private copy);
 * - if the mapping file lists it, the mapping agrees on the route form it was migrated to;
 * - the private avatar bucket has a copy under the same key, non-empty and the same size as the public object.
 */
export function verifyPublicAvatarForDeletion(input: {
  key: string;
  publicSize: number;
  privateCopy: PrivateCopy;
  referencedBy: readonly string[];
  mappingEntry: AvatarMigrationEntry | undefined;
}): PublicAvatarVerdict {
  const { key, publicSize, privateCopy, referencedBy, mappingEntry } = input;
  const mapped = routeUrlForPublicAvatarKey(key);
  if (!mapped) return { key, deletable: false, reason: "not an avatar key this app minted" };
  if (referencedBy.length > 0) {
    return { key, deletable: false, reason: `still referenced in the database (${referencedBy.join(", ")})` };
  }
  if (mappingEntry && (mappingEntry.newUrl !== mapped.routeUrl || mappingEntry.userId !== mapped.ownerId)) {
    return { key, deletable: false, reason: "the mapping file disagrees with the key scheme" };
  }
  if (privateCopy === "error") return { key, deletable: false, reason: "could not check the private copy" };
  if (privateCopy === null) return { key, deletable: false, reason: "no private copy" };
  if (privateCopy.size === 0 || privateCopy.size !== publicSize) {
    return { key, deletable: false, reason: `private copy size differs (${privateCopy.size} vs ${publicSize} bytes)` };
  }
  return { key, deletable: true, routeUrl: mapped.routeUrl, inMapping: Boolean(mappingEntry) };
}
