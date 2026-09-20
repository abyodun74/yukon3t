import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SITE = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
const SECRET = "TURNSTILE_SECRET_KEY";

function form(token?: string) {
  const fd = new FormData();
  if (token !== undefined) fd.set("cf-turnstile-response", token);
  return fd;
}

// The module reads env at call time but also logs at import time, so each
// test re-imports it fresh under its own env.
async function load() {
  vi.resetModules();
  return import("./turnstile");
}

describe("turnstile", () => {
  beforeEach(() => {
    vi.stubEnv(SITE, "");
    vi.stubEnv(SECRET, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is off, and lets everything through, until both keys are set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { isTurnstileEnabled, verifyTurnstile } = await load();
    expect(isTurnstileEnabled()).toBe(false);
    expect(await verifyTurnstile(form())).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays off and logs when only one key is set (no lockout)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv(SECRET, "secret-only");
    const { isTurnstileEnabled, verifyTurnstile } = await load();
    expect(isTurnstileEnabled()).toBe(false);
    expect(await verifyTurnstile(form())).toBe(true);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("DISABLED"));
  });

  describe("when configured", () => {
    beforeEach(() => {
      vi.stubEnv(SITE, "site");
      vi.stubEnv(SECRET, "secret");
    });

    it("rejects a submission with no token, without calling Cloudflare", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form())).toBe(false);
      expect(await verifyTurnstile(form(""))).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an oversized token, without calling Cloudflare", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("x".repeat(2049)))).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("accepts when Cloudflare says success, sending secret, token and IP", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"), "203.0.113.9")).toBe(true);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      const body = init.body as URLSearchParams;
      expect(body.get("secret")).toBe("secret");
      expect(body.get("response")).toBe("tok");
      expect(body.get("remoteip")).toBe("203.0.113.9");
    });

    it("omits remoteip when the client IP is unknown", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      await verifyTurnstile(form("tok"), "unknown");
      expect((fetchMock.mock.calls[0][1].body as URLSearchParams).has("remoteip")).toBe(false);
    });

    it("rejects when Cloudflare says the token is invalid, expired or reused", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false, "error-codes": ["timeout-or-duplicate"] }) }),
      );
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"))).toBe(false);
    });

    it("fails open (and logs) when Cloudflare is unreachable", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"))).toBe(true);
      expect(err).toHaveBeenCalled();
    });

    it("fails open (and logs) when Cloudflare returns a 5xx", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"))).toBe(true);
      expect(err).toHaveBeenCalled();
    });
  });
});
