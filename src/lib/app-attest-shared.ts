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
export const MAX_APP_META_LENGTH = 512;

export type AppAttestMode = "off" | "observe" | "enforce";

/**
 * NEXT_PUBLIC_APP_ATTEST_MODE, read by both client and server so they can't
 * drift within a deploy. Anything other than "observe"/"enforce" is "off".
 */
export function appAttestMode(): AppAttestMode {
  const mode = process.env.NEXT_PUBLIC_APP_ATTEST_MODE?.trim().toLowerCase();
  return mode === "observe" || mode === "enforce" ? mode : "off";
}
