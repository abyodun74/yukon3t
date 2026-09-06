const apiKey = process.env.GIPHY_API_KEY;

export const isGiphyConfigured = !!apiKey;

/**
 * Giphy serves GIFs from these `*.giphy.com` subdomains (media.giphy.com,
 * the numbered media0-4.giphy.com load-balancing hosts, i.giphy.com,
 * cdn.giphy.com) — this is the only thing standing between "pick a GIF
 * from search results" and "attach an arbitrary external URL," since GIF
 * messages/posts/comments deliberately skip the R2 ownership/size check
 * and this app's own moderation pipeline (Giphy's own catalog is
 * pre-moderated). The `.` before the suffix is load-bearing — without it,
 * "evil-giphy.com" would also satisfy a bare `endsWith("giphy.com")`
 * check. Never widen this to a generic https: check.
 */
export function isGiphyUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "https:" && (hostname === "giphy.com" || hostname.endsWith(".giphy.com"));
  } catch {
    return false;
  }
}

export type GiphyGif = { id: string; gifUrl: string; previewUrl: string };

/** Best-effort — an outage or missing key returns an empty result set rather than throwing, same contract as isCallingConfigured()/isFcmConfigured(). */
export async function searchGifs(query: string, limit = 24): Promise<GiphyGif[]> {
  if (!isGiphyConfigured || !query.trim()) return [];

  const url = new URL("https://api.giphy.com/v1/gifs/search");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey!);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("rating", "g");

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { id: string; images?: { original?: { url: string }; fixed_width_small?: { url: string } } }[];
    };
    return (data.data ?? [])
      .filter((g) => g.images?.original?.url)
      .map((g) => ({
        id: g.id,
        gifUrl: g.images!.original!.url,
        previewUrl: g.images?.fixed_width_small?.url ?? g.images!.original!.url,
      }));
  } catch {
    return [];
  }
}
