import { isIP } from "node:net";
import dns from "node:dns/promises";
import { isBlockedIp } from "@/lib/fetch-remote-image";
import { parseVideoEmbedUrl } from "@/lib/video-embed";

const FETCH_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;

async function isSafeHost(hostname: string): Promise<boolean> {
  try {
    const addresses =
      isIP(hostname) !== 0 ? [hostname] : (await dns.lookup(hostname, { all: true })).map((a) => a.address);
    return addresses.length > 0 && !addresses.some(isBlockedIp);
  } catch {
    return false;
  }
}

/**
 * Resolves a bare shared link that isn't already a directly-parseable
 * embed URL (parseVideoEmbedUrl having already failed on it) by following
 * its redirect chain and re-checking the *landing* URL — the same
 * treatment a user manually pasting that landing URL would get. Not
 * TikTok-specific: any app's own Share sheet can hand another app a short/
 * tracking/redirect link instead of a direct one (TikTok's tiktok.com/t/
 * links are the confirmed live case, but the mechanism is generic), and
 * this only ever *starts* from that already-untrusted shared string anyway
 * — there's no narrower starting-host allowlist to bound to.
 *
 * SSRF-guarded the same way as fetch-remote-image.ts's fetchRemoteImage:
 * every hop (including the first) is DNS-resolved and IP-checked before
 * being requested (refusing private/loopback/link-local/CGNAT/metadata
 * addresses), capped at MAX_REDIRECTS hops, and the response body is never
 * read at any hop — only status + Location — so nothing from an
 * unexpected redirect target ever reaches the caller. The actual trust
 * boundary is downstream of this function: the landing URL only ever
 * becomes a real embed if parseVideoEmbedUrl accepts it, which means
 * recognizing it as one of this app's already-vetted, already-embeddable
 * providers (YouTube/Vimeo/TikTok/Dailymotion/Instagram) — a redirect chain landing
 * anywhere else just fails closed to null, same as today's "not a
 * recognized video link" case.
 */
export async function resolveSharedEmbedLink(raw: string): Promise<string | null> {
  let current: URL;
  try {
    current = new URL(raw.trim());
  } catch {
    return null;
  }

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") return null;
    if (!(await isSafeHost(current.hostname))) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "yukon3t-link-resolve/1.0" },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      try {
        current = new URL(location, current);
      } catch {
        return null;
      }
      continue;
    }

    // Landed — whether this final page is actually reachable doesn't
    // matter here, only its URL shape does.
    const resolvedUrl = current.toString();
    return parseVideoEmbedUrl(resolvedUrl) ? resolvedUrl : null;
  }

  return null; // too many hops
}
