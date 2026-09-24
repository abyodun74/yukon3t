// Sign in with Apple's OAuth client_secret has to be a JWT signed with the
// app's own Apple-issued private key (ES256), valid for at most 6 months —
// see developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret.
// Most setups generate this once (e.g. via `npx auth add apple`) and paste
// the resulting JWT into an env var as a static secret — which then quietly
// stops working up to 6 months later with no obvious symptom besides
// "Sign in with Apple" suddenly failing, the same class of maintenance trap
// as a forgotten cert renewal. Generating it fresh here instead (cached
// in-memory, re-signed once it's close to expiring) means there's nothing
// to ever manually rotate.
//
// Signed with Node's built-in `crypto` rather than pulling in a JWT library
// for one call site — ES256 signing is a few lines of code, and this also
// keeps src/lib/auth.ts's provider list fully synchronous (the alternative,
// an async signer, would force auth.ts's module-level provider array to be
// built asynchronously, which NextAuth's static-config form doesn't want).

import { createPrivateKey, createSign } from "node:crypto";

// 5 months — comfortably under Apple's 6-month ceiling with margin so a
// slightly-delayed redeploy (or a server that stays up a while) never
// crosses into an actually-expired secret.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 * 5;

export function isAppleSignInConfigured(): boolean {
  return Boolean(
    process.env.AUTH_APPLE_ID &&
      process.env.AUTH_APPLE_TEAM_ID &&
      process.env.AUTH_APPLE_KEY_ID &&
      process.env.AUTH_APPLE_PRIVATE_KEY,
  );
}

function base64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cached: { secret: string; expiresAt: number } | null = null;

/** The Sign in with Apple client_secret JWT — regenerated automatically once the cached one is close to expiring. */
export function getAppleClientSecret(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.secret;

  const header = { alg: "ES256", kid: process.env.AUTH_APPLE_KEY_ID!, typ: "JWT" };
  const exp = now + MAX_AGE_SECONDS;
  const payload = {
    iss: process.env.AUTH_APPLE_TEAM_ID!,
    iat: now,
    exp,
    aud: "https://appleid.apple.com",
    sub: process.env.AUTH_APPLE_ID!,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  // Same \n-escaping convention as FIREBASE_PRIVATE_KEY (src/lib/fcm.ts) —
  // a PEM-formatted multi-line key doesn't survive most .env/host env-var
  // UIs with real newlines intact, so it's stored with literal "\n" and
  // unescaped here.
  const privateKeyPem = process.env.AUTH_APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const key = createPrivateKey({ key: privateKeyPem, format: "pem" });
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  // JWT/JOSE ES256 requires the "raw" IEEE P1363 R||S signature format (a
  // fixed 64 bytes for P-256) — Node's default for an EC key is ASN.1 DER,
  // which a JWT verifier would reject outright. `dsaEncoding: "ieee-p1363"`
  // asks Node for the raw format directly rather than needing a manual
  // DER-to-raw conversion step.
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });

  const secret = `${signingInput}.${base64url(signature)}`;
  cached = { secret, expiresAt: exp };
  return secret;
}
