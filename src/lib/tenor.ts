const apiKey = process.env.TENOR_API_KEY;

export const isTenorConfigured = !!apiKey;

/**
 * This is the only thing standing between "pick a GIF from search results"
 * and "attach an arbitrary external URL," since GIF messages/posts/comments
 * deliberately skip the R2 ownership/size check and this app's own
 * moderation pipeline (Tenor's own catalog is pre-moderated). The `.` before
 * the suffix is load-bearing — without it, "evil-tenor.com" would also
 * satisfy a bare `endsWith("tenor.com")` check. Never widen this to a
 * generic https: check.
 */
export function isTenorUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "https:" && (hostname === "tenor.com" || hostname.endsWith(".tenor.com"));
  } catch {
    return false;
  }
}

export type TenorGif = { id: string; gifUrl: string; previewUrl: string };

/** Best-effort — an outage or missing key returns an empty result set rather than throwing, same contract as isCallingConfigured()/isFcmConfigured(). */
export async function searchGifs(query: string, limit = 24): Promise<TenorGif[]> {
  if (!isTenorConfigured || !query.trim()) return [];

  const url = new URL("https://tenor.googleapis.com/v2/search");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey!);
  url.searchParams.set("client_key", "yukon3t");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("media_filter", "gif,tinygif");
  url.searchParams.set("contentfilter", "high");

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: { id: string; media_formats?: { gif?: { url: string }; tinygif?: { url: string } } }[];
    };
    return (data.results ?? [])
      .filter((r) => r.media_formats?.gif?.url)
      .map((r) => ({
        id: r.id,
        gifUrl: r.media_formats!.gif!.url,
        previewUrl: r.media_formats?.tinygif?.url ?? r.media_formats!.gif!.url,
      }));
  } catch {
    return [];
  }
}
