// Constants shared by the server gate (app-attest.ts / bot-gate.ts) and the
// client (app-attest-client.ts, components/turnstile-widget.tsx) — kept in
// their own file so the client bundle never pulls in firebase-admin.
// See docs/plans/app-attestation.md.

/** Hidden form field carrying a single-use (limited-use) Firebase App Check token. */
export const APP_ATTEST_FIELD = "yk-app-attest";

/** Hidden form field carrying untrusted app metadata (platform, build) — telemetry only, never trusted. */
export const APP_META_FIELD = "yk-app-meta";

/**
 * Set by the server when an attestation token didn't pass, so the app shows
 * the Turnstile button on the next attempt. Not httpOnly: the client reads it.
 * Forging it can only add friction (it switches the client to Turnstile).
 */
export const ATTEST_FALLBACK_COOKIE = "yk-attest-fallback";
export const ATTEST_FALLBACK_MAX_AGE_SECONDS = 30 * 60;

export const MAX_ATTEST_TOKEN_LENGTH = 4096;
export const MAX_APP_META_LENGTH = 1024;
export const ATTEST_REASON_CLIENT_MAX = 240;

const REASON_BOILERPLATE = /^The operation couldn[\u2019']t be completed\.?\s*/i;
const REASON_BACKOFF = /^Too many attempts\.?\s*(?:Underlying error:\s*)?/i;

/**
 * Shapes a native error message into a short diagnostic (telemetry only):
 * strips control chars, the "operation couldn't be completed" boilerplate and
 * the AppCheckCore backoff lead-in (kept as a `backoff|` marker) so the
 * informative underlying error survives the cap.
 */
export function shapeFailureReason(text: string): string {
  let t = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(REASON_BOILERPLATE, "");
  let marker = "";
  if (REASON_BACKOFF.test(t)) {
    t = t.replace(REASON_BACKOFF, "").replace(REASON_BOILERPLATE, "");
    marker = "backoff|";
  }
  return `${marker}${t}`.slice(0, ATTEST_REASON_CLIENT_MAX);
}

export type AppAttestMode = "off" | "observe" | "enforce";

/**
 * NEXT_PUBLIC_APP_ATTEST_MODE, read by both client and server so they can't
 * drift within a deploy. Anything other than "observe"/"enforce" is "off".
 */
export function appAttestMode(): AppAttestMode {
  const mode = process.env.NEXT_PUBLIC_APP_ATTEST_MODE?.trim().toLowerCase();
  return mode === "observe" || mode === "enforce" ? mode : "off";
}
