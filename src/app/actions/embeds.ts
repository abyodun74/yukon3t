"use server";

import { z } from "zod";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { SHARED_LINK_MAX_LENGTH, resolveSharedEmbedLink } from "@/lib/resolve-share-link";

const sharedLinkSchema = z.string().trim().url().max(SHARED_LINK_MAX_LENGTH);

/**
 * Resolves a bare shared link to a directly-embeddable video URL by
 * following its redirect chain (see resolve-share-link.ts) — not specific
 * to any one app, since any Share sheet can hand over a short/tracking
 * link instead of a direct one. Used by post-composer.tsx's incoming
 * Share-target handling so a video shared in from another app lands as a
 * real embedded player instead of a bare, unclickable link —
 * createPost still independently re-parses whatever URL this hands back
 * before ever trusting it, same as any other pasted link.
 *
 * Every call makes the server request a caller-chosen host, so it is validated (a URL string, at most 2048 chars)
 * and limited per user (`linkResolve`, which fails closed); anything refused answers `{ url: null }`, which the
 * composer already treats as "not a video link".
 */
export async function resolveSharedVideoLink(url: unknown) {
  const user = await requireVerifiedUser();
  const parsed = sharedLinkSchema.safeParse(url);
  if (!parsed.success) return { url: null };
  if (!(await checkRateLimit("linkResolve", user.id))) return { url: null };
  const resolved = await resolveSharedEmbedLink(parsed.data);
  return { url: resolved };
}
