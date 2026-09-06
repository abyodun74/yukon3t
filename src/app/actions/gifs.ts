"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { searchGifs, isGiphyConfigured } from "@/lib/giphy";

/** Shared GIF search for the message/comment/post composers — see GifPickerButton. */
export async function searchGiphyGifs(query: string) {
  const user = await requireVerifiedUser();

  if (!isGiphyConfigured) return { error: "not_configured" as const, gifs: [] };

  const allowed = await checkRateLimit("gifSearch", user.id);
  if (!allowed) return { error: "rate_limited" as const, gifs: [] };

  const gifs = await searchGifs(query);
  return { error: null, gifs };
}
