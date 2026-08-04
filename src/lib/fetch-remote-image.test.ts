import { describe, it, expect } from "vitest";
import { isBlockedIp } from "@/lib/fetch-remote-image";

describe("isBlockedIp (SSRF guard)", () => {
  it("blocks loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("blocks the cloud metadata address — the single most dangerous SSRF target", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 addresses pointing at a blocked range", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.5")).toBe(true);
  });

  it("blocks IPv6 unique-local and link-local ranges", () => {
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd00::1")).toBe(true);
  });

  it("refuses an unrecognized/malformed address rather than guessing", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });

  it("allows an ordinary public IPv4 address", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  it("allows an ordinary public IPv6 address", () => {
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
  });
});
