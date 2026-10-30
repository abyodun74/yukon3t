import { deleteOwnedObject, keyFromPublicUrl } from "@/lib/storage";

/**
 * Deletes the caller's own uploads behind these public URLs: the "clean up a rejected upload" step every composer
 * action runs. Each key goes through deleteOwnedObject's ownership check, so a stranger's URL slipped into a
 * submission is skipped rather than deleted; a URL outside this app's bucket is skipped too. Independent keys, so the
 * deletes run in parallel.
 *
 * Kept out of storage.ts on purpose: the action tests mock "@/lib/storage" and assert on deleteOwnedObject, which only
 * sees these calls when they cross the module boundary.
 */
export async function deleteOwnedUploads(urls: readonly string[], ownerId: string) {
  await Promise.all(
    urls.map((url) => {
      const key = keyFromPublicUrl(url);
      return key ? deleteOwnedObject(key, ownerId) : Promise.resolve();
    }),
  );
}
