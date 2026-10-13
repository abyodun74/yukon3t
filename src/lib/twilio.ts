// Server-side calls to Twilio's Verify REST API — same raw-fetch pattern as
// daily.ts/email.ts/moderation.ts, rather than pulling in the twilio SDK for
// two endpoints. Verify owns the OTP code's entire lifecycle (generation,
// expiry, resend, its own fraud/rate-limiting) — this app never generates or
// stores a code itself, only starts a verification and checks a submitted
// code against Twilio.
import type { Locale } from "@/lib/i18n/locales";

// Verify's own names for the languages this app has (it writes the text message itself, from its own templates).
const VERIFY_LOCALES: Record<Locale, string> = { en: "en", es: "es", fr: "fr", pt: "pt-BR", ar: "ar" };

export function isPhoneVerificationConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_VERIFY_SERVICE_SID,
  );
}

function authHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("not_configured");
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

function serviceUrl(path: string) {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!serviceSid) throw new Error("not_configured");
  return `https://verify.twilio.com/v2/Services/${serviceSid}/${path}`;
}

/** Starts an SMS OTP verification. Throws "max_attempts" on Twilio's own
 * rate-limit response (error code 60203), "twilio_start_failed" otherwise.
 * `locale` is the language of the text; null leaves it to Verify, which goes by
 * the number's country. */
export async function startPhoneVerification(e164Phone: string, locale: Locale | null) {
  const res = await fetch(serviceUrl("Verifications"), {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      To: e164Phone,
      Channel: "sms",
      ...(locale ? { Locale: VERIFY_LOCALES[locale] } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body?.code === 60203) throw new Error("max_attempts");
    throw new Error("twilio_start_failed");
  }
}

/** Checks a submitted code against Twilio. Returns false on any non-approved
 * result or request failure — never throws, since a wrong code is an
 * expected outcome, not an error condition. */
export async function checkPhoneVerification(e164Phone: string, code: string) {
  const res = await fetch(serviceUrl("VerificationCheck"), {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: e164Phone, Code: code }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.status === "approved";
}
