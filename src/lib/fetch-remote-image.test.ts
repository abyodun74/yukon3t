import { describe, it, expect } from "vitest";
import { isBlockedIp, parseIpv6 } from "@/lib/fetch-remote-image";

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

  it("judges IPv6 forms that embed an IPv4 address by that address", () => {
    // NAT64 well-known prefix
    expect(isBlockedIp("64:ff9b::169.254.169.254")).toBe(true);
    expect(isBlockedIp("64:ff9b::a9fe:a9fe")).toBe(true);
    expect(isBlockedIp("64:ff9b::7f00:1")).toBe(true);
    expect(isBlockedIp("64:ff9b::808:808")).toBe(false);
    // 6to4: the IPv4 address is in bytes 2-5
    expect(isBlockedIp("2002:a9fe:a9fe::1")).toBe(true);
    expect(isBlockedIp("2002:0a00:0001::")).toBe(true);
    expect(isBlockedIp("2002:808:808::1")).toBe(false);
    // Deprecated IPv4-compatible form and the hex spelling of IPv4-mapped
    expect(isBlockedIp("::127.0.0.1")).toBe(true);
    expect(isBlockedIp("::10.0.0.5")).toBe(true);
    expect(isBlockedIp("::ffff:7f00:1")).toBe(true);
    expect(isBlockedIp("0:0:0:0:0:ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
    // SIIT
    expect(isBlockedIp("::ffff:0:192.168.1.1")).toBe(true);
  });

  it("blocks the other non-public IPv6 ranges", () => {
    expect(isBlockedIp("fec0::1")).toBe(true); // deprecated site-local
    expect(isBlockedIp("febf::1")).toBe(true); // link-local fe80::/10 upper end
    expect(isBlockedIp("2001:0::1")).toBe(true); // Teredo
    expect(isBlockedIp("2001:db8::1")).toBe(true); // documentation
    expect(isBlockedIp("64:ff9b:1::1")).toBe(true); // local-use NAT64
    expect(isBlockedIp("100::1")).toBe(true); // discard-only
    expect(isBlockedIp("ff02::1")).toBe(true); // multicast
    expect(isBlockedIp("::")).toBe(true);
    expect(isBlockedIp("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isBlockedIp("fe80::1%eth0")).toBe(true);
  });

  it("parses every textual IPv6 form to the same bytes", () => {
    const expected = [0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0, 0xa9, 0xfe, 0xa9, 0xfe];
    expect(parseIpv6("64:ff9b::169.254.169.254")).toEqual(expected);
    expect(parseIpv6("64:FF9B:0:0:0:0:A9FE:A9FE")).toEqual(expected);
    expect(parseIpv6("not-an-ip")).toBeNull();
  });
});
