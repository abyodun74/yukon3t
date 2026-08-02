export type EmbedProvider = "YOUTUBE" | "VIMEO";
export type ParsedEmbed = { provider: EmbedProvider; id: string };

const YOUTUBE_ID = /^[a-zA-Z0-9_-]{11}$/;
const VIMEO_ID = /^\d+$/;

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

  return null;
}

/** Rebuilds a safe iframe src from a provider+id pair — the only place this string is constructed. */
export function embedSrc({ provider, id }: ParsedEmbed): string {
  return provider === "YOUTUBE"
    ? `https://www.youtube-nocookie.com/embed/${id}`
    : `https://player.vimeo.com/video/${id}`;
}
