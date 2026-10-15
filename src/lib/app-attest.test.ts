import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  initializeApp: vi.fn(() => ({ name: "app" })),
  captureError: vi.fn(),
}));

vi.mock("firebase-admin/app", () => ({
  initializeApp: mocks.initializeApp,
  cert: vi.fn((c: unknown) => c),
  getApps: vi.fn(() => []),
}));
vi.mock("@/lib/app-check-rest", () => ({ verifyAndConsumeAppCheckToken: mocks.verifyToken }));
vi.mock("@/lib/error-tracking", () => ({ captureError: mocks.captureError }));

const ANDROID = "1:1234567890:android:abc123";
const IOS = "1:1234567890:ios:def456";
const TOKEN = "aaa.bbb.ccc";

function form(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function configure(mode = "observe") {
  vi.stubEnv("NEXT_PUBLIC_APP_ATTEST_MODE", mode);
  vi.stubEnv("FIREBASE_PROJECT_ID", "proj");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "sa@proj.iam.gserviceaccount.com");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "key");
  vi.stubEnv("FIREBASE_APP_CHECK_APP_IDS", `${ANDROID}, ${IOS}`);
}

// The module logs a half-config warning at import time, so each test
// re-imports it fresh under its own env.
async function load() {
  vi.resetModules();
  return import("./app-attest");
}

function appCheckError(code: string) {
  return Object.assign(new Error(code), { code: `app-check/${code}` });
}

