import { TURNSTILE_ORIGIN, TURNSTILE_RESPONSE_FIELD } from "@/lib/turnstile-shared";

// Cloudflare Turnstile — a CAPTCHA replacement that's invisible for most
// real users. Layered on top of (not instead of) the honeypot/timing check
// in bot-protection.ts and the per-action limiters in rate-limit.ts: those
// bound volume and catch naive scripts, this is what stops a script that
// waits 1.2s and leaves the honeypot blank.
//
// Opt-in until configured, same pattern as R2/GTM/Clarity elsewhere in this
// app: it only turns on once BOTH keys are set, so deploying this code
// without them (or with only one — see the warning below) can never lock
// everyone out of sign-in.
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY — public, inlined into the client bundle
//                                    at build time (widget) and read by
//                                    src/proxy.ts (CSP).
//   TURNSTILE_SECRET_KEY           — server-only, used to verify tokens.

const VERIFY_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;
// Cloudflare documents tokens as at most 2048 characters.
const MAX_TOKEN_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 5000;

const hasSiteKey = () => Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
const hasSecretKey = () => Boolean(process.env.TURNSTILE_SECRET_KEY);

if (hasSiteKey() !== hasSecretKey()) {
  // Half-configured is a mistake, not a deliberate "off": with only the
  // secret set the forms would render no widget and every submission would
  // fail verification; with only the site key set the widget would render
  // but nothing would check it. Either way, stay off and say so loudly.
  console.error(
    "[turnstile] Only one of NEXT_PUBLIC_TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY is set — " +
      "Turnstile is DISABLED until both are configured.",
  );
}

export function isTurnstileEnabled(): boolean {
  return hasSiteKey() && hasSecretKey();
}

/**
 * Verifies the Turnstile token a form submitted. Returns true when the
 * submission may proceed.
 *
 * - Not configured → true (feature is off).
 * - Missing/oversized token → false (the widget didn't run, or a script is
 *   posting directly).
 * - Cloudflare says `success: false` → false.
 * - Cloudflare unreachable / 5xx → true, logged. Same "an infra outage
 *   degrades to unprotected rather than taking sign-in down" stance as
 *   checkRateLimit's Upstash fallback; the honeypot and rate limits still
 *   apply in that window.
 */
export async function verifyTurnstile(formData: FormData, remoteIp?: string): Promise<boolean> {
  if (!isTurnstileEnabled()) return true;

  const token = formData.get(TURNSTILE_RESPONSE_FIELD);
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN_LENGTH) {
    return false;
  }

  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY!,
      response: token,
    });
    if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[turnstile] siteverify returned", res.status, "— failing open");
      return true;
    }
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] siteverify unreachable — failing open", err);
    return true;
  }
}
