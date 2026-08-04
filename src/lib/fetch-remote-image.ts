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

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff")) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isBlockedIpv4(mapped[1]) : false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true; // unrecognized format — refuse rather than guess
}

export type FetchRemoteImageError =
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
