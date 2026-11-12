import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  checkedAddressFor,
  pinnedRequest,
  resolveSharedEmbedLink,
  type CheckedAddress,
  type PinnedRequester,
} from "@/lib/resolve-share-link";

// The shared-link resolver (actions/embeds.ts -> resolveSharedEmbedLink): every hop is DNS-checked against
// isBlockedIp, and the request is pinned to the address that was checked (no second DNS answer to rebind).

const PUBLIC: CheckedAddress = { address: "93.184.216.34", family: 4 };
const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function dnsOf(table: Record<string, CheckedAddress[]>) {
  return async (hostname: string) => {
    const answer = table[hostname];
    if (!answer) throw new Error("ENOTFOUND");
    return answer;
  };
}

describe("checkedAddressFor", () => {
  it("refuses a host when any of its addresses is non-public", async () => {
    const lookup = dnsOf({ mixed: [PUBLIC, { address: "10.0.0.1", family: 4 }], v6: [{ address: "64:ff9b::a9fe:a9fe", family: 6 }] });
    expect(await checkedAddressFor("mixed", lookup)).toBeNull();
    expect(await checkedAddressFor("v6", lookup)).toBeNull();
    expect(await checkedAddressFor("missing", lookup)).toBeNull();
  });

  it("checks IP literals without DNS, including bracketed IPv6", async () => {
    const lookup = vi.fn();
    expect(await checkedAddressFor("[::1]", lookup)).toBeNull();
    expect(await checkedAddressFor("[2002:a9fe:a9fe::1]", lookup)).toBeNull();
    expect(await checkedAddressFor("169.254.169.254", lookup)).toBeNull();
    expect(await checkedAddressFor("8.8.8.8", lookup)).toEqual({ address: "8.8.8.8", family: 4 });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("resolveSharedEmbedLink", () => {
  it("follows redirects to a recognized video and pins every hop to its checked address", async () => {
    const seen: [string, CheckedAddress][] = [];
    const request: PinnedRequester = async (url, pinned) => {
      seen.push([url.hostname, pinned]);
      return url.hostname === "short.example" ? { status: 301, location: YOUTUBE } : { status: 200, location: null };
    };
    const lookup = dnsOf({ "short.example": [PUBLIC], "www.youtube.com": [{ address: "142.250.80.46", family: 4 }] });
    expect(await resolveSharedEmbedLink("https://short.example/x", { lookup, request })).toBe(YOUTUBE);
    expect(seen).toEqual([
      ["short.example", PUBLIC],
      ["www.youtube.com", { address: "142.250.80.46", family: 4 }],
    ]);
  });

  it("never requests a hop that redirects to an internal address", async () => {
    const request = vi.fn<PinnedRequester>(async () => ({ status: 302, location: "http://[64:ff9b::7f00:1]/admin" }));
    const lookup = dnsOf({ "short.example": [PUBLIC] });
    expect(await resolveSharedEmbedLink("https://short.example/x", { lookup, request })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refuses non-http schemes, credentials, oversized input and non-strings without any request", async () => {
    const request = vi.fn<PinnedRequester>();
    const lookup = dnsOf({ "a.example": [PUBLIC] });
    for (const raw of [
      "file:///etc/passwd",
      "https://user:pass@a.example/",
      `https://a.example/${"x".repeat(2100)}`,
      "not a url",
      42 as unknown as string,
    ]) {
      expect(await resolveSharedEmbedLink(raw, { lookup, request })).toBeNull();
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("gives up after 3 hops and when the landing page isn't a recognized video", async () => {
    const lookup = dnsOf({ "a.example": [PUBLIC] });
    const loop = vi.fn<PinnedRequester>(async () => ({ status: 302, location: "https://a.example/next" }));
    expect(await resolveSharedEmbedLink("https://a.example/", { lookup, request: loop })).toBeNull();
    expect(loop).toHaveBeenCalledTimes(3);
    const landing: PinnedRequester = async () => ({ status: 200, location: null });
    expect(await resolveSharedEmbedLink("https://a.example/", { lookup, request: landing })).toBeNull();
  });
});

describe("pinnedRequest", () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(302, { Location: `https://www.youtube.com/watch?v=${req.headers.host === `pinned.invalid:${port}` ? "ok" : "bad"}` });
      res.end("body that is never read");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("connects to the pinned address, not a DNS answer for the hostname, and keeps the Host header", async () => {
    // `.invalid` never resolves, so reaching the local server proves the socket used the pinned address.
    const result = await pinnedRequest(new URL(`http://pinned.invalid:${port}/`), { address: "127.0.0.1", family: 4 });
    expect(result).toEqual({ status: 302, location: "https://www.youtube.com/watch?v=ok" });
  });

  it("answers null when the connection fails", async () => {
    server.close();
    const result = await pinnedRequest(new URL(`http://pinned.invalid:${port}/`), { address: "127.0.0.1", family: 4 });
    expect(result).toBeNull();
  });
});
