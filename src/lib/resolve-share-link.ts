import { isIP, type LookupFunction } from "node:net";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isBlockedIp } from "@/lib/fetch-remote-image";
import { parseVideoEmbedUrl } from "@/lib/video-embed";

const FETCH_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;
/** Longest shared link accepted (resolveSharedVideoLink validates the same bound). */
export const SHARED_LINK_MAX_LENGTH = 2048;

/** One address a hostname resolved to, every one of which passed isBlockedIp. */
export type CheckedAddress = { address: string; family: 4 | 6 };

/** Status and Location of one GET, connected to exactly `pinned` (never a fresh DNS answer). null = failed. */
export type PinnedRequester = (url: URL, pinned: CheckedAddress) => Promise<{ status: number; location: string | null } | null>;

export type ResolveShareLinkDeps = {
  lookup?: (hostname: string) => Promise<CheckedAddress[]>;
  request?: PinnedRequester;
};

async function systemLookup(hostname: string): Promise<CheckedAddress[]> {
  return (await dns.lookup(hostname, { all: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

/**
 * Resolves the hop's host and checks every address it has. Returns the one to connect to, or null when any address
 * is private/loopback/link-local/metadata/etc. (isBlockedIp), or the name doesn't resolve.
 */
export async function checkedAddressFor(
  hostname: string,
  lookup: (hostname: string) => Promise<CheckedAddress[]> = systemLookup,
): Promise<CheckedAddress | null> {
  // URL.hostname keeps an IPv6 literal's brackets.
  const bare = hostname.replace(/^\[(.*)\]$/, "$1");
  let addresses: CheckedAddress[];
  try {
    const literal = isIP(bare);
    addresses = literal !== 0 ? [{ address: bare, family: literal === 6 ? 6 : 4 }] : await lookup(bare);
  } catch {
    return null;
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) return null;
  return addresses[0];
}

/**
 * GET with the socket pinned to the address that was checked: the `lookup` hook answers with it instead of asking
 * DNS again, so a name that re-resolves to an internal address between the check and the connect (DNS rebinding)
 * can't redirect the request. Host header and TLS SNI still use the hostname, so certificates verify as usual. Only
 * the status line and headers are read; the body is discarded unread.
 */
export const pinnedRequest: PinnedRequester = (url, pinned) =>
  new Promise((resolve) => {
    const lookup = ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
      else callback(null, pinned.address, pinned.family);
    }) as unknown as LookupFunction;
    const client = url.protocol === "https:" ? https : http;
    let settled = false;
    const finish = (value: { status: number; location: string | null } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = client.request(
      url,
      {
        method: "GET",
        lookup,
        agent: false,
        timeout: FETCH_TIMEOUT_MS,
        headers: { "User-Agent": "yukon3t-link-resolve/1.0" },
      },
      (res) => {
        const location = res.headers.location ?? null;
        finish({ status: res.statusCode ?? 0, location: Array.isArray(location) ? (location[0] ?? null) : location });
        res.destroy();
        req.destroy();
      },
    );
    req.on("timeout", () => {
      req.destroy();
      finish(null);
    });
    req.on("error", () => finish(null));
    req.end();
  });

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
 * SSRF-guarded: every hop (including the first) is DNS-resolved and every address IP-checked (isBlockedIp, which
 * also judges IPv6 forms that embed an IPv4 address by that address) before it is requested, and the connection is
 * then pinned to the checked address (pinnedRequest), so a DNS answer can't change between the check and the
 * connect. At most MAX_REDIRECTS hops, http(s) only, credentials in the URL refused, and no response body is ever
 * read — only status + Location — so nothing from an unexpected redirect target ever reaches the caller. The actual
 * trust boundary is downstream of this function: the landing URL only ever
 * becomes a real embed if parseVideoEmbedUrl accepts it, which means
 * recognizing it as one of this app's already-vetted, already-embeddable
 * providers (YouTube/Vimeo/TikTok/Dailymotion/Instagram/Facebook) — a
 * redirect chain landing anywhere else just fails closed to null, same as
 * today's "not a recognized video link" case. resolveSharedVideoLink (actions/embeds.ts) rate-limits the callers.
 */
export async function resolveSharedEmbedLink(raw: string, deps: ResolveShareLinkDeps = {}): Promise<string | null> {
  const request = deps.request ?? pinnedRequest;
  if (typeof raw !== "string" || raw.length > SHARED_LINK_MAX_LENGTH) return null;
  let current: URL;
  try {
    current = new URL(raw.trim());
  } catch {
    return null;
  }

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") return null;
    if (current.username || current.password) return null;
    const pinned = await checkedAddressFor(current.hostname, deps.lookup);
    if (!pinned) return null;

    const res = await request(current, pinned);
    if (!res) return null;

    if (res.status >= 300 && res.status < 400) {
      if (!res.location) return null;
      try {
        current = new URL(res.location, current);
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
