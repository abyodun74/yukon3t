export type EmbedProvider = "YOUTUBE" | "VIMEO" | "TIKTOK" | "DAILYMOTION" | "INSTAGRAM" | "FACEBOOK";
export type ParsedEmbed = { provider: EmbedProvider; id: string };

const YOUTUBE_ID = /^[a-zA-Z0-9_-]{11}$/;
const VIMEO_ID = /^\d+$/;
const TIKTOK_ID = /^\d+$/;
// Dailymotion ids conventionally start with a letter (e.g. "x7abc12").
const DAILYMOTION_ID = /^[a-zA-Z0-9]+$/;
// Instagram's embed endpoint is path-type-specific (/p/<id>/embed for a
// feed post, /reel/<id>/embed for a Reel, /tv/<id>/embed for IGTV) — unlike
// every other provider here, the id alone isn't enough to rebuild a working
// embed src, so the post type is kept as part of `id` itself
// ("reel/DAbc123", not just "DAbc123").
const INSTAGRAM_ID = /^(?:p|reel|tv)\/[a-zA-Z0-9_-]+$/;
// Facebook's video plugin (embedSrc below) needs the *original* page path
// re-wrapped into a full facebook.com URL, not a bare numeric id like most
// other providers here — so `id` keeps the matched path segments themselves
// ("watch?v=123", "somepage/videos/456", "reel/789"), always rebuilt from
// these regex-validated pieces only, never the raw pasted URL.
const FACEBOOK_ID = /^(?:watch\?v=\d+|[a-zA-Z0-9_.-]+\/videos\/\d+|reel\/\d+)$/;

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

  if (host === "instagram.com") {
    const match = url.pathname.match(/^\/(p|reel|tv)\/([a-zA-Z0-9_-]+)/);
    const id = match ? `${match[1]}/${match[2]}` : null;
    return id && INSTAGRAM_ID.test(id) ? { provider: "INSTAGRAM", id } : null;
  }

  // fb.watch short links aren't handled here (same reasoning as TikTok's
  // vm./vt. short links above) — resolve-share-link.ts follows those
  // redirects first and re-parses the landing facebook.com URL.
  if (host === "facebook.com") {
    let id: string | null = null;
    if (url.pathname === "/watch" || url.pathname === "/watch/") {
      const v = url.searchParams.get("v");
      id = v && /^\d+$/.test(v) ? `watch?v=${v}` : null;
    } else {
      const videoMatch = url.pathname.match(/^\/([a-zA-Z0-9_.-]+)\/videos\/(\d+)/);
      const reelMatch = url.pathname.match(/^\/reel\/(\d+)/);
      if (videoMatch) id = `${videoMatch[1]}/videos/${videoMatch[2]}`;
      else if (reelMatch) id = `reel/${reelMatch[1]}`;
    }
    return id && FACEBOOK_ID.test(id) ? { provider: "FACEBOOK", id } : null;
  }

  return null;
}

/**
 * Rebuilds a safe iframe src from a provider+id pair — the only place this
 * string is constructed. Requests autoplay wherever the provider's embed
 * player has a documented URL param for it — muted, since every mainstream
 * browser engine blocks unmuted autoplay without a prior user gesture on
 * that exact origin, which an embed's cross-origin iframe never has; the
 * player's own visible controls (rendered by the provider, not this app)
 * still let the viewer unmute with one tap. TikTok and Instagram have no
 * documented autoplay param for their plain iframe embed (unlike the other
 * four) — both stay click-to-play, their own default.
 */
export function embedSrc({ provider, id }: ParsedEmbed): string {
  switch (provider) {
    case "YOUTUBE":
      return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;
    case "VIMEO":
      return `https://player.vimeo.com/video/${id}?autoplay=1&muted=1&playsinline=1`;
    case "TIKTOK":
      return `https://www.tiktok.com/embed/v2/${id}`;
    case "DAILYMOTION":
      return `https://www.dailymotion.com/embed/video/${id}?autoplay=1&mute=1`;
    case "INSTAGRAM":
      return `https://www.instagram.com/${id}/embed`;
    case "FACEBOOK":
      // show_text=false keeps this a bare video player (no Facebook post
      // caption/reaction chrome) — consistent with every other provider
      // here rendering just the player itself. autoplay/mute are the video
      // plugin's own documented params, same "muted, since that's what
      // reliably works" reasoning as every other provider above.
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(`https://www.facebook.com/${id}`)}&show_text=false&autoplay=true&mute=1`;
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
