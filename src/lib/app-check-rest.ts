import type { App } from "firebase-admin/app";

// Verifies and consumes a limited-use App Check token over Google's REST API
// (the same `verifyAppCheckToken` call firebase-admin makes) instead of using
// `firebase-admin/app-check`. That module pulls in jwks-rsa, whose require()
// of ESM-only jose throws on Netlify's runtime — it 500'd every route once.
// The endpoint checks the signature, expiry and project server-side and
// reports `alreadyConsumed`, so the unverified claims decoded here are only
// trusted after it answers 200.
//
// Errors carry the same `code`s firebase-admin used so app-attest.ts's
// classification is unchanged.

const VERIFY_URL = "https://firebaseappcheck.googleapis.com/v1beta/projects/{projectId}:verifyAppCheckToken";

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function decodeClaims(token: string): { sub: string; exp: number } {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    if (typeof payload?.sub === "string" && typeof payload?.exp === "number") {
      return { sub: payload.sub, exp: payload.exp };
    }
  } catch {
    // falls through
  }
  return fail("app-check/invalid-argument", "App Check token has no usable claims");
}

export async function verifyAndConsumeAppCheckToken(
  token: string,
  app: App,
  signal?: AbortSignal,
): Promise<{ appId: string; alreadyConsumed: boolean }> {
  const { sub, exp } = decodeClaims(token);
  if (exp * 1000 <= Date.now()) fail("app-check/app-check-token-expired", "App Check token expired");

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const credential = app.options.credential;
  if (!projectId || !credential) throw new Error("Firebase admin app is not configured");
  const { access_token: accessToken } = await credential.getAccessToken();

  const res = await fetch(VERIFY_URL.replace("{projectId}", encodeURIComponent(projectId)), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ app_check_token: token }),
    signal,
  });
  if (res.status === 400) fail("app-check/invalid-argument", "App Check token rejected");
  if (!res.ok) throw new Error(`App Check verifyAppCheckToken failed: HTTP ${res.status}`);
  const body = (await res.json()) as { alreadyConsumed?: unknown };
  if (typeof body.alreadyConsumed !== "undefined" && typeof body.alreadyConsumed !== "boolean") {
    throw new Error("App Check verifyAppCheckToken returned a malformed alreadyConsumed");
  }
  return { appId: sub, alreadyConsumed: body.alreadyConsumed === true };
}
