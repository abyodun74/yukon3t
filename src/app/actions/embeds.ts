"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { resolveSharedEmbedLink } from "@/lib/resolve-share-link";

/**
 * Resolves a bare shared link to a directly-embeddable video URL by
 * following its redirect chain (see resolve-share-link.ts) — not specific
 * to any one app, since any Share sheet can hand over a short/tracking
 * link instead of a direct one. Used by post-composer.tsx's incoming
 * Share-target handling so a video shared in from another app lands as a
 * real embedded player instead of a bare, unclickable link —
 * createPost still independently re-parses whatever URL this hands back
 * before ever trusting it, same as any other pasted link.
 */
export async function resolveSharedVideoLink(url: string) {
  await requireVerifiedUser();
  const resolved = await resolveSharedEmbedLink(url);
  return { url: resolved };
}
