import { headers } from "next/headers";
import { clientIpFromHeaders } from "@/lib/page-rate-limit";

/**
 * Best-effort client IP for rate-limiting unauthenticated/pre-auth actions
 * (the public ad-booking flow at /advertise, and IP-scoped sign-in/sign-up/
 * password-reset limiters that key on IP+email since there's no session
 * user.id yet). Reads the same headers as src/proxy.ts's page limit
 * (clientIpFromHeaders): the current host's own client-address header first (Netlify's or
 * Vercel's, never the other's), then the first hop of x-forwarded-for. It
 * is not meant to be spoof-proof everywhere — it blunts casual abuse and
 * IP-varying enumeration, not a determined attacker. The per-account attempt
 * lockout (see LOCKOUT_THRESHOLD in password-auth.ts) is the actual defense
 * against targeted brute force.
 */
export async function getClientIp() {
  const h = await headers();
  return clientIpFromHeaders((name) => h.get(name)) ?? "unknown";
}
