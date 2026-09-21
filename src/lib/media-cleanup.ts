import { deleteObject, keyFromPublicUrl } from "@/lib/storage";
import { findReferencedUrls } from "@/lib/upload-records";

/**
 * Deletes the stored files behind `urls` — but only those nothing else still points at. A video can be used by more
 * than one row: a post shared to Muse or to a Story, a Muse reshared to Home, a Muse sent to a friend as a message all
 * reuse the same file instead of copying it. Deleting the original then used to break every one of those copies.
 * Call this AFTER the row(s) being removed are gone, so they don't count as references themselves.
 *
 * Fails safe: if the reference check itself errors, nothing is deleted (a leftover file is harmless; a missing one is not).
 */
export async function deleteMediaIfUnreferenced(urls: (string | null | undefined)[]) {
  const list = [...new Set(urls.filter((u): u is string => Boolean(u)))];
  if (list.length === 0) return;
  let referenced: Set<string>;
  try {
    referenced = await findReferencedUrls(list);
  } catch (err) {
    console.error("[media-cleanup] reference check failed — leaving files in place", err);
    return;
  }
  await Promise.all(
    list
      .filter((u) => !referenced.has(u))
      .map((u) => {
        const key = keyFromPublicUrl(u);
        return key ? deleteObject(key) : Promise.resolve();
      }),
  );
}