describe("app-attest", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_ATTEST_MODE", "");
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "");
    vi.stubEnv("FIREBASE_APP_CHECK_APP_IDS", "");
    mocks.verifyToken.mockReset();
    mocks.captureError.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is off by default and never calls App Check", async () => {
    const { isAppAttestEnabled, verifyAppAttestation } = await load();
    expect(isAppAttestEnabled()).toBe(false);
    expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "not_configured" });
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  it("stays inert and logs once when a mode is set without the Firebase server config", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NEXT_PUBLIC_APP_ATTEST_MODE", "enforce");
    const { isAppAttestEnabled, verifyAppAttestation } = await load();
    expect(isAppAttestEnabled()).toBe(false);
    expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "not_configured" });
    expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "not_configured" });
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("DISABLED"));
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  it("stays inert when the app ID allowlist is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    configure();
    vi.stubEnv("FIREBASE_APP_CHECK_APP_IDS", " , ");
    const { isAppAttestEnabled, verifyAppAttestation } = await load();
    expect(isAppAttestEnabled()).toBe(false);
    expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "not_configured" });
  });

  describe("when configured", () => {
    beforeEach(() => configure());

    it("reports absent for a missing or empty token", async () => {
      const { verifyAppAttestation } = await load();
      expect(await verifyAppAttestation(form())).toEqual({ outcome: "absent" });
      expect(await verifyAppAttestation(form({ "yk-app-attest": "" }))).toEqual({ outcome: "absent" });
      expect(mocks.verifyToken).not.toHaveBeenCalled();
    });

    it("rejects an oversized or non-JWT token without a network call", async () => {
      const { verifyAppAttestation } = await load();
      const big = `${"a".repeat(2100)}.${"b".repeat(2100)}.c`;
      expect(await verifyAppAttestation(form({ "yk-app-attest": big }))).toEqual({ outcome: "malformed" });
      expect(await verifyAppAttestation(form({ "yk-app-attest": "not a jwt" }))).toEqual({ outcome: "malformed" });
      const file = new FormData();
      file.set("yk-app-attest", new Blob(["x"]), "x.txt");
      expect(await verifyAppAttestation(file)).toEqual({ outcome: "malformed" });
      expect(mocks.verifyToken).not.toHaveBeenCalled();
    });

    it("accepts a valid, unconsumed token from an allowlisted app, consuming it", async () => {
      mocks.verifyToken.mockResolvedValue({ appId: ANDROID, token: {}, alreadyConsumed: false });
      const { verifyAppAttestation } = await load();
      expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "ok", platform: "android" });
      expect(mocks.verifyToken).toHaveBeenCalledWith(TOKEN, expect.anything(), expect.any(AbortSignal));

      mocks.verifyToken.mockResolvedValue({ appId: IOS, token: {}, alreadyConsumed: false });
      expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "ok", platform: "ios" });
    });

    it("rejects a token from an app outside the allowlist", async () => {
      mocks.verifyToken.mockResolvedValue({ appId: "1:999:android:other", token: {}, alreadyConsumed: false });
      const { verifyAppAttestation } = await load();
      expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "wrong_app", platform: "android" });
    });

    it("rejects a replayed token, and one whose consumed state is unknown", async () => {
      mocks.verifyToken.mockResolvedValue({ appId: ANDROID, token: {}, alreadyConsumed: true });
      const { verifyAppAttestation } = await load();
      expect((await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).outcome).toBe("consumed");
      mocks.verifyToken.mockResolvedValue({ appId: ANDROID, token: {} });
      expect((await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).outcome).toBe("consumed");
    });

    it("classifies expired and invalid tokens without reporting them", async () => {
      const { verifyAppAttestation } = await load();
      mocks.verifyToken.mockRejectedValue(appCheckError("app-check-token-expired"));
      expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "expired" });
      mocks.verifyToken.mockRejectedValue(appCheckError("invalid-argument"));
      expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "invalid" });
      expect(mocks.captureError).not.toHaveBeenCalled();
    });

    it("reports a backend failure as unavailable, throttled", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { verifyAppAttestation } = await load();
      mocks.verifyToken.mockRejectedValue(new Error("ECONNRESET"));
      expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "unavailable" });
      mocks.verifyToken.mockRejectedValue(appCheckError("permission-denied"));
      expect(await verifyAppAttestation(form({ "yk-app-attest": TOKEN }))).toEqual({ outcome: "unavailable" });
      expect(mocks.captureError).toHaveBeenCalledTimes(1);
    });

    it("gives up after 5s and reports unavailable", async () => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.verifyToken.mockReturnValue(new Promise(() => {}));
      const { verifyAppAttestation } = await load();
      const result = verifyAppAttestation(form({ "yk-app-attest": TOKEN }));
      await vi.advanceTimersByTimeAsync(5000);
      expect(await result).toEqual({ outcome: "unavailable" });
      expect(mocks.captureError).toHaveBeenCalledTimes(1);
    });
  });

  describe("parseAppMeta", () => {
    it("keeps only whitelisted short fields", async () => {
      const { parseAppMeta } = await load();
      const meta = JSON.stringify({ p: "android", b: "29", plugin: true, ua: "x", extra: { a: 1 } });
      expect(parseAppMeta(form({ "yk-app-meta": meta }))).toEqual({ p: "android", b: "29", plugin: true });
      expect(parseAppMeta(form({ "yk-app-meta": JSON.stringify({ p: "android", b: 31 }) }))).toEqual({ p: "android", b: "31" });
      expect(parseAppMeta(form({ "yk-app-meta": JSON.stringify({ p: "windows", b: "<script>", plugin: "yes" }) }))).toEqual({});
    });

    it("treats absent as null and anything unusable as invalid", async () => {
      const { parseAppMeta } = await load();
      expect(parseAppMeta(form())).toBeNull();
      expect(parseAppMeta(form({ "yk-app-meta": "" }))).toBeNull();
      expect(parseAppMeta(form({ "yk-app-meta": "{not json" }))).toBe("invalid");
      expect(parseAppMeta(form({ "yk-app-meta": "[1,2]" }))).toBe("invalid");
      expect(parseAppMeta(form({ "yk-app-meta": "null" }))).toBe("invalid");
      expect(parseAppMeta(form({ "yk-app-meta": JSON.stringify({ p: "android", pad: "x".repeat(600) }) }))).toBe("invalid");
    });
  });
});
