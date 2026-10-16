import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  captureError: vi.fn(),
  track: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(() => ({ name: "app" })),
  cert: vi.fn((c: unknown) => c),
  getApps: vi.fn(() => []),
}));
vi.mock("@/lib/app-check-rest", () => ({ verifyAndConsumeAppCheckToken: mocks.verifyToken }));
vi.mock("@/lib/error-tracking", () => ({ captureError: mocks.captureError }));
vi.mock("@/lib/analytics", () => ({ track: mocks.track }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: mocks.cookieSet })) }));

const ANDROID = "1:1234567890:android:abc123";
const ATTEST = "aaa.bbb.ccc";
const IP = "203.0.113.9";

function form(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function configureAttest(mode: string) {
  vi.stubEnv("NEXT_PUBLIC_APP_ATTEST_MODE", mode);
  vi.stubEnv("FIREBASE_PROJECT_ID", "proj");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "sa@proj.iam.gserviceaccount.com");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "key");
  vi.stubEnv("FIREBASE_APP_CHECK_APP_IDS", ANDROID);
}

// Cloudflare siteverify, answering `success` for any token.
function stubCloudflare(success: boolean) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function load() {
  vi.resetModules();
  return import("./bot-gate");
}

const validToken = () => mocks.verifyToken.mockResolvedValue({ appId: ANDROID, token: {}, alreadyConsumed: false });

function recorded() {
  expect(mocks.track).toHaveBeenCalledTimes(1);
  const [type, userId, metadata] = mocks.track.mock.calls[0];
  expect(type).toBe("APP_ATTESTATION");
  expect(userId).toBeNull();
  return metadata as Record<string, unknown>;
}

