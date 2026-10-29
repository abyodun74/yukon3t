import { TURNSTILE_ORIGIN, TURNSTILE_RESPONSE_FIELD, type BotCheck, type TurnstileFailure } from "@/lib/turnstile-shared";
import { captureError } from "@/lib/error-tracking";

// Cloudflare Turnstile — a CAPTCHA replacement. The client widget only
// runs its check after the person taps "Verify you're human". Layered on top of (not instead of) the honeypot/timing check
// in bot-protection.ts and the per-action limiters in rate-limit.ts: those
// bound volume and catch naive scripts, this is what stops a script that
// waits 1.2s and leaves the honeypot blank.
//
// Actions don't call this directly: they call passesBotGate (bot-gate.ts),
// which returns exactly this result unless a native-app attestation token is
// accepted in its place (docs/plans/app-attestation.md).
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
// Two tries at most, each capped, so a hung Cloudflare costs a sign-in at most ~8s.
const VERIFY_ATTEMPTS = 2;
const VERIFY_TIMEOUT_MS = 4000;
// Sentry reports for an outage / misconfiguration: at most one per kind per 10 minutes per server instance, so a
// Cloudflare outage doesn't send one event per sign-in attempt. console lines are not throttled.
const REPORT_EVERY_MS = 10 * 60_000;

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

// siteverify error codes that mean OUR configuration is wrong, not the visitor's token.
const MISCONFIG_CODES = new Set(["missing-input-secret", "invalid-input-secret", "bad-request"]);

/**
 * Maps Cloudflare siteverify `error-codes` to a failure reason. Pure; exported for tests.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/#error-codes
 */
export function classifySiteverifyCodes(codes: readonly string[]): { reason: TurnstileFailure; misconfigured: boolean } {
  if (codes.some((c) => MISCONFIG_CODES.has(c))) return { reason: "unavailable", misconfigured: true };
  if (codes.includes("internal-error")) return { reason: "unavailable", misconfigured: false };
  if (codes.includes("timeout-or-duplicate")) return { reason: "expired", misconfigured: false };
  return { reason: "rejected", misconfigured: false };
}

const lastReported = new Map<string, number>();
function reportThrottled(kind: string, error: Error, context: Record<string, unknown>) {
  const now = Date.now();
  if (now - (lastReported.get(kind) ?? -Infinity) < REPORT_EVERY_MS) return;
  lastReported.set(kind, now);
  void captureError(error, context);
}

// Only short, known-shape codes are ever logged (never the token, secret or IP).
function safeCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string" && /^[a-z0-9-]{1,64}$/.test(c)).slice(0, 5);
}

type SiteverifyAnswer =
  | { kind: "answer"; success: boolean; codes: string[] }
  | { kind: "unreachable"; status: number | null };

async function callSiteverify(token: string, remoteIp?: string): Promise<SiteverifyAnswer> {
  let last: SiteverifyAnswer = { kind: "unreachable", status: null };
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
    try {
      const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token });
      if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
      const res = await fetch(VERIFY_URL, {
        method: "POST",
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as { success?: boolean; "error-codes"?: unknown };
        const codes = safeCodes(data["error-codes"]);
        // Cloudflare's own transient failure: worth one more try, like a 5xx.
        if (data.success !== true && codes.includes("internal-error") && attempt + 1 < VERIFY_ATTEMPTS) continue;
        return { kind: "answer", success: data.success === true, codes };
      }
      last = { kind: "unreachable", status: res.status };
      if (res.status < 500) return last; // a 4xx won't change on a retry
    } catch {
      last = { kind: "unreachable", status: null };
    }
  }
  return last;
}

/**
 * Verifies the Turnstile token a form submitted.
 *
 * - Not configured → ok (feature is off).
 * - Missing/oversized token → "missing" (the widget didn't finish, or a script is posting directly).
 * - Cloudflare says `success: false` → "expired" / "rejected", or "unavailable" for our own misconfiguration
 *   (bad secret), which is also reported to Sentry because it blocks everyone.
 * - Cloudflare unreachable / 5xx after a retry → "unavailable". This FAILS CLOSED (it used to fail open):
 *   a password sign-in must not lose its bot check just because Cloudflare (or the route to it) is down. The
 *   person gets a message saying it's on our side, and the outage is logged and reported. Whether a limited
 *   fail-open (with stricter rate limits) is worth it is an owner decision — see the Turnstile entry in CLAUDE.md.
 *
 * `action` is only used to label log lines. Nothing personal (token, IP, email) is ever logged.
 */
export async function verifyTurnstile(formData: FormData, remoteIp?: string, action = "unknown"): Promise<BotCheck> {
  if (!isTurnstileEnabled()) return { ok: true };

  const token = formData.get(TURNSTILE_RESPONSE_FIELD);
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN_LENGTH) {
    console.warn(`[turnstile] ${action}: no token submitted`);
    return { ok: false, reason: "missing" };
  }

  const answer = await callSiteverify(token, remoteIp);
  if (answer.kind === "unreachable") {
    console.error(`[turnstile] ${action}: siteverify unreachable (status ${answer.status ?? "none"}) — failing closed`);
    reportThrottled("unreachable", new Error("Turnstile siteverify unreachable"), { action, status: answer.status });
    return { ok: false, reason: "unavailable" };
  }
  if (answer.success) return { ok: true };

  const { reason, misconfigured } = classifySiteverifyCodes(answer.codes);
  if (misconfigured) {
    console.error(`[turnstile] ${action}: MISCONFIGURED — siteverify error-codes ${answer.codes.join(",")}`);
    reportThrottled("misconfigured", new Error("Turnstile secret key misconfigured"), { action, codes: answer.codes });
  } else {
    console.warn(`[turnstile] ${action}: rejected (${reason}) error-codes ${answer.codes.join(",") || "none"}`);
    if (reason === "unavailable") {
      reportThrottled("internal-error", new Error("Turnstile siteverify internal-error"), { action, codes: answer.codes });
    }
  }
  return { ok: false, reason };
}
