import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAndConsumeAppCheckToken } from "./app-check-rest";

const getAccessToken = vi.fn();
const app = { options: { credential: { getAccessToken } } } as never;

function jwt(claims: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256" })}.${enc(claims)}.sig`;
}
const future = () => Math.floor(Date.now() / 1000) + 3600;
const SUB = "1:123:android:abc";

describe("verifyAndConsumeAppCheckToken", () => {
  beforeEach(() => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "proj");
    getAccessToken.mockReset().mockResolvedValue({ access_token: "gtok" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the app id and consumed flag from the REST endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ alreadyConsumed: false }) });
    vi.stubGlobal("fetch", fetchMock);
    const token = jwt({ sub: SUB, exp: future() });
    await expect(verifyAndConsumeAppCheckToken(token, app)).resolves.toEqual({ appId: SUB, alreadyConsumed: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://firebaseappcheck.googleapis.com/v1beta/projects/proj:verifyAppCheckToken");
    expect(JSON.parse(init.body)).toEqual({ app_check_token: token });
    expect(init.headers.Authorization).toBe("Bearer gtok");
  });

  it("reports consumed tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ alreadyConsumed: true }) }));
    const r = await verifyAndConsumeAppCheckToken(jwt({ sub: SUB, exp: future() }), app);
    expect(r.alreadyConsumed).toBe(true);
  });

  it("rejects expired tokens without a network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyAndConsumeAppCheckToken(jwt({ sub: SUB, exp: 1 }), app)).rejects.toMatchObject({
      code: "app-check/app-check-token-expired",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps HTTP 400 to invalid-argument and other failures to a plain error", async () => {
    const token = jwt({ sub: SUB, exp: future() });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(verifyAndConsumeAppCheckToken(token, app)).rejects.toMatchObject({ code: "app-check/invalid-argument" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(verifyAndConsumeAppCheckToken(token, app)).rejects.not.toHaveProperty("code");
  });

  it("rejects garbage claims", async () => {
    await expect(verifyAndConsumeAppCheckToken("aaa.bbb.ccc", app)).rejects.toMatchObject({
      code: "app-check/invalid-argument",
    });
  });
});
