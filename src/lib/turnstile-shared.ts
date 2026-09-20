// Constants shared by the server verifier (turnstile.ts) and the client
// widget (components/turnstile-widget.tsx) — kept in their own file so the
// client bundle never pulls in the server-only verification code.

/** Name of the form field Cloudflare's widget writes its one-time token into. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
