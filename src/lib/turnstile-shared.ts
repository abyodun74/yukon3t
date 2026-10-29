// Constants shared by the server verifier (turnstile.ts) and the client
// widget (components/turnstile-widget.tsx) — kept in their own file so the
// client bundle never pulls in the server-only verification code.

/** Name of the form field Cloudflare's widget writes its one-time token into. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Why the server turned a submission down (src/lib/turnstile.ts):
 *  - "missing": no token at all (the widget never finished on that device, or a script posted directly).
 *  - "rejected": Cloudflare says the token is invalid.
 *  - "expired": Cloudflare says the token expired or was already used (`timeout-or-duplicate`).
 *  - "unavailable": we couldn't get an answer from Cloudflare (outage / timeout), or our own
 *    configuration is wrong (bad secret). Not the person's fault, so it gets its own message.
 */
export type TurnstileFailure = "missing" | "rejected" | "expired" | "unavailable";

export type BotCheck = { ok: true } | { ok: false; reason: TurnstileFailure };

/**
 * The `?error=` code (or form error code) a failed bot check is reported with. Only two, because only two
 * sentences make sense to a person: "do the check again" and "our side is down, try later".
 */
export function captchaErrorCode(reason: TurnstileFailure): "captcha" | "captcha_unavailable" {
  return reason === "unavailable" ? "captcha_unavailable" : "captcha";
}
