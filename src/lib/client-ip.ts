import { headers } from "next/headers";

/**
 * Best-effort client IP for rate-limiting unauthenticated/pre-auth actions
 * (the public ad-booking flow at /advertise, and IP-scoped sign-in/sign-up/
 * password-reset limiters that key on IP+email since there's no session
 * user.id yet). Takes only the first hop of x-forwarded-for rather than the
 * whole header, since platforms typically prepend the real client IP and
 * append proxy hops after it. Netlify/Vercel set this on every request, but
 * it is not meant to be spoof-proof — it blunts casual abuse and IP-varying
 * enumeration, not a determined attacker who can control this header at the
 * edge. The per-account attempt lockout (see LOCKOUT_THRESHOLD in
 * password-auth.ts) is the actual defense against targeted brute force.
 */
export async function getClientIp() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}
