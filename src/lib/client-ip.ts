import { headers } from "next/headers";

/**
 * Best-effort client IP for rate-limiting unauthenticated actions (currently
 * just the public ad-booking flow at /advertise, which has no user.id to
 * key a limiter on). Netlify sets x-forwarded-for on every request; this is
 * not meant to be spoof-proof, only to blunt casual abuse.
 */
export async function getClientIp() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}
