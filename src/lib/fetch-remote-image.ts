import { isIP } from "node:net";
import dns from "node:dns/promises";
import { MEDIA_LIMITS } from "@/lib/storage";

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = MEDIA_LIMITS["post-image"];
const FETCH_TIMEOUT_MS = 8000;

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inV4Range(ip: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

// Loopback, RFC1918 private ranges, CGNAT, link-local (crucially including
// 169.254.169.254 — the cloud provider metadata address, the single most
// dangerous SSRF target), documentation/test ranges, and multicast/reserved.
const BLOCKED_V4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4_RANGES.some(([base, bits]) => inV4Range(n, base, bits));
}

/** The 16 bytes of an IPv6 address (any textual form: `::` compression, a dotted IPv4 tail, a `%zone`), or null. */
export function parseIpv6(ip: string): number[] | null {
  const address = ip.split("%")[0].toLowerCase();
  if (isIP(address) !== 6) return null;
  let text = address;
  // A dotted IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) is the last two 16-bit groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[2].split(".").map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes("::") ? text.split("::") : [text, null];
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (tail === null ? missing !== 0 : missing < 1) return null;
  const groups = [...headGroups, ...Array<string>(tail === null ? 0 : missing).fill("0"), ...tailGroups];
  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (!/^[0-9a-f]{1,4}$/.test(group) || Number.isNaN(value)) return null;
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function inV6Prefix(bytes: readonly number[], prefix: readonly number[], bits: number): boolean {
  for (let i = 0; i < bits; i += 8) {
    const take = Math.min(8, bits - i);
    const mask = (0xff << (8 - take)) & 0xff;
    if ((bytes[i / 8] & mask) !== ((prefix[i / 8] ?? 0) & mask)) return false;
  }
  return true;
}

function v4At(bytes: readonly number[], offset: number): string {
  return bytes.slice(offset, offset + 4).join(".");
}

// Ranges refused outright: unspecified/loopback (::/127), discard-only (100::/64), Teredo (2001::/32, its client
// address is obfuscated so it can't be checked), documentation (2001:db8::/32), the local-use NAT64 prefix
// (64:ff9b:1::/48), unique-local (fc00::/7), link-local (fe80::/10), the deprecated site-local (fec0::/10) and
// multicast (ff00::/8).
const BLOCKED_V6_PREFIXES: [number[], number][] = [
  [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 127],
  [[0x01, 0x00, 0, 0, 0, 0, 0, 0], 64],
  [[0x20, 0x01, 0x00, 0x00], 32],
  [[0x20, 0x01, 0x0d, 0xb8], 32],
  [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48],
  [[0xfc], 7],
  [[0xfe, 0x80], 10],
  [[0xfe, 0xc0], 10],
  [[0xff], 8],
];

/**
 * IPv6 that reaches an IPv4 address is judged by that IPv4 address: IPv4-mapped (::ffff:0:0/96), the deprecated
 * IPv4-compatible form (::a.b.c.d, ::/96), SIIT-translated (::ffff:0:a.b.c.d), NAT64's well-known prefix
 * (64:ff9b::/96) and 6to4 (2002::/16, the IPv4 address in bytes 2-5). Each would otherwise be a way to name a private
 * or metadata IPv4 address in a form the IPv4 list never sees.
 */
function isBlockedIpv6(ip: string): boolean {
  const bytes = parseIpv6(ip);
  if (!bytes) return true;
  if (BLOCKED_V6_PREFIXES.some(([prefix, bits]) => inV6Prefix(bytes, prefix, bits))) return true;
  const zeros = (n: number) => Array<number>(n).fill(0);
  if (inV6Prefix(bytes, [...zeros(10), 0xff, 0xff], 96)) return isBlockedIpv4(v4At(bytes, 12));
  if (inV6Prefix(bytes, zeros(12), 96)) return isBlockedIpv4(v4At(bytes, 12));
  if (inV6Prefix(bytes, [...zeros(8), 0xff, 0xff, 0, 0], 96)) return isBlockedIpv4(v4At(bytes, 12));
  if (inV6Prefix(bytes, [0x00, 0x64, 0xff, 0x9b, ...zeros(8)], 96)) return isBlockedIpv4(v4At(bytes, 12));
  if (inV6Prefix(bytes, [0x20, 0x02], 16)) return isBlockedIpv4(v4At(bytes, 2));
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true; // unrecognized format — refuse rather than guess
}

type FetchRemoteImageError =
  | "invalid_url"
  | "blocked_host"
  | "fetch_failed"
  | "invalid_content_type"
  | "too_large";

export type FetchRemoteImageResult =
  | { ok: true; body: Uint8Array; contentType: string }
  | { ok: false; error: FetchRemoteImageError };

/**
 * Downloads an image from a user-supplied URL for re-hosting, guarding
 * against SSRF: resolves DNS ourselves and refuses private/loopback/
 * link-local/metadata addresses before ever connecting, follows no
 * redirects (so a public-looking URL can't 302 into an internal one), and
 * caps both declared and actual body size while streaming.
 *
 * This blocks the realistic attack surface for a social app (scanning/
 * hitting internal services, cloud metadata endpoints) but isn't a
 * DNS-rebinding-proof solution — `fetch()` re-resolves the hostname itself
 * when it connects, after our own check has already passed. Pinning the
 * connection to the exact checked IP would need a custom low-level
 * dispatcher; not worth the fragility for this app's threat model.
 */
export async function fetchRemoteImage(rawUrl: string): Promise<FetchRemoteImageResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "invalid_url" };
  }

  let addresses: string[];
  try {
    addresses =
      isIP(url.hostname) !== 0
        ? [url.hostname]
        : (await dns.lookup(url.hostname, { all: true })).map((a) => a.address);
  } catch {
    return { ok: false, error: "blocked_host" };
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    return { ok: false, error: "blocked_host" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": "yukon3t-image-fetch/1.0" },
    });
  } catch {
    return { ok: false, error: "fetch_failed" };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok || (res.status >= 300 && res.status < 400) || !res.body) {
    return { ok: false, error: "fetch_failed" };
  }

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return { ok: false, error: "invalid_content_type" };
  }

  const declaredLength = Number(res.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BYTES) {
    return { ok: false, error: "too_large" };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return { ok: false, error: "too_large" };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, body, contentType };
}
