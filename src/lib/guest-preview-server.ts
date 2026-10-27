import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sessionCookieName } from "@/lib/auth-cookie";
import { sessionTokenClaims } from "@/lib/session-token";
import { GUEST_PREVIEW_EMAIL, GUEST_PREVIEW_SESSION_MAX_SECONDS } from "@/lib/guest-preview";

// The server half of guest preview (rules: src/lib/guest-preview.ts).

/**
 * The guest row's fixed shape. Complete enough to pass onboarding (name, country, interests) and verified so read-only
 * pages that need a verified viewer render, but invisible everywhere: not discoverable, posts HIDDEN, no new-member
 * alerts either way (already "announced", never onboarded, alerts off), no avatar, no username, no password.
 */
function guestRowData() {
  return {
    email: GUEST_PREVIEW_EMAIL,
    isGuestPreview: true,
    emailVerified: new Date(),
    name: "Guest",
    country: "US",
    interests: ["Exploring"],
    interestsLower: ["exploring"],
    discoverable: false,
    postsVisibility: "HIDDEN" as const,
    newMemberAlerts: false,
    newMemberAnnouncedAt: new Date(),
    status: "ACTIVE" as const,
  };
}

/**
 * The id of the shared guest row, creating it on first use. Refuses (null) if a row with the reserved address exists
 * without the flag (someone else's account: it is never repurposed) or if any guest row isn't ACTIVE (an admin
 * suspended it: that is also a way to switch guest preview off).
 */
export async function ensureGuestPreviewUser(): Promise<string | null> {
  const existing = await prisma.user.findFirst({
    where: { isGuestPreview: true },
    select: { id: true, status: true },
  });
  if (existing) return existing.status === "ACTIVE" ? existing.id : null;

  const byEmail = await prisma.user.findUnique({ where: { email: GUEST_PREVIEW_EMAIL }, select: { id: true } });
  if (byEmail) return null;
  try {
    const created = await prisma.user.create({ data: guestRowData(), select: { id: true } });
    return created.id;
  } catch {
    // Two first-ever guests at once: the unique email makes one create fail; use the row the other one made.
    const row = await prisma.user.findFirst({ where: { isGuestPreview: true, status: "ACTIVE" }, select: { id: true } });
    return row?.id ?? null;
  }
}

/**
 * Issues this visitor's own guest session: the same cookie and JWT shape as a real sign-in (session-token.ts), plus
 * the `guest` claim. Its `issuedAt` is what the fixed lifetime counts from (auth.ts's jwt callback and requireViewer).
 */
export async function issueGuestSessionCookie(guestUserId: string) {
  const cookieName = sessionCookieName();
  const token = await encode({
    // guestSid: this visitor's own id, so per-user rate limits count each guest separately (viewerRateLimitKey).
    token: { sub: guestUserId, ...sessionTokenClaims({ isAdmin: false }), guest: true, guestSid: randomUUID() },
    secret: process.env.AUTH_SECRET!,
    salt: cookieName,
    maxAge: GUEST_PREVIEW_SESSION_MAX_SECONDS,
  });
  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.AUTH_URL?.startsWith("https://") ?? true,
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_PREVIEW_SESSION_MAX_SECONDS,
  });
}
