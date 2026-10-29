import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: mocks.captureError }));

const SITE = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
const SECRET = "TURNSTILE_SECRET_KEY";

function form(token?: string) {
  const fd = new FormData();
  if (token !== undefined) fd.set("cf-turnstile-response", token);
  return fd;
}

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

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
    mocks.captureError.mockReset();
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
    expect(await verifyTurnstile(form())).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays off and logs when only one key is set (no lockout)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv(SECRET, "secret-only");
    const { isTurnstileEnabled, verifyTurnstile } = await load();
    expect(isTurnstileEnabled()).toBe(false);
    expect(await verifyTurnstile(form())).toEqual({ ok: true });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("DISABLED"));
  });

  describe("classifySiteverifyCodes", () => {
    it("maps Cloudflare's error codes to what the person is told", async () => {
      const { classifySiteverifyCodes } = await load();
      expect(classifySiteverifyCodes(["timeout-or-duplicate"])).toEqual({ reason: "expired", misconfigured: false });
      expect(classifySiteverifyCodes(["invalid-input-response"])).toEqual({ reason: "rejected", misconfigured: false });
      expect(classifySiteverifyCodes(["missing-input-response"])).toEqual({ reason: "rejected", misconfigured: false });
      expect(classifySiteverifyCodes([])).toEqual({ reason: "rejected", misconfigured: false });
      expect(classifySiteverifyCodes(["internal-error"])).toEqual({ reason: "unavailable", misconfigured: false });
      // Our own setup: never blamed on the visitor.
      expect(classifySiteverifyCodes(["invalid-input-secret"])).toEqual({ reason: "unavailable", misconfigured: true });
      expect(classifySiteverifyCodes(["missing-input-secret"])).toEqual({ reason: "unavailable", misconfigured: true });
      expect(classifySiteverifyCodes(["bad-request"])).toEqual({ reason: "unavailable", misconfigured: true });
      expect(classifySiteverifyCodes(["timeout-or-duplicate", "invalid-input-secret"]).misconfigured).toBe(true);
    });
  });

  describe("when configured", () => {
    beforeEach(() => {
      vi.stubEnv(SITE, "site");
      vi.stubEnv(SECRET, "secret");
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("rejects a submission with no token as 'missing', without calling Cloudflare", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form())).toEqual({ ok: false, reason: "missing" });
      expect(await verifyTurnstile(form(""))).toEqual({ ok: false, reason: "missing" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an oversized token, without calling Cloudflare", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("x".repeat(2049)))).toEqual({ ok: false, reason: "missing" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("accepts when Cloudflare says success, sending secret, token and IP", async () => {
      const fetchMock = vi.fn().mockResolvedValue(answer({ success: true }));
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"), "203.0.113.9")).toEqual({ ok: true });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      const body = init.body as URLSearchParams;
      expect(body.get("secret")).toBe("secret");
      expect(body.get("response")).toBe("tok");
      expect(body.get("remoteip")).toBe("203.0.113.9");
    });

    it("omits remoteip when the client IP is unknown", async () => {
      const fetchMock = vi.fn().mockResolvedValue(answer({ success: true }));
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      await verifyTurnstile(form("tok"), "unknown");
      expect((fetchMock.mock.calls[0][1].body as URLSearchParams).has("remoteip")).toBe(false);
    });

    it("reports an expired or reused token as 'expired', and logs the codes but never the token", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer({ success: false, "error-codes": ["timeout-or-duplicate"] })));
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("secret-token-value"), "203.0.113.9", "loginWithPassword")).toEqual({
        ok: false,
        reason: "expired",
      });
      const logged = warn.mock.calls.flat().join(" ");
      expect(logged).toContain("loginWithPassword");
      expect(logged).toContain("timeout-or-duplicate");
      expect(logged).not.toContain("secret-token-value");
      expect(logged).not.toContain("203.0.113.9");
      expect(mocks.captureError).not.toHaveBeenCalled();
    });

    it("rejects an invalid token as 'rejected'", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer({ success: false, "error-codes": ["invalid-input-response"] })));
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"))).toEqual({ ok: false, reason: "rejected" });
    });

    it("never logs an unexpected error-code value verbatim", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer({ success: false, "error-codes": ["<script>", "x".repeat(200)] })));
      const { verifyTurnstile } = await load();
      await verifyTurnstile(form("tok"));
      expect(warn.mock.calls.flat().join(" ")).not.toContain("<script>");
    });

    it("treats a bad secret as our misconfiguration: 'unavailable', loud log and a Sentry report", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer({ success: false, "error-codes": ["invalid-input-secret"] })));
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"))).toEqual({ ok: false, reason: "unavailable" });
      expect(err).toHaveBeenCalledWith(expect.stringContaining("MISCONFIGURED"));
      expect(mocks.captureError).toHaveBeenCalledTimes(1);
    });

    it("fails CLOSED (not open) when Cloudflare is unreachable, after one retry", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"))).toEqual({ ok: false, reason: "unavailable" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(err).toHaveBeenCalledWith(expect.stringContaining("failing closed"));
      expect(mocks.captureError).toHaveBeenCalledTimes(1);
    });

    it("fails closed on a 5xx, and recovers if the retry succeeds", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const down = { ok: false, status: 503, json: async () => ({}) };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(down));
      let mod = await load();
      expect(await mod.verifyTurnstile(form("tok"))).toEqual({ ok: false, reason: "unavailable" });

      const flaky = vi.fn().mockResolvedValueOnce(down).mockResolvedValueOnce(answer({ success: true }));
      vi.stubGlobal("fetch", flaky);
      mod = await load();
      expect(await mod.verifyTurnstile(form("tok"))).toEqual({ ok: true });
      expect(flaky).toHaveBeenCalledTimes(2);
    });

    it("retries Cloudflare's own internal-error once", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(answer({ success: false, "error-codes": ["internal-error"] }))
        .mockResolvedValueOnce(answer({ success: true }));
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"))).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("doesn't retry a 4xx", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);
      const { verifyTurnstile } = await load();
      expect(await verifyTurnstile(form("tok"))).toEqual({ ok: false, reason: "unavailable" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("reports an outage to Sentry at most once per 10 minutes per instance", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
      const { verifyTurnstile } = await load();
      await verifyTurnstile(form("tok"));
      await verifyTurnstile(form("tok"));
      await verifyTurnstile(form("tok"));
      expect(mocks.captureError).toHaveBeenCalledTimes(1);
    });
  });
});
