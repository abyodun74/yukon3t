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
