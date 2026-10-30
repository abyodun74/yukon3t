// Pure checks on R2 object keys handed back by a client. Keys are minted as `${kind}/${userId}/${uuid}.${ext}`
// (storage.ts createUploadUrl), so the first segment is the upload kind and the second the uploader. An action that
// stores, moderates or deletes a client-supplied key must check BOTH: owner alone lets someone reuse their own upload
// of another kind (e.g. a 2GB "video" as a "thumbnail"), kind alone lets them name someone else's file.

/** The upload kind a key was minted for (its first path segment). */
export function uploadKindOfKey(key: string): string {
  return key.split("/")[0] ?? "";
}

/** `key` was minted for `kind` and for `ownerId`, with nothing odd in the path. */
export function isOwnedUploadKey(key: string, kind: string, ownerId: string): boolean {
  const parts = key.split("/");
  return (
    parts.length === 3 &&
    parts[0] === kind &&
    parts[1] === ownerId &&
    parts[2].length > 0 &&
    !key.includes("..") &&
    !key.includes("\\")
  );
}

/** A Circle cover object (any uploader): the only kind confirmCircleCoverUpload may delete as "the previous cover". */
export function isCircleCoverKey(key: string): boolean {
  const parts = key.split("/");
  return parts.length === 3 && parts[0] === "circle-cover" && parts[1].length > 0 && parts[2].length > 0 && !key.includes("..");
}