describe("passesBotGate", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("NEXT_PUBLIC_APP_ATTEST_MODE", "");
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "");
    vi.stubEnv("FIREBASE_APP_CHECK_APP_IDS", "");
    mocks.verifyToken.mockReset();
    mocks.captureError.mockReset();
    mocks.track.mockReset().mockResolvedValue(undefined);
    mocks.cookieSet.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("mode off (unset)", () => {
    it("is exactly Turnstile: ignores an attestation token, records nothing", async () => {
      validToken();
      stubCloudflare(true);
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST, "yk-app-meta": '{"p":"android"}' }), IP, "test")).toBe(false);
      expect(await passesBotGate(form({ "cf-turnstile-response": "tok", "yk-app-attest": ATTEST }), IP, "test")).toBe(true);
      expect(mocks.verifyToken).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.cookieSet).not.toHaveBeenCalled();
    });

    it("treats an unknown mode value as off", async () => {
      configureAttest("yes-please");
      validToken();
      stubCloudflare(true);
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST }), IP, "test")).toBe(false);
      expect(mocks.verifyToken).not.toHaveBeenCalled();
    });

    it("passes everything when Turnstile is disabled, as today", async () => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");
      const { passesBotGate } = await load();
      expect(await passesBotGate(form(), IP, "test")).toBe(true);
    });
  });

  describe("mode observe", () => {
    beforeEach(() => configureAttest("observe"));

    it("still requires Turnstile with a valid token, and records the outcome", async () => {
      validToken();
      stubCloudflare(true);
      const { passesBotGate } = await load();
      const meta = JSON.stringify({ p: "android", b: "29", plugin: true });
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST, "yk-app-meta": meta }), IP, "loginWithPassword")).toBe(false);
      expect(mocks.verifyToken).toHaveBeenCalledWith(ATTEST, expect.anything(), expect.any(AbortSignal));
      expect(recorded()).toEqual({
        action: "loginWithPassword",
        mode: "observe",
        outcome: "ok",
        platform: "android",
        meta: { p: "android", b: "29", plugin: true },
        turnstile: "fail",
      });
      expect(mocks.cookieSet).not.toHaveBeenCalled();
    });

    it("passes on Turnstile alone, whatever the attestation says", async () => {
      mocks.verifyToken.mockRejectedValue(Object.assign(new Error("bad"), { code: "app-check/invalid-argument" }));
      stubCloudflare(true);
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "cf-turnstile-response": "tok", "yk-app-attest": ATTEST }), IP, "test")).toBe(true);
      expect(recorded()).toMatchObject({ outcome: "invalid", turnstile: "pass" });
    });

    it("records native meta without a token as absent", async () => {
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "yk-app-meta": '{"p":"ios","b":"7","plugin":false}' }), IP, "test")).toBe(false);
      expect(recorded()).toMatchObject({ outcome: "absent", meta: { p: "ios", b: "7", plugin: false } });
      expect(mocks.verifyToken).not.toHaveBeenCalled();
    });

    it("records the failure reason e in the meta but never lets it change the decision", async () => {
      for (const turnstileOk of [false, true]) {
        mocks.track.mockClear();
        stubCloudflare(turnstileOk);
        const { passesBotGate } = await load();
        const plain = '{"p":"ios","b":"1","plugin":true}';
        const withE = '{"p":"ios","b":"1","plugin":true,"e":"reject:boom"}';
        const a = await passesBotGate(form({ "cf-turnstile-response": "tok", "yk-app-meta": plain }), IP, "test");
        const b = await passesBotGate(form({ "cf-turnstile-response": "tok", "yk-app-meta": withE }), IP, "test");
        expect(a).toBe(turnstileOk);
        expect(b).toBe(a);
        expect(mocks.track).toHaveBeenCalledTimes(2);
        expect(mocks.track.mock.calls[1][2]).toMatchObject({ outcome: "absent", meta: { p: "ios", plugin: true, e: "reject:boom" } });
      }
    });

    it("records nothing for a plain browser submit", async () => {
      stubCloudflare(true);
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "cf-turnstile-response": "tok" }), IP, "test")).toBe(true);
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("records not_configured when the Firebase server config is missing, deciding on Turnstile", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubEnv("FIREBASE_PRIVATE_KEY", "");
      stubCloudflare(true);
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST, "yk-app-meta": "{}" }), IP, "test")).toBe(false);
      expect(recorded()).toMatchObject({ outcome: "not_configured", turnstile: "fail" });
    });

    it("never lets a telemetry failure change or block the decision", async () => {
      validToken();
      stubCloudflare(true);
      mocks.track.mockRejectedValue(new Error("db down"));
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "cf-turnstile-response": "tok", "yk-app-attest": ATTEST }), IP, "test")).toBe(true);
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST }), IP, "test")).toBe(false);
    });
  });

  describe("mode enforce", () => {
    beforeEach(() => configureAttest("enforce"));

    it("passes a valid allowlisted token WITHOUT Turnstile", async () => {
      validToken();
      const fetchMock = stubCloudflare(false);
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST }), IP, "signUpWithPassword")).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(recorded()).toMatchObject({ action: "signUpWithPassword", mode: "enforce", outcome: "ok", turnstile: "skipped" });
      expect(mocks.cookieSet).not.toHaveBeenCalled();
    });

    it.each([
      ["consumed", () => mocks.verifyToken.mockResolvedValue({ appId: ANDROID, token: {}, alreadyConsumed: true })],
      ["wrong_app", () => mocks.verifyToken.mockResolvedValue({ appId: "1:1:android:evil", token: {}, alreadyConsumed: false })],
      ["expired", () => mocks.verifyToken.mockRejectedValue(Object.assign(new Error("x"), { code: "app-check/app-check-token-expired" }))],
      ["invalid", () => mocks.verifyToken.mockRejectedValue(Object.assign(new Error("x"), { code: "app-check/invalid-argument" }))],
    ])("falls to Turnstile on a %s token and sets the fallback cookie", async (outcome, arrange) => {
      arrange();
      stubCloudflare(true);
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST }), IP, "test")).toBe(false);
      expect(mocks.cookieSet).toHaveBeenCalledWith(
        "yk-attest-fallback",
        "1",
        expect.objectContaining({ httpOnly: false, sameSite: "lax", maxAge: 1800 }),
      );
      expect(recorded()).toMatchObject({ outcome, turnstile: "fail" });

      mocks.track.mockClear();
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST, "cf-turnstile-response": "tok" }), IP, "test")).toBe(true);
    });

    it("never passes when App Check is unreachable: reports it and falls to Turnstile", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.verifyToken.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
      stubCloudflare(true);
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST }), IP, "test")).toBe(false);
      expect(mocks.captureError).toHaveBeenCalledTimes(1);
      expect(mocks.cookieSet).toHaveBeenCalled();
      expect(recorded()).toMatchObject({ outcome: "unavailable" });
    });

    it("never passes when App Check times out", async () => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.verifyToken.mockReturnValue(new Promise(() => {}));
      stubCloudflare(true);
      const { passesBotGate } = await load();
      const result = passesBotGate(form({ "yk-app-attest": ATTEST }), IP, "test");
      await vi.advanceTimersByTimeAsync(5000);
      expect(await result).toBe(false);
      expect(mocks.captureError).toHaveBeenCalledTimes(1);
    });

    it("rejects an oversized token without a network call", async () => {
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "yk-app-attest": `${"a".repeat(4096)}.b.c` }), IP, "test")).toBe(false);
      expect(mocks.verifyToken).not.toHaveBeenCalled();
      expect(recorded()).toMatchObject({ outcome: "malformed" });
    });

    it("spoof: meta claiming Android build 999 from the app, with no tokens, does not pass", async () => {
      const fetchMock = stubCloudflare(true);
      const { passesBotGate } = await load();
      const spoof = form({ "yk-app-meta": JSON.stringify({ p: "android", b: "999", plugin: true }) });
      expect(await passesBotGate(spoof, IP, "loginWithPassword")).toBe(false);
      expect(mocks.verifyToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.cookieSet).not.toHaveBeenCalled();
      expect(recorded()).toMatchObject({ outcome: "absent", turnstile: "fail", meta: { p: "android", b: "999", plugin: true } });

      mocks.track.mockClear();
      const fakeToken = form({ "yk-app-attest": "", "yk-app-meta": JSON.stringify({ p: "android", b: "999" }), "user-agent": "YuKon3t Android" });
      expect(await passesBotGate(fakeToken, IP, "loginWithPassword")).toBe(false);
    });

    it("half-configured: inert, every token falls to Turnstile", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubEnv("FIREBASE_APP_CHECK_APP_IDS", "");
      validToken();
      stubCloudflare(true);
      const { passesBotGate } = await load();
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST }), IP, "test")).toBe(false);
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST }), IP, "test")).toBe(false);
      expect(mocks.verifyToken).not.toHaveBeenCalled();
      expect(err.mock.calls.filter(([msg]) => String(msg).includes("[app-attest]"))).toHaveLength(1);
    });

    it("passes everything when Turnstile is disabled, as today", async () => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");
      mocks.verifyToken.mockResolvedValue({ appId: ANDROID, token: {}, alreadyConsumed: true });
      const { passesBotGate } = await load();
      expect(await passesBotGate(form(), IP, "test")).toBe(true);
      expect(await passesBotGate(form({ "yk-app-attest": ATTEST }), IP, "test")).toBe(true);
    });
  });
});
