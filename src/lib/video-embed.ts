export type EmbedProvider = "YOUTUBE" | "VIMEO" | "TIKTOK" | "DAILYMOTION";
export type ParsedEmbed = { provider: EmbedProvider; id: string };

const YOUTUBE_ID = /^[a-zA-Z0-9_-]{11}$/;
const VIMEO_ID = /^\d+$/;
const TIKTOK_ID = /^\d+$/;
// Dailymotion ids conventionally start with a letter (e.g. "x7abc12").
const DAILYMOTION_ID = /^[a-zA-Z0-9]+$/;

/**
 * Extracts a validated provider + video id from a pasted URL — nothing else
 * about the URL is trusted or kept. Used identically on the client (instant
 * preview) and the server (the only copy that actually matters): the server
 * always re-parses the raw URL itself and only ever stores/renders the
 * provider+id pair, never the original string, so no attacker-controlled
 * query params or paths can end up in an iframe src.
 */
export function parseVideoEmbedUrl(raw: string): ParsedEmbed | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : url.pathname.startsWith("/embed/")
          ? url.pathname.slice("/embed/".length)
          : url.pathname.startsWith("/shorts/")
            ? url.pathname.slice("/shorts/".length)
            : url.pathname.startsWith("/live/")
              ? url.pathname.slice("/live/".length)
              : null;
    return id && YOUTUBE_ID.test(id) ? { provider: "YOUTUBE", id } : null;
  }

  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return YOUTUBE_ID.test(id) ? { provider: "YOUTUBE", id } : null;
  }

  if (host === "vimeo.com") {
    const id = url.pathname.startsWith("/video/")
      ? url.pathname.slice("/video/".length)
      : url.pathname.slice(1);
    return VIMEO_ID.test(id) ? { provider: "VIMEO", id } : null;
  }

  if (host === "player.vimeo.com") {
    const id = url.pathname.startsWith("/video/") ? url.pathname.slice("/video/".length) : null;
    return id && VIMEO_ID.test(id) ? { provider: "VIMEO", id } : null;
  }

  // Canonical share links only (/@user/video/<id>) — short vm.tiktok.com /
  // vt.tiktok.com links only reveal the real id after a redirect, which a
  // pure URL parser can't safely follow, so those aren't supported here.
  if (host === "tiktok.com") {
    const match = url.pathname.match(/^\/@[^/]+\/video\/(\d+)/);
    const id = match?.[1];
    return id && TIKTOK_ID.test(id) ? { provider: "TIKTOK", id } : null;
  }

  if (host === "dailymotion.com") {
    const id = url.pathname.startsWith("/video/")
      ? url.pathname.slice("/video/".length).split("_")[0]
      : null;
    return id && DAILYMOTION_ID.test(id) ? { provider: "DAILYMOTION", id } : null;
  }

  if (host === "dai.ly") {
    const id = url.pathname.slice(1).split("_")[0];
    return DAILYMOTION_ID.test(id) ? { provider: "DAILYMOTION", id } : null;
  }

  return null;
}

/** Rebuilds a safe iframe src from a provider+id pair — the only place this string is constructed. */
export function embedSrc({ provider, id }: ParsedEmbed): string {
  switch (provider) {
    case "YOUTUBE":
      return `https://www.youtube-nocookie.com/embed/${id}`;
    case "VIMEO":
      return `https://player.vimeo.com/video/${id}`;
    case "TIKTOK":
      return `https://www.tiktok.com/embed/v2/${id}`;
    case "DAILYMOTION":
      return `https://www.dailymotion.com/embed/video/${id}`;
  }
}

const OEMBED_TIMEOUT_MS = 4000;

// Builds the public, unauthenticated oEmbed request URL for a provider+id —
// same "reconstruct from the validated id, never touch the raw pasted URL"
// discipline as embedSrc. TikTok's oEmbed endpoint needs the full canonical
// `/@user/video/<id>` path (the username segment, which parseVideoEmbedUrl
// deliberately doesn't capture/store), so it has no entry here and always
// falls through to the "not supported" case below.
const OEMBED_URL: Partial<Record<EmbedProvider, (id: string) => string>> = {
  YOUTUBE: (id) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
  VIMEO: (id) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}`)}`,
  DAILYMOTION: (id) => `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(`https://www.dailymotion.com/video/${id}`)}`,
};

/**
 * Best-effort video title (+ uploader) lookup via the provider's public
 * oEmbed endpoint — used only to give the smart category filter
 * (src/lib/feed-category.ts) real topic signal for video posts, whose own
 * caption is often too sparse ("check this out") to classify on its own.
 * Never stored, never rendered — purely an input to the post's embedding
 * text. Fails open (returns null) on any error/timeout/unsupported
 * provider, same shape as moderation.ts/embeddings.ts.
 */
export async function fetchEmbedTitle(embed: ParsedEmbed): Promise<string | null> {
  const buildUrl = OEMBED_URL[embed.provider];
  if (!buildUrl) return null;

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), OEMBED_TIMEOUT_MS);
  try {
    const res = await fetch(buildUrl(embed.id), { signal: timeoutController.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const title = typeof data?.title === "string" ? data.title : null;
    const author = typeof data?.author_name === "string" ? data.author_name : null;
    return [title, author].filter(Boolean).join(" — ") || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
